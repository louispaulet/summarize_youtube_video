# YouTube Video Summarizer

A small monorepo app that takes a YouTube URL, fetches the transcript, sends it to `gpt-5-nano`, and displays a polished Markdown summary in the browser.

## Architecture
- `frontend/`: Vite + React JS + Tailwind CSS app
- `backend/`: FastAPI app managed with `uv`
- `worker/`: Cloudflare Worker deployment target that preserves the same API contract
- `Makefile`: local developer entrypoints for frontend, backend, and full stack

## Monorepo Layout
```text
.
├── AGENTS.md
├── Makefile
├── README.md
├── backend
│   ├── .env.example
│   ├── pyproject.toml
│   └── app
│       └── main.py
└── frontend
    ├── .env.example
    ├── package.json
    ├── src
    │   ├── App.jsx
    │   ├── index.css
    │   └── main.jsx
    └── vite.config.js
```

## Prerequisites
- Node.js and npm
- Python 3.9+
- `uv`

Install `uv` if needed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Environment Setup
Create the shared repo env file from the example:

```bash
cp .env.example .env
```

Then set your OpenAI key:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

The backend will read this shared `.env` automatically in local development.

The frontend can optionally use its own env file:

```bash
cp frontend/.env.example frontend/.env
```

Default local API URL:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Production frontend builds read [frontend/.env.production](/Users/louispaulet/Documents/projects/summarize_youtube_video/frontend/.env.production), which is set to the deployed Cloudflare Worker backend URL.

## Local Development
Run only the frontend:

```bash
make frontend
```

Run only the backend:

```bash
make backend
```

Run the full stack:

```bash
make up
```

Fixed local URLs:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

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

Response body:

```json
{
  "summary_markdown": "- Executive takeaway 1\n- Executive takeaway 2\n- Executive takeaway 3\n\nIntro paragraph...\n\nDevelopment paragraph...\n\nConclusion paragraph...",
  "video_id": "abc123xyz"
}
```

## Frontend Deployment
The frontend is configured for GitHub Pages using `gh-pages`.

Typical deploy flow:

```bash
cd frontend
npm run deploy
```

The deploy script currently assumes the repository name is `summarize_youtube_video`. If the GitHub repo name changes, update the `build:gh-pages` script in [frontend/package.json](/Users/louispaulet/Documents/projects/summarize_youtube_video/frontend/package.json).

## Cloudflare Worker Deployment
The repository now includes a Worker implementation in [worker/src/index.js](/Users/louispaulet/Documents/projects/summarize_youtube_video/worker/src/index.js) that exposes the same backend contract:

- `GET /health`
- `POST /api/summarize`

Current deployed Worker:

- `https://summarize-youtube-video-backend.louispaulet13.workers.dev`

Useful Worker commands:

```bash
cd worker
npm install
npm run dev
npm run deploy
```

Notes:

- Local development still uses the FastAPI backend on `http://localhost:8000`.
- `npm run deploy` inside [worker/](/Users/louispaulet/Documents/projects/summarize_youtube_video/worker) now reads `OPENAI_API_KEY` from the shared repo-level `.env`, updates the Worker secret in Cloudflare, and then deploys.
- If you want the frontend to target the deployed Worker, set `VITE_API_BASE_URL=https://summarize-youtube-video-backend.louispaulet13.workers.dev`.
- GitHub Pages builds will already use that deployed backend automatically through [frontend/.env.production](/Users/louispaulet/Documents/projects/summarize_youtube_video/frontend/.env.production).
