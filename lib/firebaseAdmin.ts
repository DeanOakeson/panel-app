import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Returns the Admin app, initializing it on first call. Deferred so `next build` can
 * import route modules without credentials.
 */
function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0];

  // The Admin SDK routes to the emulators on its own when *_EMULATOR_HOST is set
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  }

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY."
    );
  }

  return initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

/** Returns the Admin Auth service. */
export function getAdminAuth() {
  return getAuth(getAdminApp());
}

/** Returns the Admin Firestore service. */
export function getAdminDb() {
  return getFirestore(getAdminApp());
}
