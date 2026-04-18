# YouTube Video Summarizer

A small monorepo app that takes a YouTube URL, fetches the transcript, sends it to `gpt-5-nano`, and displays a polished Markdown summary in the browser.

## Architecture
- `frontend/`: Vite + React JS + Tailwind CSS app
- `backend/`: FastAPI app managed with `uv`
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
Create the backend env file from the example:

```bash
cp backend/.env.example backend/.env
```

Then set:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

The frontend can optionally use its own env file:

```bash
cp frontend/.env.example frontend/.env
```

Default local API URL:

```env
VITE_API_BASE_URL=http://localhost:8000
```

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

## Backend Hosting Options
Recommended options for later:

1. Render: easiest low-cost option for a simple FastAPI app and easy env var management.
2. Railway: simple developer experience and affordable for small hobby services.
3. Fly.io: a good option if you want a bit more infra control and are comfortable with a slightly more hands-on setup.

If you want the easiest path later, Render is the best starting point.
