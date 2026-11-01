/** Firebase project the emulators run. The demo- prefix keeps them offline. */
export const PROJECT_ID = "demo-panel-app";

/**
 * Where the app runs during the tests. It must be 127.0.0.1, not localhost,
 * because the dev server only serves its scripts to the hostname it was started with.
 */
export const APP_URL = "http://127.0.0.1:3000";

export const STUB_PORT = 54321;
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;

export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
export const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

/** Password for every seeded account. */
export const PASSWORD = "e2e-password";
