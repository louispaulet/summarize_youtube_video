import { getTranscriptDebugReport } from "../src/manual-debug.js";

const urls = process.argv.slice(2);

if (urls.length === 0) {
  console.error("Usage: node scripts/check-transcript.mjs <youtube-url> [...]");
  process.exit(1);
}

for (const youtubeUrl of urls) {
  const report = await getTranscriptDebugReport(youtubeUrl);
  console.log(JSON.stringify(report, null, 2));
}
