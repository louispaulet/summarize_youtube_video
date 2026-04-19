SHELL := /bin/bash

.PHONY: help frontend backend worker up deploy deploy-frontend deploy-worker

help:
	@printf "Available targets:\n"
	@printf "  make frontend        Start the Vite frontend on http://localhost:5173\n"
	@printf "  make backend         Start the FastAPI backend on http://localhost:8000\n"
	@printf "  make worker          Start the Cloudflare Worker locally with Wrangler\n"
	@printf "  make up              Start frontend and backend together\n"
	@printf "  make deploy          Deploy the frontend to GitHub Pages\n"
	@printf "  make deploy-frontend Deploy the frontend to GitHub Pages\n"
	@printf "  make deploy-worker   Deploy the Cloudflare Worker\n"

frontend:
	cd frontend && npm install && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort

backend:
	cd backend && python3 -m uv sync && python3 -m uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker:
	cd worker && npm install && npm run dev

up:
	@trap 'kill 0' EXIT; $(MAKE) backend & $(MAKE) frontend & wait

deploy: deploy-frontend

deploy-frontend:
	cd frontend && npm install && npm run deploy

deploy-worker:
	cd worker && npm install && npm run deploy
