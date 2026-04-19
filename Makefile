SHELL := /bin/bash

WORKER_PORT := 8787

.PHONY: help frontend worker up kill deploy deploy-frontend deploy-worker

help:
	@printf "Available targets:\n"
	@printf "  make frontend        Start the Vite frontend on http://localhost:5173\n"
	@printf "  make worker          Start the Cloudflare Worker locally with Wrangler\n"
	@printf "  make up              Start frontend and Worker together\n"
	@printf "  make kill            Stop local frontend and Worker processes\n"
	@printf "  make deploy          Deploy the frontend to GitHub Pages\n"
	@printf "  make deploy-frontend Deploy the frontend to GitHub Pages\n"
	@printf "  make deploy-worker   Deploy the Cloudflare Worker\n"

frontend:
	cd frontend && npm install && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort

worker:
	cd worker && npm install && npm run dev

up:
	@trap 'kill 0' EXIT; $(MAKE) worker & $(MAKE) frontend & wait

kill:
	@pids=$$(lsof -ti -iTCP:5173 -iTCP:$(WORKER_PORT) -sTCP:LISTEN); \
	if [ -n "$$pids" ]; then \
		kill $$pids; \
		echo "Stopped processes on ports 5173 and $(WORKER_PORT)"; \
	else \
		echo "No frontend or Worker process found on ports 5173 or $(WORKER_PORT)"; \
	fi

deploy: deploy-frontend

deploy-frontend:
	cd frontend && npm install && npm run deploy

deploy-worker:
	cd worker && npm install && npm run deploy
