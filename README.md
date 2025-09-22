# LogSleuth — log ingestion, analytics and AI summaries

LogSleuth is a compact full-stack application for ingesting, parsing and analyzing HTTP access logs. It includes a Next.js frontend for uploading and viewing logs, and a TypeScript/Express backend that parses logs, stores normalized records in PostgreSQL via Prisma, and exposes analytics and AI-assisted summarization endpoints.

This README documents the system design, features, local development, deployment reference (Google Cloud Run), secrets and the production fixes applied during deployment and debugging.

Table of contents

- Introduction
- System design and components
- Key capabilities
- Changes and fixes applied (detailed)
- Local development (step-by-step)
  - Prerequisites
  - Install
  - Environment variables / secrets
  - Database & Prisma (migrations)
  - Start backend and frontend
- Running E2E smoke tests (auth + AI)
- Deploying to Google Cloud Run (reference)
- Security, secrets and best practices
- Troubleshooting and common errors
- Contributing

## Introduction

LogSleuth helps teams analyze access logs with quick visualizations, anomaly detection and short AI-generated summaries. Goals are to make logs easy to ingest, normalize and query, while providing a small UI for exploration and AI summarization.

## System design and components

- Frontend: Next.js (App Router), built with `pnpm` and containerized for Cloud Run. The frontend calls the backend API with `credentials: 'include'` so authentication is cookie-based.
- Backend: Node 18 (TypeScript), Express 5, Prisma v6. Endpoints include `/auth` (login/sign-up/logout/me), `/uploads` (file upload and parse), `/analytics` (aggregates) and `/ai` (OpenAI summarization).
- Database: PostgreSQL (Cloud SQL in production). Prisma manages schema and migrations located in `prisma/`.
- Secrets & infra: Google Secret Manager stores DATABASE_URL, JWT_SECRET, and OPENAI_API_KEY. Cloud Build and Cloud Run are used to build and serve containers. The Cloud SQL Auth proxy is used when running migrations from a developer machine.

Deployment flow (high-level):

1. Cloud Build builds images for `backend` and `frontend` and pushes to `gcr.io` (or Artifact Registry).
2. Cloud Run services deploy the images; secrets are mapped into environment variables from Secret Manager.
3. Cloud Run backend communicates with Cloud SQL (private or public IP) using standard Postgres connection strings or unix sockets.

## Key capabilities

- Upload and parse Apache / Zscaler CSV and other supported log formats (parsers in `backend/src/parsers`).
- Persist normalized records to Postgres via Prisma.
- Analytics endpoints return counts, trends, and anomaly detection summaries.
- User authentication with email + password. Passwords hashed with bcrypt; JWTs issued and stored as HttpOnly cookies. Cookie options adapt to `FRONTEND_ORIGIN` and `NODE_ENV`.
- AI summaries: backend calls OpenAI (if `OPENAI_API_KEY` is present) to create short textual summaries of log content.

## Changes and fixes applied during debugging & deploy

This project went through a troubleshooting and hardening pass; these items are important to preserve and document:

- CORS and preflight
  - Added robust CORS options using `FRONTEND_ORIGIN` and `credentials: true` so cross-site cookies and preflights work correctly.
  - Replaced `app.options("*", ...)` wildcard route (which triggered path-to-regexp startup errors) with a middleware approach that handles OPTIONS preflight and returns 204.

- Trust proxy & rate limiting
  - Set `app.set('trust proxy', true)` (backend) to ensure `req.ip` and forwarded headers behave correctly when behind Cloud Run / load balancer.
  - Added a `keyGenerator` fallback to the login rate-limiter to avoid runtime ValidationError messages when forwarded headers are missing or malformed.

- Secrets and DB
  - Fixed a malformed `DATABASE_URL` secret stored in Secret Manager; re-ran Prisma migrations to ensure production schema contains the `User` table and other objects.
  - Added and mapped `JWT_SECRET` and `OPENAI_API_KEY` secrets to Cloud Run.

- Frontend improvements
  - Replaced `RuntimeInfo` overlay with a no-op so production bundles don't reveal internal runtime detection or show overlays.
  - Simplified `frontend/lib/api.ts` to prefer build-time `NEXT_PUBLIC_API_BASE` so deployed clients call the correct backend rather than trying to detect hostnames at runtime.

- Misc
  - Removed temporary debug endpoints used to inspect POST parsing during troubleshooting.
  - Cleaned up tracked files (removed generated frontend index, cookie files and platform-specific binaries from tracking) and updated `.gitignore` to prevent accidental check-ins.

These changes resolved the major production issues experienced earlier: CORS preflight failures, rate-limiter validation errors, Prisma connection parsing errors, and missing DB tables.

## Local development — step-by-step

Prerequisites

- Node 18.x
- pnpm (v9)
- Git
- PostgreSQL (local) or Cloud SQL + Cloud SQL Auth proxy
- Docker (optional — helpful for running Postgres locally)

Install dependencies

```powershell
# from repo root
npm install -g pnpm@9
pnpm install
```

Environment variables

Create `backend/.env` (DO NOT commit). Minimum set for local development:

```
DATABASE_URL=postgresql://logsleuth:password@127.0.0.1:5432/logsleuth
JWT_SECRET=replace-with-a-strong-secret
FRONTEND_ORIGIN=http://localhost:3000
NODE_ENV=development
OPENAI_API_KEY=sk-REPLACE_ME  # optional locally
```

Database (local Postgres)

Option A — Docker Postgres (fast):

```powershell
# run Postgres container
docker run --name logsleuth-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=logsleuth -e POSTGRES_DB=logsleuth -p 5432:5432 -d postgres:15
```

Option B — Cloud SQL (dev or staging):

- Start Cloud SQL Auth proxy and point `DATABASE_URL` at `127.0.0.1:5432`.

Apply Prisma migrations

```powershell
# from repo root or prisma folder
pnpm prisma migrate deploy --schema=prisma/schema.prisma
pnpm prisma generate --schema=prisma/schema.prisma
```

Start the backend

```powershell
cd backend
pnpm dev
# or for production-like run
pnpm start
```

Start the frontend

```powershell
cd frontend
pnpm dev
# open http://localhost:3000
```

Notes on cookies/auth locally

- For cookie-based auth across ports, ensure `FRONTEND_ORIGIN` matches `http://localhost:3000` and your browser accepts the cookie. In development `SameSite` is permissive enough for local flows.

## Running E2E smoke tests (auth + AI)

You can manually run a short smoke test from your machine (PowerShell examples):

1) Login (POST) and capture Set-Cookie

```powershell
$body = @{ email = 'your@address.com'; password = 'password' } | ConvertTo-Json
Invoke-RestMethod -Uri 'https://<backend-url>/auth/login' -Method Post -Body $body -ContentType 'application/json' -Headers @{ Origin = 'https://<frontend-url>' } -SessionVariable s
# The session variable $s will store cookies for subsequent requests
```

2) Authenticated request

```powershell
Invoke-RestMethod -Uri 'https://<backend-url>/auth/me' -Method Get -WebSession $s -Headers @{ Origin = 'https://<frontend-url>' }
```

3) Trigger AI summary (example)

```powershell
$payload = @{ ids = @('some-upload-id') } | ConvertTo-Json
Invoke-RestMethod -Uri 'https://<backend-url>/ai/summarize' -Method Post -Body $payload -ContentType 'application/json' -WebSession $s -Headers @{ Origin = 'https://<frontend-url>' }
```

If the AI endpoint returns an error that says `NO_KEY` or similar, confirm `OPENAI_API_KEY` is correctly configured in the environment (Secret Manager in production).

## Deploying to Google Cloud Run — reference

This project has been deployed to Cloud Run in the past. Highlights for redeploying:

1. Build images using Cloud Build (example `frontend/cloudbuild.yaml` contains an example build step). Use build substitution to pass `NEXT_PUBLIC_API_BASE` into the frontend build.
2. Push images to `gcr.io/<project>/logsleuth-backend` and `...-frontend`.
3. Create Secret Manager secrets and add secret versions for `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`.
4. Deploy Cloud Run services and map the secret values to environment variables. Ensure `FRONTEND_ORIGIN` in backend matches the frontend URL and CORS is configured with `credentials: true`.

Important production gotchas (learned while debugging):

- Do not register wildcard options routes with `app.options('*', ...)` in Express when using path-to-regexp vX — it caused a startup PathError in a production revision. Use a middleware to handle OPTIONS preflight.
- Set `app.set('trust proxy', true)` when behind Cloud Run to get correct client IPs and to avoid express-rate-limit ValidationError issues.
- Keep secrets out of git. Use Secret Manager (or equivalent).

## Security & best practices

- Never commit `.env` files, API keys, or platform-specific binaries. Use `.gitignore` and Secret Manager for production secrets.
- Revoke and rotate any leaked API keys immediately.
- For production, enable least-privilege permissions for the Cloud Run service account (access to Secret Manager and Cloud SQL only as required).

## Troubleshooting & common errors

- CORS 401 / cookie not set: Ensure `Access-Control-Allow-Credentials: true`, the frontend `fetch` uses `credentials: 'include'`, and `FRONTEND_ORIGIN` is exactly the origin of the frontend.
- express-rate-limit ValidationError: set `trust proxy` or provide a custom `keyGenerator` that returns a fallback IP.
- Prisma connection parse error: check `DATABASE_URL` for accidental whitespace or malformed socket path.
- `table does not exist` from Prisma: run migrations against the DB.

## Contributing

- Please open issues and PRs against `main` or create feature branches. If you need history rewritten (to remove secrets), coordinate with collaborators — that requires force-push and care.

---

If you'd like, I can commit this updated `README.md` to a branch and open a PR, or commit directly to `main` and push. Tell me which you prefer and I will proceed.
