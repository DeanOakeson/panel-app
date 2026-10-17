// lib/firebaseClient.ts
import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

function getAppInstance(): ReturnType<typeof initializeApp> {
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

let authInstance: Auth | null = null;

/**
 * Browser-only accessor for Firebase Auth.
 *
 * Auth is created lazily on first call instead of at module load because
 * getAuth() throws (auth/invalid-api-key) whenever NEXT_PUBLIC_FIREBASE_API_KEY
 * is missing — which is the case during `next build` prerendering (this module
 * is imported through the root layout via Sidebar) and in Vercel preview
 * deployments without preview env vars. All call sites are client components
 * that use it inside effects or event handlers, i.e. browser-only paths.
 */
export function getFirebaseAuth(): Auth {
  if (typeof window === "undefined") {
    throw new Error(
      "getFirebaseAuth() is browser-only; do not call it during SSR/prerender."
    );
  }

  if (!authInstance) {
    authInstance = getAuth(getAppInstance());

    if (process.env.NEXT_PUBLIC_USE_EMULATORS === "true") {
      connectAuthEmulator(authInstance, "http://127.0.0.1:9099", {
        disableWarnings: true,
      });
    }
  }

  return authInstance;
}
