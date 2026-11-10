# AI YouTube Automation & Educational Hub

Monorepo with:

- `backend/` — Node.js + Express + MongoDB (Mongoose), JWT auth, modular routes
- `frontend/` — Next.js (App Router) + Tailwind + shadcn/ui

## Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Requires MongoDB (and Redis later for BullMQ).

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local`.

## Current progress

- Step 1: Database schemas (User, Video) + Express setup ✅
- Step 2: Auth core (register/login/JWT/refresh) + YouTube OAuth scaffold + frontend auth pages ✅
- Next: Admin dashboard modules, manual video upload, transcription, AI analysis, publishing, billing subscriptions

## Deploy to Vercel

This repository contains two independently deployable apps.

### 1. Frontend (Next.js)

1. In Vercel, **New Project → Import Git Repository**.
2. Set **Root Directory** to `frontend`.
3. Add environment variables:
   - `NEXT_PUBLIC_API_URL` → your backend URL (for example `https://your-backend.vercel.app`)
4. Deploy.

The verified production build uses `npm run build`; the emitted `.vercel` and `.next` folders are ignored by Git.

### 2. Backend (Express API)

1. In Vercel, **New Project → Import the same Git Repository**.
2. Set **Root Directory** to `backend`.
3. Add environment variables from `backend/.env.example`:
   - `NODE_ENV=production`
   - `MONGODB_URI` → MongoDB Atlas connection string
   - `JWT_SECRET`, `JWT_EXPIRES_IN`
   - `CLIENT_URL` → your frontend URL (`https://your-frontend.vercel.app`)
   - `GROQ_API_KEY`, `GEMINI_API_KEY`, YouTube OAuth keys, Stripe keys, Cloudinary keys
4. Deploy.

The backend uses `backend/api/index.js` as a Vercel Serverless Function and rewrites all routes to that function.
For local development use `npm run dev`, which starts `src/server.js`.

### Local development

```bash
# Terminal 1
cd backend && cp .env.example .env && npm install && npm run dev

# Terminal 2
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

## Moving to another machine

All persistent app data lives in the local MongoDB (`ai_youtube_automation`).
Media files are in Cloudinary, so nothing else needs copying.

### One-shot bundle (recommended)

```bash
node scripts/createMigrationBundle.mjs
```

Creates `migration-bundle-<timestamp>/` plus a `.zip` containing:

- `project/` — full source with git history and `.env` files
- `databases/mongo-ai_youtube_automation.json` — database dump
- `SETUP.md` — step-by-step instructions for the new machine

Options: `--all` (dump every database), `--no-env` (skip secrets), `--no-zip` (folder only).

### Restore on the new machine

```bash
cd project/backend && npm install
npm run data:status
npm run data:import -- ../databases/mongo-ai_youtube_automation.json --drop
```

### Manual database copy

```bash
cd backend
npm run data:status                     # list databases and document counts
npm run data:export                     # -> backend/backup/mongo-<db>-<stamp>.json
npm run data:import -- ../backup/<file>.json --drop
```

The dump keeps `password` hashes, session refresh tokens and YouTube OAuth
tokens, so existing accounts stay signed-in and channels stay connected.

> The dump and `backend/.env` contain secrets — keep the archive private and
> delete it once the new machine is verified.
