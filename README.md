# logsleuth

A small log-analysis webapp (backend + Next frontend) with optional AI summarization. This README explains how to clone, configure environment variables, and run the project locally using Docker or directly with pnpm.

## Table of contents

- Overview
- Requirements
- Quick start (Docker Compose)
- Run locally without Docker
- Environment variables
- PowerShell examples
- Security: API keys and rotation
- Troubleshooting
- Next steps

## Overview

This repository contains two main services:
- backend (Node.js + TypeScript, Express, Prisma)
- frontend (Next.js App Router)

The project is configured with multi-stage Dockerfiles and an `infra/docker-compose.yml` for local development.

## Requirements

- Git
- Docker & Docker Compose
- Node 18+ (only needed if you run without Docker)
- pnpm (optional: `npm i -g pnpm@9`)

## Quick start (Docker Compose)

1. Clone the repository:

```powershell
git clone https://github.com/<your-user>/logsleuth.git
cd logsleuth
```

2. Create a `backend/.env` file (see Environment variables below). Example:

```properties
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
UPLOAD_DIR=./data/uploads
OPENAI_API_KEY=sk-REPLACE_ME
OPENAI_MODEL=gpt-4o-mini
DATABASE_URL=postgresql://logsleuth:logsleuth@postgres:5432/logsleuth
JWT_SECRET=devsecret
```

3. Start the stack (from repo root):

```powershell
docker-compose -f infra\docker-compose.yml up -d --build
docker-compose -f infra\docker-compose.yml logs --tail=200 -f backend
```

4. Open the frontend: http://localhost:3000

Notes:
- The compose file is configured to use the built images (no host mounts) to avoid node_modules/.next mismatches.
- If you want development hot reload, see the "Run locally without Docker" section.

## Run locally without Docker (recommended for active development)

1. Install dependencies (repo root or individually in `backend` and `frontend`).

```powershell
# install pnpm if you don't have it
npm install -g pnpm@9

# install all workspace deps
pnpm install

# build backend and frontend
cd backend; pnpm run build; cd ../frontend; pnpm run build
```

2. Run services in dev mode:

```powershell
# backend (dev with ts-node-dev)
cd backend
pnpm run dev

# frontend (dev)
cd ../frontend
pnpm run dev
```

## Environment variables

Create `backend/.env` with the following (example values shown):

- PORT — port for backend (default 4000)
- FRONTEND_ORIGIN — frontend origin allowed for CORS
- UPLOAD_DIR — where uploads are stored inside container (default `./data/uploads`)
- OPENAI_API_KEY — your OpenAI API key (DO NOT commit this to git)
- OPENAI_MODEL — model name (e.g. `gpt-4o-mini`)
- DATABASE_URL — Prisma/Postgres connection string
- JWT_SECRET — secret for signing tokens

Important: never commit `.env` to your repository. Use `env_file` in compose or platform secrets in production.

## PowerShell examples (Windows)

Create `backend/.env` from PowerShell using here-string (safe and simple):

```powershell
@"
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
UPLOAD_DIR=./data/uploads
OPENAI_API_KEY=sk-REPLACE_ME
OPENAI_MODEL=gpt-4o-mini
DATABASE_URL=postgresql://logsleuth:logsleuth@postgres:5432/logsleuth
JWT_SECRET=devsecret
"@ > backend\.env
```

Start the stack:

```powershell
docker-compose -f infra\docker-compose.yml up -d --build
```

Check backend logs:

```powershell
docker-compose -f infra\docker-compose.yml logs --tail=200 -f backend
```

## Security: API keys and rotation

- Treat your OpenAI key as a secret. If it is ever shown in screenshots/chat/attachments, revoke it immediately and create a new key in the OpenAI dashboard.
- Never commit keys to git. Use a secrets manager for production (AWS/GCP/Azure secrets, GitHub Actions secrets, Docker secrets, etc.).
- If a key was committed historically, remove it from history with `git-filter-repo` or BFG, and force-push (coordinate with collaborators).

## Troubleshooting (encountered issues)

- "Cannot find module 'dotenv'" or other runtime module errors inside containers: ensure the Dockerfile installs production dependencies in the final image or copies node_modules from builder.
- Prisma: if you see `@prisma/client did not initialize yet`, ensure `pnpm prisma generate` runs during build. We generate during the Docker build in the backend Dockerfile.
- Upload permission errors (EACCES mkdir './data'): ensure `/app/data/uploads` exists and is owned by the runtime user. The backend Dockerfile creates and chowns this directory.
- Next build errors (lint/types): If Next fails during docker build, run `pnpm run build` locally to see and fix lint/type issues.

## Rotating a leaked key (quick steps)

1. Revoke the key on the OpenAI dashboard.
2. Create a new key.
3. Replace `OPENAI_API_KEY` in `backend/.env` with the new key.
4. Restart the backend container:

```powershell
docker-compose -f infra\docker-compose.yml restart backend
```

## Purging a secret from history (only if needed)

Use `git-filter-repo` (preferred) or BFG to remove files from history. This rewrites history and requires a force-push and coordination. Example with `git-filter-repo`:

```bash
# remove backend/.env from history
git filter-repo --path backend/.env --invert-paths
# then force-push
git push --force --all
git push --force --tags
```

## Next steps I can help with

- Add a `README` section with deployment instructions (cloud provider specific).
- Create named Docker volumes for uploads and node_modules to make local dev faster.
- Add CI pipelines that use secrets from GitHub Actions or similar.

---

If you want, I can commit this README and push it to `origin/main`. Say “Commit and push README” and I will create the file, commit, and push. Otherwise I will leave it for you to review locally.
