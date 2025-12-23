# Recepie site (friends recipe app)

Full-stack app:
- Backend: Express + TypeScript + Prisma + Postgres
- Frontend: Vite + vanilla TypeScript (non-React)

## Prereqs
- Install **Node.js LTS** (includes npm)
- Install **Docker Desktop** (for Postgres via docker-compose)

## First-time setup
1. Start Postgres:
   - `docker compose up -d`
2. Backend env:
   - Copy `server/.env.example` to `server/.env` and edit values.
3. Install deps:
   - `npm install` (root) OR install in `server` and `client` separately.
4. Create DB schema:
   - `npm run db:push`
5. Run dev:
   - `npm run dev`

## Accounts
- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env` to auto-create an admin user on first run.

## Hosting note: photos
In production, storing photos on the server filesystem is not reliable on many free hosts.
This project supports uploading to Cloudinary:
- Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (and optionally `CLOUDINARY_FOLDER`) on the backend.
- When configured, `/api/uploads` returns a Cloudinary `https://...` URL and the app stores that URL in the database.
