import test from "node:test";
import assert from "node:assert/strict";

import worker, {
  apiError,
  buildTranscriptFetchCandidates,
  createErrorDetail,
  extractResponseOutputText,
  extractVideoId,
  parseTranscriptJson3,
  parseTranscriptXml,
  selectPreferredTranscriptTrack,
  summarizeTranscript,
  transcriptTrackPriority,
} from "./index.js";

test("extractVideoId supports watch and short URLs", () => {
  assert.equal(
    extractVideoId("https://www.youtube.com/watch?v=abc123xyz89"),
    "abc123xyz89",
  );
  assert.equal(
    extractVideoId("https://youtu.be/abc123xyz89"),
    "abc123xyz89",
  );
});

test("selectPreferredTranscriptTrack prefers non-ASR English tracks", () => {
  const track = selectPreferredTranscriptTrack([
    {
      languageCode: "fr",
      isTranslatable: true,
      baseUrl: "https://www.youtube.com/api/timedtext?v=1",
    },
    {
      languageCode: "en",
      kind: "asr",
      baseUrl: "https://www.youtube.com/api/timedtext?v=2",
    },
    { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?v=3" },
  ]);

  assert.equal(track.baseUrl, "https://www.youtube.com/api/timedtext?v=3");
});

test("transcriptTrackPriority matches english then manual then auto order", () => {
  const ranked = [
    { languageCode: "fr", kind: "asr" },
    { languageCode: "en", kind: "asr" },
    { languageCode: "fr" },
    { languageCode: "en" },
  ].sort((left, right) => {
    const leftPriority = transcriptTrackPriority(left);
    const rightPriority = transcriptTrackPriority(right);
    for (let index = 0; index < leftPriority.length; index += 1) {
      if (leftPriority[index] !== rightPriority[index]) {
        return leftPriority[index] - rightPriority[index];
      }
    }
    return 0;
  });

  assert.deepEqual(
    ranked.map((track) => [track.languageCode, track.kind === "asr"]),
    [["en", false], ["fr", false], ["en", true], ["fr", true]],
  );
});

test("buildTranscriptFetchCandidates adds json3 and English translation when possible", () => {
  const candidates = buildTranscriptFetchCandidates({
    baseUrl: "https://www.youtube.com/api/timedtext?v=abc&fmt=srv3",
    languageCode: "fr",
    isTranslatable: true,
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.format),
    ["srv3", "json3"],
  );
  assert.equal(new URL(candidates[0].url).searchParams.get("tlang"), "en");
});

test("parseTranscriptXml joins text segments", () => {
  const xml =
    '<transcript><text start="0" dur="1">Hello &amp; welcome</text><text start="1" dur="1">world</text></transcript>';
  assert.equal(parseTranscriptXml(xml), "Hello & welcome world");
});

test("parseTranscriptJson3 joins text segments", () => {
  const json = JSON.stringify({
    events: [
      { segs: [{ utf8: "Hello " }, { utf8: "world" }] },
      { segs: [{ utf8: "again" }] },
    ],
  });

  assert.equal(parseTranscriptJson3(json), "Hello world again");
});

test("createErrorDetail returns the public error contract", () => {
  assert.deepEqual(
    createErrorDetail(
      apiError(
        429,
        "youtube_rate_limited",
        "YouTube is rate-limiting transcript requests right now. Please try again later.",
        "youtube_transcript_fetch",
        true,
      ),
    ),
    {
      error_code: "youtube_rate_limited",
      message: "YouTube is rate-limiting transcript requests right now. Please try again later.",
      retryable: true,
      stage: "youtube_transcript_fetch",
      status: 429,
    },
  );
});

test("worker returns a structured error for invalid JSON", async () => {
  const request = new Request("https://example.com/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });

  const response = await worker.fetch(request, {});
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.deepEqual(payload.detail, {
    error_code: "request_body_invalid",
    message: "Request body must be valid JSON.",
    retryable: false,
    stage: "request_validation",
    status: 400,
  });
});

test("worker returns a structured error for an invalid YouTube URL", async () => {
  const request = new Request("https://example.com/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtube_url: "https://example.com/not-youtube" }),
  });

  const response = await worker.fetch(request, {});
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.detail.error_code, "youtube_url_invalid");
  assert.equal(payload.detail.stage, "request_validation");
});

test("worker returns a structured error for unknown routes", async () => {
  const response = await worker.fetch(new Request("https://example.com/nope"), {});
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.detail.error_code, "route_not_found");
  assert.equal(payload.detail.stage, "request_validation");
});

test("summarizeTranscript requires OPENAI_API_KEY", async () => {
  await assert.rejects(
    summarizeTranscript("transcript", {}),
    /OPENAI_API_KEY is missing from the environment\./,
  );
});

test("summarizeTranscript maps upstream failures to a structured availability error", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 429,
    async json() {
      return {};
    },
  });

  try {
    await assert.rejects(
      summarizeTranscript("transcript", { OPENAI_API_KEY: "test-key" }),
      (error) =>
        error?.status === 503 &&
        error?.errorCode === "llm_not_available" &&
        error?.stage === "openai_summary" &&
        error?.retryable === true,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("summarizeTranscript uses the OpenAI Responses API", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-key");

    const payload = JSON.parse(init.body);
    assert.equal(payload.model, "gpt-5-nano");
    assert.equal(payload.input, "transcript");

    return {
      ok: true,
      async json() {
        return {
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "Summary output" }],
            },
          ],
        };
      },
    };
  };

  try {
    const summary = await summarizeTranscript("transcript", {
      OPENAI_API_KEY: "test-key",
    });

    assert.equal(summary, "Summary output");
  } finally {
    global.fetch = originalFetch;
  }
});

test("extractResponseOutputText falls back to output content parts", () => {
  const summary = extractResponseOutputText({
    output: [
      { type: "reasoning", summary: [] },
      {
        type: "message",
        content: [
          { type: "output_text", text: "First paragraph." },
          { type: "output_text", text: "Second paragraph." },
        ],
      },
    ],
  });

  assert.equal(summary, "First paragraph.\n\nSecond paragraph.");
});
