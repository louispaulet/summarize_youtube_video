# AGENTS.md

## Project Overview
- This repository is a monorepo for a simple YouTube video summarizer.
- `frontend/` contains the Vite + React + Tailwind UI.
- `backend/` contains the FastAPI API that fetches transcripts and generates summaries.

## Local Development
- Frontend port is fixed to `5173`.
- Backend port is fixed to `8000`.
- Preferred commands:
  - `make frontend`
  - `make backend`
  - `make up`

## Backend Rules
- Use `uv` for Python dependency and runtime management.
- Read `OPENAI_API_KEY` from environment variables only.
- Never hardcode or commit secrets, tokens, or `.env` files.
- Keep the API contract simple:
  - `POST /api/summarize`
  - Request: `{ "youtube_url": "..." }`
  - Response: `{ "summary_markdown": "...", "video_id": "..." }`

## Frontend Rules
- The frontend is a single-page app with no routing.
- It should submit one YouTube URL and render returned Markdown cleanly.
- Keep the local developer experience simple and preserve fixed localhost ports.

## Change Expectations
- Before significant changes, run the relevant checks for the area you touched.
- Prefer small, readable changes over heavy abstraction.
- Preserve the deployment split:
  - frontend deploys to GitHub Pages
  - backend deploys to a separate host
