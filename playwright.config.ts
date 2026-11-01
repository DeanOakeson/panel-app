import { defineConfig, devices } from "@playwright/test";
import { APP_URL, AUTH_HOST, FIRESTORE_HOST, PROJECT_ID, STUB_PORT, STUB_URL } from "./e2e/support/env";

// Browser tests. `npm run test:e2e` starts the Auth and Firestore emulators,
// then runs this config, which starts the storage stub and the app.
export default defineConfig({
  testDir: "e2e",
  // Every test resets and reseeds the one set of emulators, so tests take turns
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: APP_URL,
    timezoneId: "America/Denver",
    locale: "en-US",
    // The dev server compiles each page on its first visit
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Full Chromium opens a PDF in its viewer, where the headless shell would download it
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
  ],
  webServer: [
    {
      command: `node e2e/support/supabase-stub.mjs --port ${STUB_PORT}`,
      url: `${STUB_URL}/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // A dev server needs no build step and keeps its output in .next/dev,
      // apart from a production build
      command: "npx next dev --hostname 127.0.0.1 --port 3000",
      url: `${APP_URL}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      // Set explicitly, since process.env takes precedence over .env.local
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_USE_EMULATORS: "true",
        NEXT_PUBLIC_FIREBASE_API_KEY: "fake-api-key",
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.appspot.com`,
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
        NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:e2e",
        FIREBASE_PROJECT_ID: PROJECT_ID,
        FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST,
        FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST,
        SUPABASE_URL: STUB_URL,
        SUPABASE_SECRET_KEY: "e2e-stub-key",
        ADMIN_UID: "e2e-no-protected-admin",
      },
    },
  ],
});
