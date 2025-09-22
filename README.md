# LogSleuth — log ingestion, analytics and AI summaries

LogSleuth is a compact full-stack application for ingesting, parsing and analyzing HTTP access logs. It includes a Next.js frontend for uploading and viewing logs, and a TypeScript/Express backend that parses logs, stores normalized records in PostgreSQL via Prisma, and exposes analytics and AI-assisted summarization endpoints.

This README documents the system design, features, local development, deployment reference (Google Cloud Run), secrets and the production fixes applied during deployment and debugging.

Table of contents

- Introduction
- System design and components
- System architecture diagram and explanation
- Key capabilities
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

## System architecture diagram and explanation

Below is a compact system diagram showing components and data flow. The ASCII diagram is intentionally simple — it maps directly to the repository structure and deployment flow.

```
+-------------------+           +---------------------+           +--------------------+
|   Browser / UI    |  <--->    |   Cloud Run Frontend |  <--->    |   Cloud Run Backend |
| (Next.js client)  |  fetches  | (Next.js app)        |   API     | (Express + Prisma)  |
+-------------------+  (1)     +---------------------+  (2)     +--------------------+
       |  ^                                                     |    |
       |  |                                                     |    v
(4)    v  |                                                     | +-----------------+
+-------------------+                                          | | Cloud SQL (PG)  |
| Local dev tools /  |                                          | | (Prisma schema) |
| CLI (pnpm, curl)   |                                          | +-----------------+
+-------------------+                                          |    ^
       ^  |                                                     |    |
       |  |                                                     |    +--> Secret Manager (DB URL, JWT, OpenAI)
       |  |                                                     | (3)
       |  +-----------------------------------------------------+
       |         (5) Uploads & parsing (file -> parsed records)
       |
       +---- Optional: Cloud SQL Auth Proxy for local migrations
```

Explanation of numbered flows

1) Browser/UI <-> Frontend
   - The Next.js frontend serves the UI and static assets. It calls backend API endpoints via fetch with `credentials: 'include'` to allow cookie-based authentication.

2) Frontend -> Backend
   - The frontend calls the backend over HTTPS (Cloud Run URL). Backend implements auth, uploads, analytics and AI endpoints.

3) Backend -> Cloud SQL & Secrets
   - The backend connects to Cloud SQL (Postgres) using `DATABASE_URL` stored in Secret Manager. `JWT_SECRET` and `OPENAI_API_KEY` are also supplied via Secret Manager to the running service.

4) Local dev tools
   - Developers run `pnpm dev` for frontend and backend, use the Cloud SQL Auth proxy for migrations, and run curl/PowerShell tests locally.

5) Uploads & parsing
   - Users upload log files (txt/log or CSV). The backend parser accepts raw text files and CSV-style files, runs heuristics to detect fields, normalizes and maps them into the database schema.

## Key capabilities

- Upload and parse log files in plain text (`.txt` / `.log`) including common web server access formats (Apache/combined, common). The parser also supports CSV files (e.g., Zscaler exports) and many CSV-like variants.
- Enhanced CSV heuristics: the parser includes heuristic algorithms that inspect CSV-like inputs and attempt to detect delimiter, header presence, timestamp fields, IPs, URLs, status codes and other likely columns. It then normalizes and maps detected fields to the internal schema where possible.
  - Heuristic steps include: delimiter detection (comma/pipe/semicolon/tab), header row detection, sampling value patterns (IP regex, ISO/epoch timestamps, status/int fields), and confidence scoring.
  - For ambiguous fields the parser produces best-effort normalized names and logs the detection confidence so downstream code or a human operator can review mapping.
- Normalization and mapping: parsed log rows are normalized (timestamps standardized to UTC ISO strings, IPs normalized, integer fields coerced) and mapped into the Prisma-managed database models. The parser will attempt to map common column names (e.g., `time`, `timestamp`, `date`, `status`, `status_code`, `src_ip`, `client_ip`, `url`, `request`) into the canonical DB fields.
- Persisting: normalized records are batched and written to Postgres via Prisma with transactional safety for each upload job.
- Analytics: endpoints compute aggregates, trends, and basic anomaly detection over stored records.
- AI summaries: when `OPENAI_API_KEY` is configured, the backend can generate short summaries for an upload or for query results.

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

