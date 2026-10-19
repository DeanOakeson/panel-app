<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project Context — Panel App

A Next.js (App Router) app that is a Canvas-style interface.  
Live demo: https://panel-app-ten.vercel.app/

### Stack
- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind CSS v4
- **Auth**: Firebase Authentication (client + Admin SDK)
- **Database**: Cloud Firestore (security rules in `firestore.rules`)
- **Hosting**: Vercel
- **Package manager**: npm

### Key Paths
- `app/` — routes and layouts
  - `app/login/` — login page
  - `app/dashboard/` — main dashboard
  - `app/professor/assignments/` — professor assignment views
  - `app/api/users/` — API routes
- `lib/firebaseClient.ts` — client-side Firebase init
- `lib/firebaseAdmin.ts` — server-side Firebase Admin
- `firestore.rules` / `firestore.indexes.json` — Firestore config
- `firebase.json` — Firebase / emulator config
- `__tests__/` — Vitest tests; `__tests__/helpers/emulators.ts` resets the emulators and signs in test users

### Development Commands
```bash
npm install
npm run dev              # http://localhost:3000
npm run lint
npm run build
npm test                 # Vitest against throwaway Auth + Firestore emulators (needs Java 21+)

# Local Firebase emulators (Auth + Firestore)
npm run emulators        # Auth :9099, Firestore :8080, UI :4000
```

### Environment
- Copy `.env.example` → `.env.local` and fill Firebase values.
- For local emulator work set:
  ```env
  NEXT_PUBLIC_USE_EMULATORS=true
  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
  FIREBASE_PROJECT_ID=demo-panel-app
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-panel-app
  ```
- Emulator data persists in `.emulator-data/`.
- Never commit `.env.local` or real private keys.

### Conventions
- Prefer Server Components by default; add `"use client"` only when needed.
- Firebase client logic lives in `lib/firebaseClient.ts`; Admin/server logic in `lib/firebaseAdmin.ts`.
- Auth-protected routes should follow the existing pattern used by `/dashboard` and `/login`.
- Match existing Tailwind utility style.
- Firestore rules and indexes are version-controlled — update them if you change data access patterns.
- Tests use Vitest. API route tests call the exported handler directly (`POST(new Request(...))`) against the emulators. Don't mock Firebase Admin.
- `npm test` starts its own emulators on the default ports, so stop `npm run emulators` first.

### Before Finishing a Change
1. Run `npm run lint` and `npm test`.
2. For auth or data changes, add or update tests under `__tests__/`.
3. Confirm the change still builds (`npm run build` for non-trivial work).
4. Summarize what you changed and why.
