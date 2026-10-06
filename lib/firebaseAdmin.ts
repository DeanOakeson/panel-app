import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// The Admin SDK routes to the emulators on its own when *_EMULATOR_HOST is set
const useEmulators = !!process.env.FIRESTORE_EMULATOR_HOST;

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp(
        useEmulators
          ? { projectId: process.env.FIREBASE_PROJECT_ID }
          : {
              credential: cert({
                projectId: process.env.FIREBASE_PROJECT_ID!,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
                privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
              }),
            }
      );

// Export services
export const auth = getAuth(app);
export const db = getFirestore(app);