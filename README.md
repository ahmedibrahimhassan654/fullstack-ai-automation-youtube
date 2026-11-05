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
