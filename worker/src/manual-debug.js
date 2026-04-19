import {
  buildTranscriptFetchCandidates,
  extractVideoId,
  parseInlineJson,
  parseTranscriptJson3,
  parseTranscriptXml,
  selectPreferredTranscriptTrack,
} from "./index.js";

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

export async function getTranscriptDebugReport(youtubeUrl) {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) {
    return { youtubeUrl, error: "Invalid YouTube URL." };
  }

  const tracks =
    (await fetchTranscriptTracksViaInnerTube(videoId)) ||
    (await fetchTranscriptTracksViaWatchPage(videoId));

  const preferredTrack = selectPreferredTranscriptTrack(tracks || []);
  const candidateResults = [];

  for (const candidate of buildTranscriptFetchCandidates(preferredTrack)) {
    const response = await fetch(candidate.url, {
      headers: { "User-Agent": WEB_USER_AGENT },
    });
    const body = await response.text();
    const transcriptText =
      candidate.format === "json3"
        ? parseTranscriptJson3(body)
        : parseTranscriptXml(body);

    candidateResults.push({
      format: candidate.format,
      ok: response.ok,
      status: response.status,
      transcriptLength: transcriptText.length,
      url: candidate.url,
    });
  }

  return {
    candidateResults,
    preferredTrack,
    trackCount: tracks?.length || 0,
    videoId,
    youtubeUrl,
  };
}

async function fetchTranscriptTracksViaInnerTube(videoId) {
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
}

async function fetchTranscriptTracksViaWatchPage(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": WEB_USER_AGENT,
    },
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const playerResponse = parseInlineJson(html, "ytInitialPlayerResponse");
  return playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
}
