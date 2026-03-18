# DINGERS — Fantasy HR League

A full-stack fantasy baseball platform where the only stat that matters is home runs.

## Stack

| Layer | Tech | Why |
|-------|------|-----|
| Frontend | Next.js 14 App Router | Server components + client islands, excellent DX |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Database | PostgreSQL + Prisma | Type-safe ORM, relational integrity for rosters/matchups |
| Auth | iron-session | Lightweight, cookie-based, no OAuth complexity needed |
| Jobs | BullMQ + Redis | Reliable job queues for stat sync, waiver processing |
| Stats | MLB Stats API | Free public API, no key needed for basic usage |

---

## Quick Start

### 1. Prerequisites
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### 2. Install
```bash
npm install
```

### 3. Environment
```bash
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, SESSION_SECRET
```

Generate a session secret:
```bash
openssl rand -base64 32
```

### 4. Database
```bash
npm run db:push       # Push schema to DB
npm run db:seed       # Seed 12 teams + sample players
```

### 5. Run
```bash
# Terminal 1 - Next.js app
npm run dev

# Terminal 2 - Background workers (stat sync, waiver processing)
npm run workers
```

Open http://localhost:3000

Default login: `alex.johnson@dingers.test` / `password123` (commissioner)

---

## Architecture

```
src/
├── app/
│   ├── (auth)/           # Login, register (no nav)
│   ├── (league)/         # All protected pages with sidebar nav
│   │   ├── dashboard/    # Home with matchup + standings
│   │   ├── matchup/      # Live scoring view
│   │   ├── roster/       # Lineup editor with drag/drop
│   │   ├── standings/    # Full league table
│   │   ├── players/      # Player search + add/drop
│   │   ├── schedule/     # Season schedule
│   │   ├── transactions/ # Activity log
│   │   ├── draft/        # Draft room
│   │   └── admin/        # Commissioner panel
│   └── api/
│       ├── auth/         # login, logout, register
│       ├── roster/       # GET roster, PUT lineup
│       ├── players/      # search
│       ├── matchups/     # GET matchup data
│       ├── standings/    # GET standings
│       ├── transactions/ # add, drop
│       ├── draft/        # GET state, POST pick
│       ├── sync/         # POST manual sync
│       └── admin/        # Commissioner actions
├── lib/
│   ├── prisma.ts         # DB client singleton
│   ├── auth.ts           # Session management
│   ├── mlb-api.ts        # MLB Stats API wrapper
│   ├── scoring.ts        # HR scoring engine + schedule generation
│   └── hooks.ts          # useDebounce, useCountdown
├── workers/
│   └── index.ts          # BullMQ workers + job schedulers
└── types/
    └── index.ts          # Shared TypeScript types
```

---

## Scoring Rules

- **1 HR = 1 point**. No other stats count.
- Only active starters score. Bench players score nothing.
- Lineup locks **Tuesday at 1:00 AM UTC** each week (aligns with MLB schedule).
- After lock, changes take effect next week.
- Matchups run **Tuesday–Monday**.
- Weekly results determine W/L/T record.
- Standings ordered by wins, then total HRs (tiebreaker).

## Waiver Rules

- Priority waivers (default): worst record picks first.
- Claims processed **Tuesday at 3:00 AM UTC** after weekly lock.
- FAAB mode available — set `waiverType: FAAB` in league settings.
- Free agent adds happen instantly outside waiver window.

## Draft

- Snake format, 13 rounds (13-player rosters).
- 90-second timer per pick (configurable).
- Auto-pick triggers if timer expires (takes highest-HR available player at needed position).
- Draft order set by commissioner in admin panel.

---

## Deployment

### Vercel + Railway

```bash
# 1. Push to GitHub
# 2. Connect repo to Vercel
# 3. Add env vars in Vercel dashboard
# 4. Railway for PostgreSQL + Redis

# Run migrations on Railway
DATABASE_URL="..." npx prisma migrate deploy
```

### Docker (self-hosted)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

Run workers separately:
```bash
docker run ... npm run workers
```

---

## Stat Sync Schedule

| Job | Frequency | Purpose |
|-----|-----------|---------|
| stat-sync | Every 15 min (game hours) | Ingest HRs from completed games |
| weekly-rollover | Tuesday 3:59 AM UTC | Finalize week, advance standings |
| player-sync | Daily 11 AM UTC | Sync player statuses/team changes |
| waiver-process | Tuesday 7 AM UTC | Process waiver claims |

The MLB Stats API is free and public. No API key required. Rate limits are generous
for this use case (~200 reqs/hour is more than enough for a 12-team league).

---

## Commissioner Flow

1. Register (first user becomes commissioner)
2. Share registration link with 11 other owners
3. Admin Panel → Generate Schedule (pick season start date)
4. Admin Panel → Configure Draft (set timer)
5. Admin Panel → Start Draft (once all 12 teams registered)
6. Draft completes → Admin Panel → Start Regular Season
7. Season runs automatically. Stats sync every 15 minutes.
8. Each Monday night → auto-finalize week (or manual via admin)
