const SUMMARY_PROMPT = `Please summarize the YouTube video using the following transcript.

Always write the recap in English.
Return Markdown only.
Start with exactly 3 executive takeaway bullet points.
Then write an intro, development, and conclusion recap in 3 succinct paragraphs.`;

const YOUTUBE_ID_PATTERN =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;
const WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)";
const INNER_TUBE_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const INNER_TUBE_VERSION = "20.10.38";
const INNER_TUBE_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: INNER_TUBE_VERSION,
  },
};
const INNER_TUBE_USER_AGENT = `com.google.android.youtube/${INNER_TUBE_VERSION} (Linux; U; Android 14)`;
const ERROR_STAGES = {
  requestValidation: "request_validation",
  youtubeTrackLookup: "youtube_track_lookup",
  youtubeTranscriptFetch: "youtube_transcript_fetch",
  openAiSummary: "openai_summary",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(request, { status: "ok" });
    }

    if (request.method === "POST" && url.pathname === "/api/summarize") {
      return handleSummarize(request, env);
    }

    return errorResponse(
      request,
      apiError(
        404,
        "route_not_found",
        "Not found.",
        ERROR_STAGES.requestValidation,
        false,
      ),
    );
  },
};

export {
  apiError,
  buildTranscriptFetchCandidates,
  createErrorDetail,
  decodeEntities,
  extractVideoId,
  extractResponseOutputText,
  parseInlineJson,
  parseTranscriptJson3,
  parseTranscriptXml,
  selectPreferredTranscriptTrack,
  summarizeTranscript,
  transcriptTrackPriority,
};

async function handleSummarize(request, env) {
  try {
    let payload;

    try {
      payload = await request.json();
    } catch {
      throw apiError(
        400,
        "request_body_invalid",
        "Request body must be valid JSON.",
        ERROR_STAGES.requestValidation,
        false,
      );
    }

    const youtubeUrl =
      typeof payload?.youtube_url === "string" ? payload.youtube_url.trim() : "";

    if (!youtubeUrl) {
      throw apiError(
        400,
        "youtube_url_required",
        "Please provide a YouTube URL.",
        ERROR_STAGES.requestValidation,
        false,
      );
    }

    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      throw apiError(
        400,
        "youtube_url_invalid",
        "Please provide a valid YouTube watch, short, embed, or youtu.be URL.",
        ERROR_STAGES.requestValidation,
        false,
      );
    }

    const transcriptText = await getTranscriptText(videoId, youtubeUrl);
    const summaryMarkdown = await summarizeTranscript(transcriptText, env);

    return jsonResponse(request, {
      summary_markdown: summaryMarkdown,
      video_id: videoId,
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}

function extractVideoId(youtubeUrl) {
  try {
    const parsed = new URL(youtubeUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === "youtu.be" || hostname === "www.youtu.be") {
      return parsed.pathname.slice(1) || null;
    }

    if (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com"
    ) {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }

      if (
        parsed.pathname.startsWith("/shorts/") ||
        parsed.pathname.startsWith("/embed/")
      ) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        return parts[1] || null;
      }
    }
  } catch {
    const matched = youtubeUrl.match(YOUTUBE_ID_PATTERN);
    return matched ? matched[1] : null;
  }

  const matched = youtubeUrl.match(YOUTUBE_ID_PATTERN);
  return matched ? matched[1] : null;
}

async function getTranscriptText(videoId, youtubeUrl) {
  const innerTubeTracks = await fetchTranscriptTracksViaInnerTube(videoId);

  if (Array.isArray(innerTubeTracks) && innerTubeTracks.length > 0) {
    return fetchTranscriptTextFromTracks(videoId, innerTubeTracks);
  }

  const watchPageTracks = await fetchTranscriptTracksViaWatchPage(videoId, youtubeUrl);
  return fetchTranscriptTextFromTracks(videoId, watchPageTracks);
}

async function fetchTranscriptTextFromTracks(videoId, tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw apiError(
      422,
      "transcript_not_found",
      "No transcript was found for this video.",
      ERROR_STAGES.youtubeTranscriptFetch,
      false,
    );
  }

  const preferredTrack = selectPreferredTranscriptTrack(tracks);
  const preferredTracks = [
    preferredTrack,
    ...tracks.filter((track) => track !== preferredTrack),
  ].filter(Boolean);
  const failures = [];

  for (const track of preferredTracks) {
    try {
      const transcriptText = await fetchTranscriptTextFromTrack(track, videoId);
      if (transcriptText) {
        return transcriptText;
      }
    } catch (error) {
      failures.push({
        errorCode: error?.errorCode || "transcript_fetch_failed",
        languageCode: track?.languageCode || null,
        kind: track?.kind || null,
        message: error?.message || "Unknown transcript fetch failure.",
        retryable: Boolean(error?.retryable),
        status: error?.status || 500,
      });
    }
  }

  console.error("Transcript fetch failed", {
    failures,
    stage: ERROR_STAGES.youtubeTranscriptFetch,
    videoId,
  });

  if (failures.length > 0 && failures.every((failure) => failure.status === 429)) {
    throw apiError(
      429,
      "youtube_rate_limited",
      "YouTube is rate-limiting transcript requests right now. Please try again later.",
      ERROR_STAGES.youtubeTranscriptFetch,
      true,
    );
  }

  if (failures.length > 0 && failures.every((failure) => failure.status === 422)) {
    throw apiError(
      422,
      "transcript_empty",
      "The transcript was empty for this video.",
      ERROR_STAGES.youtubeTranscriptFetch,
      false,
    );
  }

  throw apiError(
    502,
    "transcript_fetch_failed",
    "Failed to fetch the YouTube transcript.",
    ERROR_STAGES.youtubeTranscriptFetch,
    true,
  );
}

async function fetchTranscriptTracksViaInnerTube(videoId) {
  try {
    const response = await fetch(INNER_TUBE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": INNER_TUBE_USER_AGENT,
      },
      body: JSON.stringify({
        context: INNER_TUBE_CONTEXT,
        videoId,
      }),
    });

    if (!response.ok) {
      console.warn("YouTube InnerTube lookup failed", {
        stage: ERROR_STAGES.youtubeTrackLookup,
        upstreamStatus: response.status,
        videoId,
      });
      return null;
    }

    const data = await response.json();
    return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
  } catch (error) {
    console.warn("YouTube InnerTube lookup threw", {
      message: error instanceof Error ? error.message : "Unknown InnerTube lookup error.",
      stage: ERROR_STAGES.youtubeTrackLookup,
      videoId,
    });
    return null;
  }
}

async function fetchTranscriptTracksViaWatchPage(videoId, youtubeUrl) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": WEB_USER_AGENT,
    },
  });

  if (!response.ok) {
    console.error("YouTube watch page lookup failed", {
      stage: ERROR_STAGES.youtubeTrackLookup,
      upstreamStatus: response.status,
      videoId,
    });
    throw apiError(
      502,
      "youtube_track_lookup_failed",
      "YouTube transcript metadata could not be fetched right now.",
      ERROR_STAGES.youtubeTrackLookup,
      true,
    );
  }

  const html = await response.text();

  if (html.includes('class="g-recaptcha"')) {
    console.warn("YouTube watch page was rate limited", {
      stage: ERROR_STAGES.youtubeTrackLookup,
      videoId,
    });
    throw apiError(
      429,
      "youtube_rate_limited",
      "YouTube is rate-limiting transcript requests right now. Please try again later.",
      ERROR_STAGES.youtubeTrackLookup,
      true,
    );
  }

  if (!html.includes('"playabilityStatus":')) {
    throw apiError(
      404,
      "video_not_available",
      `The video is no longer available (${youtubeUrl}).`,
      ERROR_STAGES.youtubeTrackLookup,
      false,
    );
  }

  const playerResponse = parseInlineJson(html, "ytInitialPlayerResponse");
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw apiError(
      422,
      "transcripts_disabled",
      "Transcripts are disabled for this video.",
      ERROR_STAGES.youtubeTrackLookup,
      false,
    );
  }

  return tracks;
}

function selectPreferredTranscriptTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  return [...tracks].sort((left, right) => {
    const leftPriority = transcriptTrackPriority(left);
    const rightPriority = transcriptTrackPriority(right);

    for (let index = 0; index < leftPriority.length; index += 1) {
      if (leftPriority[index] !== rightPriority[index]) {
        return leftPriority[index] - rightPriority[index];
      }
    }

    return 0;
  })[0];
}

function transcriptTrackPriority(track) {
  const languageCode = track?.languageCode || "";
  const isEnglish = languageCode.startsWith("en");
  const isAutoGenerated = track?.kind === "asr";

  if (isEnglish && !isAutoGenerated) {
    return [0, 0];
  }
  if (!isEnglish && !isAutoGenerated) {
    return [1, 0];
  }
  if (isEnglish && isAutoGenerated) {
    return [2, 0];
  }
  return [3, 0];
}

function buildTranscriptFetchCandidates(track) {
  if (!track?.baseUrl) {
    return [];
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(track.baseUrl);
  } catch {
    return [];
  }

  if (!parsedUrl.hostname.endsWith(".youtube.com")) {
    return [];
  }

  const candidates = [];
  const formats = ["srv3", "json3"];
  const shouldTranslateToEnglish =
    track.languageCode && track.languageCode !== "en" && track.isTranslatable;

  for (const format of formats) {
    const candidate = new URL(parsedUrl.toString());
    candidate.searchParams.set("fmt", format);

    if (shouldTranslateToEnglish) {
      candidate.searchParams.set("tlang", "en");
    }

    candidates.push({
      format,
      url: candidate.toString(),
    });
  }

  return candidates;
}

async function fetchTranscriptTextFromTrack(track, videoId) {
  const candidateResults = [];

  for (const candidate of buildTranscriptFetchCandidates(track)) {
    const response = await fetch(candidate.url, {
      headers: {
        "User-Agent": WEB_USER_AGENT,
      },
    });

    if (!response.ok) {
      candidateResults.push({
        format: candidate.format,
        ok: false,
        status: response.status,
      });
      continue;
    }

    const body = await response.text();
    const transcriptText =
      candidate.format === "json3"
        ? parseTranscriptJson3(body)
        : parseTranscriptXml(body);

    candidateResults.push({
      format: candidate.format,
      ok: true,
      status: response.status,
      transcriptLength: transcriptText.length,
    });

    if (transcriptText) {
      return transcriptText;
    }
  }

  console.warn("Transcript candidate fetch failed", {
    candidateResults,
    languageCode: track?.languageCode || null,
    kind: track?.kind || null,
    stage: ERROR_STAGES.youtubeTranscriptFetch,
    videoId,
  });

  if (candidateResults.length === 0) {
    throw apiError(
      422,
      "transcript_not_found",
      "No transcript was found for this video.",
      ERROR_STAGES.youtubeTranscriptFetch,
      false,
    );
  }

  const statuses = candidateResults
    .map((candidate) => candidate.status)
    .filter(Number.isFinite);

  if (statuses.length > 0 && statuses.every((status) => status === 429)) {
    throw apiError(
      429,
      "youtube_rate_limited",
      "YouTube is rate-limiting transcript requests right now. Please try again later.",
      ERROR_STAGES.youtubeTranscriptFetch,
      true,
    );
  }

  if (
    candidateResults.every(
      (candidate) => candidate.ok === true && candidate.transcriptLength === 0,
    )
  ) {
    throw apiError(
      422,
      "transcript_empty",
      "The transcript was empty for this video.",
      ERROR_STAGES.youtubeTranscriptFetch,
      false,
    );
  }

  throw apiError(
    502,
    "transcript_fetch_failed",
    "Failed to fetch the YouTube transcript.",
    ERROR_STAGES.youtubeTranscriptFetch,
    true,
  );
}

function parseInlineJson(html, variableName) {
  const marker = `var ${variableName} = `;
  const start = html.indexOf(marker);
  if (start === -1) {
    return null;
  }

  const jsonStart = start + marker.length;
  let depth = 0;

  for (let index = jsonStart; index < html.length; index += 1) {
    if (html[index] === "{") {
      depth += 1;
    } else if (html[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function parseTranscriptXml(xml) {
  const paragraphPattern = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  const segmentPattern = /<s[^>]*>([^<]*)<\/s>/g;
  const textSegments = [];

  for (const match of xml.matchAll(paragraphPattern)) {
    const content = match[3];
    let text = "";

    for (const segment of content.matchAll(segmentPattern)) {
      text += segment[1];
    }

    if (!text) {
      text = content.replace(/<[^>]+>/g, "");
    }

    text = decodeEntities(text).trim();
    if (text) {
      textSegments.push(text);
    }
  }

  if (textSegments.length === 0) {
    const textPattern = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
    for (const match of xml.matchAll(textPattern)) {
      const text = decodeEntities(match[3]).trim();
      if (text) {
        textSegments.push(text);
      }
    }
  }

  return textSegments.join(" ").trim();
}

function parseTranscriptJson3(jsonText) {
  let data;

  try {
    data = JSON.parse(jsonText);
  } catch {
    return "";
  }

  const textSegments = [];
  for (const event of data?.events || []) {
    const segmentText = (event?.segs || [])
      .map((segment) => segment?.utf8 || "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    if (segmentText) {
      textSegments.push(segmentText);
    }
  }

  return textSegments.join(" ").trim();
}

function decodeEntities(text) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, value) =>
      String.fromCodePoint(Number.parseInt(value, 16)),
    )
    .replace(/&#(\d+);/g, (_, value) =>
      String.fromCodePoint(Number.parseInt(value, 10)),
    );
}

async function summarizeTranscript(transcriptText, env) {
  const apiKey =
    typeof env.OPENAI_API_KEY === "string" ? env.OPENAI_API_KEY.trim() : "";

  if (!apiKey) {
    throw apiError(
      500,
      "llm_not_available",
      "OPENAI_API_KEY is missing from the environment.",
      ERROR_STAGES.openAiSummary,
      false,
    );
  }

  let response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        instructions: SUMMARY_PROMPT,
        input: transcriptText,
        text: {
          verbosity: "medium",
        },
      }),
    });
  } catch (error) {
    console.error("OpenAI summarization request failed", {
      message: error instanceof Error ? error.message : "Unknown OpenAI request failure.",
      stage: ERROR_STAGES.openAiSummary,
    });
    throw apiError(
      503,
      "llm_not_available",
      "The summarization model is currently unavailable.",
      ERROR_STAGES.openAiSummary,
      true,
    );
  }

  if (!response.ok) {
    console.error("OpenAI summarization returned a non-OK response", {
      stage: ERROR_STAGES.openAiSummary,
      upstreamStatus: response.status,
    });
    throw apiError(
      response.status === 429 || response.status >= 500 ? 503 : 502,
      "llm_not_available",
      "The summarization model is currently unavailable.",
      ERROR_STAGES.openAiSummary,
      response.status === 429 || response.status >= 500,
    );
  }

  const data = await response.json();
  const summary = extractResponseOutputText(data);

  if (!summary) {
    throw apiError(
      502,
      "llm_empty_response",
      "OpenAI returned an empty summary.",
      ERROR_STAGES.openAiSummary,
      false,
    );
  }

  return summary;
}

function extractResponseOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const content = Array.isArray(data?.output) ? data.output : [];
  const text = content
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .filter((part) => part?.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text;
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(request, data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
      ...(init.headers || {}),
    },
  });
}

function errorResponse(request, error) {
  const detail = createErrorDetail(error);
  return jsonResponse(
    request,
    { detail },
    {
      status: detail.status,
    },
  );
}

function createErrorDetail(error) {
  if (error && typeof error === "object" && "errorCode" in error) {
    return {
      message: error.message || "Unexpected backend failure.",
      error_code: error.errorCode || "unexpected_backend_failure",
      retryable: Boolean(error.retryable),
      stage: error.stage || ERROR_STAGES.requestValidation,
      status: error.status || 500,
    };
  }

  return {
    message:
      error instanceof Error && error.message
        ? error.message
        : "Unexpected backend failure.",
    error_code: "unexpected_backend_failure",
    retryable: false,
    stage: ERROR_STAGES.requestValidation,
    status: 500,
  };
}

function apiError(status, errorCode, message, stage, retryable) {
  return Object.assign(new Error(message), {
    errorCode,
    retryable,
    stage,
    status,
  });
}
