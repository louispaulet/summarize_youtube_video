# AGENTS.md

## Project Overview
- This repository is a monorepo for a simple YouTube video summarizer.
- `frontend/` contains the Vite + React + Tailwind UI.
- `worker/` contains the Cloudflare Worker API that fetches transcripts and generates summaries.

## Local Development
- Frontend port is fixed to `5173`.
- Worker port is fixed to `8787`.
- Use Chrome MCP for quick end-to-end checks against the deployed app:
  - frontend: `https://louispaulet.github.io/summarize_youtube_video/`
  - worker: `https://summarize-youtube-video-backend.louispaulet13.workers.dev/api/summarize`
- Preferred commands:
  - `make frontend`
  - `make worker`
  - `make up`

## Backend Rules
- The only backend is the Cloudflare Worker in `worker/`.
- Read `OPENAI_API_KEY` from environment variables only.
- Never hardcode or commit secrets, tokens, or `.env` files.
- Keep the API contract simple:
  - `POST /api/summarize`
  - Request: `{ "youtube_url": "..." }`
  - Response: `{ "summary_markdown": "...", "video_id": "..." }`
- The project works locally, but the deployed Worker is currently blocked by YouTube when it tries to retrieve transcripts from Cloudflare IPs. Treat the deployed version as unavailable for now.
- Because the same flow succeeds locally, a fix may or may not come later; the failure appears deployment-origin specific rather than a frontend issue.

## Frontend Rules
- The frontend is a single-page app with no routing.
- It should submit one YouTube URL and render returned Markdown cleanly.
- Keep the local developer experience simple and preserve fixed localhost ports.

## Change Expectations
- Before significant changes, run the relevant checks for the area you touched.
- Prefer small, readable changes over heavy abstraction.
- After completing a change, always commit and push it unless the user explicitly says not to.
- Preserve the deployment split:
  - frontend deploys to GitHub Pages
  - worker deploys to a separate host
