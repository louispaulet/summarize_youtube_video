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

    return jsonResponse(
      request,
      { detail: "Not found." },
      { status: 404 },
    );
  },
};

export {
  buildTranscriptFetchCandidates,
  decodeEntities,
  extractVideoId,
  parseInlineJson,
  parseTranscriptJson3,
  parseTranscriptXml,
  selectPreferredTranscriptTrack,
};

async function handleSummarize(request, env) {
  let payload;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      request,
      { detail: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const youtubeUrl =
    typeof payload?.youtube_url === "string" ? payload.youtube_url.trim() : "";

  if (!youtubeUrl) {
    return jsonResponse(
      request,
      { detail: "Please provide a YouTube URL." },
      { status: 400 },
    );
  }

  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    return jsonResponse(
      request,
      {
        detail:
          "Please provide a valid YouTube watch, short, embed, or youtu.be URL.",
      },
      { status: 400 },
    );
  }

  try {
    const transcriptText = await getTranscriptText(videoId, youtubeUrl);
    const summaryMarkdown = await summarizeTranscript(transcriptText, env);

    return jsonResponse(request, {
      summary_markdown: summaryMarkdown,
      video_id: videoId,
    });
  } catch (error) {
    return jsonResponse(
      request,
      { detail: error.message || "Unexpected backend failure." },
      { status: error.status || 500 },
    );
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
  const tracks =
    (await fetchTranscriptTracksViaInnerTube(videoId)) ||
    (await fetchTranscriptTracksViaWatchPage(videoId, youtubeUrl));

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw httpError(422, "No transcript was found for this video.");
  }

  const preferredTrack = selectPreferredTranscriptTrack(tracks);
  const preferredTracks = [
    preferredTrack,
    ...tracks.filter((track) => track !== preferredTrack),
  ].filter(Boolean);

  const failures = [];

  for (const track of preferredTracks) {
    try {
      const transcriptText = await fetchTranscriptTextFromTrack(track);
      if (transcriptText) {
        return transcriptText;
      }
    } catch (error) {
      failures.push({
        languageCode: track?.languageCode || null,
        kind: track?.kind || null,
        message: error.message || "Unknown transcript fetch failure.",
        status: error.status || 500,
      });
    }
  }

  console.error("Transcript fetch failed", {
    failures,
    videoId,
  });

  if (failures.length > 0 && failures.every((failure) => failure.status === 429)) {
    throw httpError(
      429,
      "YouTube is rate-limiting transcript requests right now. Please try again later.",
    );
  }

  throw httpError(502, "Failed to fetch the YouTube transcript.");
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
      return null;
    }

    const data = await response.json();
    return data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
  } catch {
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
    throw httpError(502, "Failed to fetch the YouTube transcript.");
  }

  const html = await response.text();

  if (html.includes('class="g-recaptcha"')) {
    throw httpError(
      429,
      "YouTube is rate-limiting transcript requests right now. Please try again later.",
    );
  }

  if (!html.includes('"playabilityStatus":')) {
    throw httpError(404, `The video is no longer available (${youtubeUrl}).`);
  }

  const playerResponse = parseInlineJson(html, "ytInitialPlayerResponse");
  const tracks =
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw httpError(422, "Transcripts are disabled for this video.");
  }

  return tracks;
}

function selectPreferredTranscriptTrack(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return null;
  }

  return (
    tracks.find(
      (track) =>
        track?.languageCode === "en" && track?.kind !== "asr",
    ) ||
    tracks.find((track) => track?.languageCode === "en") ||
    tracks.find((track) => track?.isTranslatable) ||
    tracks[0]
  );
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

async function fetchTranscriptTextFromTrack(track) {
  const failures = [];

  for (const candidate of buildTranscriptFetchCandidates(track)) {
    const response = await fetch(candidate.url, {
      headers: {
        "User-Agent": WEB_USER_AGENT,
      },
    });

    if (!response.ok) {
      failures.push(`${candidate.format}:${response.status}`);
      continue;
    }

    const body = await response.text();
    const transcriptText =
      candidate.format === "json3"
        ? parseTranscriptJson3(body)
        : parseTranscriptXml(body);

    if (transcriptText) {
      return transcriptText;
    }

    failures.push(`${candidate.format}:empty`);
  }

  const statuses = failures
    .map((failure) => Number.parseInt(failure.split(":")[1] || "", 10))
    .filter(Number.isFinite);
  const status =
    statuses.length > 0 && statuses.every((value) => value === 429) ? 429 : 502;

  throw httpError(
    status,
    `Failed to fetch the YouTube transcript (${failures.join(", ") || "no candidates"}).`,
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
  if (!env.AI || typeof env.AI.run !== "function") {
    throw httpError(500, "Cloudflare AI binding is missing.");
  }

  const response = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", {
    messages: [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: transcriptText },
    ],
    max_tokens: 1200,
    temperature: 0.2,
  });

  const summary =
    typeof response?.response === "string"
      ? response.response.trim()
      : typeof response?.result?.response === "string"
        ? response.result.response.trim()
        : "";

  if (!summary) {
    throw httpError(502, "Cloudflare AI returned an empty summary.");
  }

  return summary;
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

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
