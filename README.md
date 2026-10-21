# Panel App

🔗 https://panel-app-ten.vercel.app/


---

## Tech Stack

- Next.js
- TypeScript
- Firebase Authentication
- Firebase Admin SDK
- Tailwind CSS
- Vercel

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/panel-app.git
cd panel-app
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run development server

```bash
npm run dev
```

### 4. Open in browser

```text
http://localhost:3000
```

---

## Environment Variables

Create a `.env.local` file in the root directory by copying the example:

```bash
cp .env.example .env.local
```

Then fill in your Firebase values inside `.env.local`.

---

## Local development with emulators

The Firebase emulators run Auth and Firestore on your machine. You don't need real keys, and nothing touches the production project.

### 1. Install Java

The Firestore emulator needs Java 21 or newer.

```bash
winget install Microsoft.OpenJDK.21
```

Open a new terminal afterward and check it with `java -version`. On macOS, use `brew install openjdk@21`.

The Firebase CLI is a dev dependency, so `npm install` already covers it.

### 2. Create `.env.local`

Use these values instead of the ones in `.env.example`:

```env
NEXT_PUBLIC_USE_EMULATORS=true
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080

FIREBASE_PROJECT_ID=demo-panel-app
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-panel-app
NEXT_PUBLIC_FIREBASE_API_KEY=fake-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-panel-app.firebaseapp.com
```

The `demo-` prefix keeps the CLI fully offline. The API key can be any string.

### 3. Start the emulators and the app

Run each in its own terminal:

```bash
npm run emulators   # Auth on 9099, Firestore on 8080
npm run dev         # app on 3000
```

### 4. Create a test user

Open the Emulator UI at http://localhost:4000. Under **Authentication**, add a user, then sign in with it at http://localhost:3000/login.

Emulator data is saved to `.emulator-data` when you stop the emulators with Ctrl+C. It loads again on the next start. Delete the folder to start fresh.

To go back to the real Firebase project, remove the three emulator variables from `.env.local` and fill in the real values.

---

## Tests

```bash
npm test         # run once
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/) and need Java 21, like the emulators. `npm test` starts a fresh Auth and Firestore emulator, runs the tests, and shuts the emulators down. Your `.emulator-data` is never touched. Stop `npm run emulators` first, because both use the same ports.

API route tests live in `__tests__/api/` and call the route handler directly with a `Request`.