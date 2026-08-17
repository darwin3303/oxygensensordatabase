# O2 Sensor Inventory — Render (web service) + Neon (database)

A small Node.js + Express backend, hosted on Render, backed by a free
PostgreSQL database on Neon. Neon's free tier doesn't expire after 30 days
the way Render's own free Postgres does — it just scales its compute down
to zero when idle, without ever deleting your data.

## What's in here

- `server.js` — Express server: serves the frontend from `public/`, and
  exposes `GET/PUT /api/state` plus a lightweight `GET /api/version` that
  the frontend polls every few seconds to know when to re-fetch.
- `schema.sql` — Postgres tables (brands, sensors, movements, to_buy,
  equivalent_groups, equivalent_members, settings, sync_meta). Runs
  automatically on server startup — safe to run repeatedly.
- `public/` — the frontend (same app as before, minus all the Firebase code).
- `render.yaml` — a Render "Blueprint" for the web service. The database
  itself lives on Neon, not Render, so this only provisions the server.

## Step 1 — Create your free Neon database

1. Go to **neon.tech** → sign up (free, no credit card needed).
2. Create a new project — any name, e.g. "o2-sensor-inventory". Pick any
   region (closer to you is marginally faster, doesn't really matter here).
3. Once it's created, you'll land on a dashboard with a **connection
   string** — it looks like:
   ```
   postgresql://neondb_owner:AbCdEf123@ep-cool-name-12345-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   Make sure you copy the **pooled** connection string (the one with
   `-pooler` in the hostname) — Neon shows a toggle for "Pooled connection"
   vs "Direct connection"; use pooled, since our server can make several
   simultaneous queries per request.
4. Keep that string handy — you'll paste it into Render in the next step.

## Step 2 — Deploy the web service on Render

1. Push this whole folder to a GitHub repository (a new one, or reuse your
   existing `oxygensensordatabase` repo — either works).
2. Go to **render.com** → sign in (or sign up, free) → **New** →
   **Blueprint**.
3. Connect your GitHub account if you haven't, then pick the repository you
   just pushed to. Render reads `render.yaml` automatically.
4. When it asks for the `DATABASE_URL` environment variable, paste in the
   Neon pooled connection string from Step 1.
5. Click **Apply** / **Create**. First deploy takes a few minutes (installs
   dependencies, starts the server, creates the database tables on Neon
   automatically on first boot).
6. Once it's live, Render gives you a URL like
   `https://o2-sensor-inventory.onrender.com` — that's your new app.
   Open it on every device you want to use; they'll all read/write the same
   shared Neon database automatically, no further configuration needed.

## Notes on free tiers

- Render's free **web service** spins down after 15 minutes of inactivity
  and takes a few seconds to wake back up on the next request. The app
  handles this gracefully (it just retries), but the very first load after
  a period of no use might take 10-20 seconds longer than usual.
- Neon's free **database** doesn't expire or get deleted — it scales its
  compute down to zero when idle instead, and wakes up automatically
  (usually under a second) on the next query. No 30-day countdown to worry
  about, unlike Render's own free Postgres.

## Local development / testing

```
npm install
DATABASE_URL="postgresql://user:pass@localhost:5432/dbname" npm start
```

Requires a local Postgres instance, or point `DATABASE_URL` at any
reachable Postgres (including a Render one, for testing against production
data — careful with that).

## How sync works

Every device polls `GET /api/version` every 4 seconds — a cheap query that
just returns a counter. When that counter doesn't match what the device
last saw, it fetches the full `GET /api/state` and re-renders. Any local
change immediately `PUT`s the full state back (replace-all, wrapped in a
database transaction) and bumps that counter. So changes typically show up
on other open devices within about 4 seconds, and immediately on the device
that made the change.

There's no login/accounts — anyone with the URL can read and write the
data, same as the previous Firebase setup. If that ever needs to be
restricted, the cleanest option would be adding a simple shared password
check in `server.js` before the `/api/*` routes.
