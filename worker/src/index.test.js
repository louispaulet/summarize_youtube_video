import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTranscriptFetchCandidates,
  extractVideoId,
  parseTranscriptJson3,
  parseTranscriptXml,
  selectPreferredTranscriptTrack,
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
    { languageCode: "fr", isTranslatable: true, baseUrl: "https://www.youtube.com/api/timedtext?v=1" },
    { languageCode: "en", kind: "asr", baseUrl: "https://www.youtube.com/api/timedtext?v=2" },
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
  const xml = '<transcript><text start="0" dur="1">Hello &amp; welcome</text><text start="1" dur="1">world</text></transcript>';
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
