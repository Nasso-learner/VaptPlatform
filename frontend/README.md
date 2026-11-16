# VAPT Platform: frontend

Next.js 15 (App Router) · React 19 · Tailwind v4 · Redux Toolkit + RTK Query · framer-motion.

## Run

```bash
cp .env.example .env.local     # API_URL defaults to http://127.0.0.1:8000/api/v1
npm install
npm run dev                    # http://localhost:3000
```

The Django API must be running (`backend/`: `python manage.py runserver`). Demo data and users:
`python manage.py seed_demo` (see the command's output for the credentials; change them outside local dev).

Real scans also need Redis, a Celery worker, Celery beat (for schedules) and the scanner service.
Without them the UI works, but new scans fail and schedules never fire.

## How auth works

The browser never sees a JWT. `/api/auth/login` stores the access/refresh tokens in httpOnly cookies,
and `/api/proxy/*` forwards API calls with the `Authorization` header, refreshing the access token
transparently. `middleware.ts` is only a UX redirect; Django enforces every permission.

## Layout

- `src/app/(dashboard)/` — authenticated pages (dashboard, projects, scans, findings, reports, schedules, knowledge, users, audit, settings)
- `src/app/(auth)/` — login and register
- `src/store/api.ts` — every API endpoint as an RTK Query hook
- `src/components/ui/` — design system (buttons, fields, tables, modals, charts)
- `src/lib/motion.ts` — shared spring/bounce presets; reduced-motion is respected
