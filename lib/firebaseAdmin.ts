import { getApps, initializeApp, cert, type App, type Credential } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Converts FIREBASE_PRIVATE_KEY to PEM. Accepts escaped `\n` newlines, and a key body
 * stored without its BEGIN and END lines.
 */
export function toPrivateKeyPem(privateKey: string): string {
  const key = privateKey.replace(/\\n/g, "\n");
  if (key.includes("-----BEGIN")) return key;

  return `-----BEGIN PRIVATE KEY-----\n${key.trim()}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Builds the service account credential from FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL
 * and FIREBASE_PRIVATE_KEY. Throws when one is missing.
 */
export function getServiceAccountCredential(): Credential {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error(
      "Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY."
    );
  }

  return cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: toPrivateKeyPem(FIREBASE_PRIVATE_KEY),
  });
}

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

  return initializeApp({ credential: getServiceAccountCredential() });
}

/** Returns the Admin Auth service. */
export function getAdminAuth() {
  return getAuth(getAdminApp());
}

/** Returns the Admin Firestore service. */
export function getAdminDb() {
  return getFirestore(getAdminApp());
}
