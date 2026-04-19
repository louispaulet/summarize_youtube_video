# YouTube Video Summarizer

A small monorepo app that takes a YouTube URL, fetches the transcript through a Cloudflare Worker, sends it to `gpt-5-nano`, and displays a polished Markdown summary in the browser.

## Architecture
- `frontend/`: Vite + React + Tailwind single-page app
- `worker/`: Cloudflare Worker that owns the only backend API
- `Makefile`: local developer entrypoints for frontend, Worker, and deploys

## Why the Worker matters
- Local development and production now share the same backend implementation.
- `make up` validates the same Worker path that GitHub Pages uses in production.
- The prior FastAPI backend has been removed so there is no split local-vs-prod backend behavior left in the repo.

## Prerequisites
- Node.js and npm
- A repo-level `.env` file with:

```env
OPENAI_API_KEY=your_openai_api_key_here
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
```

Create it from the example if needed:

```bash
cp .env.example .env
```

## Frontend Environment
Create the frontend env file if you want an explicit local override:

```bash
cp frontend/.env.example frontend/.env
```

Local default:

```env
VITE_API_BASE_URL=http://localhost:8787
```

Production builds already point to the deployed Worker through [frontend/.env.production](/Users/louispaulet/Documents/projects/summarize_youtube_video/frontend/.env.production).

## Make Commands
- `make frontend`: start the Vite frontend on `http://localhost:5173`
- `make worker`: start the Cloudflare Worker locally on `http://localhost:8787`
- `make up`: start frontend and Worker together
- `make kill`: stop local frontend and Worker processes
- `make deploy`: deploy the frontend to GitHub Pages
- `make deploy-frontend`: explicit frontend deploy target
- `make deploy-worker`: deploy the Cloudflare Worker

## Local Development
Run the full local stack:

```bash
make up
```

Fixed local URLs:
- Frontend: `http://localhost:5173`
- Worker API: `http://localhost:8787`

Local smoke checks:

```bash
curl http://localhost:8787/health
curl -X POST http://localhost:8787/api/summarize \
  -H 'Content-Type: application/json' \
  --data '{"youtube_url":"https://www.youtube.com/watch?v=jjp3WC8Unj8"}'
```

Then open `http://localhost:5173` and submit a YouTube URL through the UI.

## API Overview
Endpoint:

```http
POST /api/summarize
Content-Type: application/json
```

Request body:

```json
{
  "youtube_url": "https://www.youtube.com/watch?v=..."
}
```

Success response:

```json
{
  "summary_markdown": "- Executive takeaway 1\n- Executive takeaway 2\n- Executive takeaway 3\n\nIntro paragraph...\n\nDevelopment paragraph...\n\nConclusion paragraph...",
  "video_id": "abc123xyz"
}
```

Error response:

```json
{
  "detail": {
    "message": "Failed to fetch the YouTube transcript.",
    "error_code": "transcript_fetch_failed",
    "status": 502,
    "stage": "youtube_transcript_fetch",
    "retryable": true
  }
}
```

Stages:
- `request_validation`
- `youtube_track_lookup`
- `youtube_transcript_fetch`
- `openai_summary`

## Frontend Deployment
The frontend is configured for GitHub Pages using `gh-pages`.

Typical deploy flow:

```bash
cd frontend
npm install
npm run deploy
```

## Worker Deployment
The Worker exposes:
- `GET /health`
- `POST /api/summarize`

Current deployed Worker:
- [summarize-youtube-video-backend.louispaulet13.workers.dev](https://summarize-youtube-video-backend.louispaulet13.workers.dev)

Typical deploy flow:

```bash
make deploy-worker
```

`worker/scripts/deploy.mjs` reads `OPENAI_API_KEY` and `CLOUDFLARE_API_TOKEN` from the shared repo-level `.env`, updates the Worker secret in Cloudflare, and deploys the Worker.

## Production failure note
If a video works locally but fails from the deployed Worker, that usually means the environment changed rather than the UI. For `https://www.youtube.com/watch?v=jjp3WC8Unj8`, the deployed Worker currently returns:

```json
{"detail":{"message":"Failed to fetch the YouTube transcript.","error_code":"transcript_fetch_failed","status":502,"stage":"youtube_transcript_fetch","retryable":true}}
```

The same transcript-fetch logic succeeds from this local machine, which makes the failure environment-dependent. The most likely explanation is that YouTube treats the Worker’s network origin differently and blocks or rate-limits transcript access there. We should describe that as likely network-origin/IP blocking or rate-limiting, not as a proven single-datacenter root cause.
