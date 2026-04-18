SHELL := /bin/bash

.PHONY: frontend backend up

frontend:
	cd frontend && npm install && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort

backend:
	cd backend && python3 -m uv sync && python3 -m uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

up:
	@trap 'kill 0' EXIT; $(MAKE) backend & $(MAKE) frontend & wait
