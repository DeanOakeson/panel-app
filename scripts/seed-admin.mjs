// Seed the first admin account (ClickUp story: "As a developer, I want a
// first admin account...").
//
// Creates a Firebase Auth account + a users/{uid} Firestore document with
// role === "admin". The uid is DETERMINISTIC: sha256 of the normalized email,
// so the same email always yields the same uid on every machine and every
// re-seed. That keeps ADMIN_UID identical across developers and across
// emulator resets.
//
// Usage (never put the password in argv — env only):
//   ADMIN_EMAIL=admin@panel-app.test ADMIN_PASSWORD=*** node scripts/seed-admin.mjs
//
// With FIREBASE_AUTH_EMULATOR_HOST set, targets the local Auth emulator
// (start it first: npm run emulators). Otherwise targets the real project
// using FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY,
// same as lib/firebaseAdmin.ts.
//
// Idempotent: running twice with the same email is a no-op (role is re-asserted).

import { createHash } from "node:crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = (process.env.ADMIN_NAME ?? "Administrator").trim();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Set ADMIN_EMAIL to a valid address (env var, not argv).");
  process.exit(1);
}
if (!password || password.length < 6) {
  console.error("Set ADMIN_PASSWORD (min 6 chars) in the environment.");
  process.exit(1);
}

const uid = createHash("sha256").update(email).digest("hex");

const usingEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

function initApp() {
  if (getApps().length > 0) return getApps()[0];
  if (usingEmulator) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID ??
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
      "demo-panel-app";
    return initializeApp({ projectId });
  }
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
    process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.error(
      "Not in emulator mode and production Admin credentials are missing.\n" +
        "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY,\n" +
        "or set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 for local seeding."
    );
    process.exit(1);
  }
  return initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

const app = initApp();
const auth = getAuth(app);
const db = getFirestore(app);

console.log(`Mode: ${usingEmulator ? "emulator" : "PRODUCTION project"}`);
console.log(`Email: ${email}`);
console.log(`Deterministic uid: ${uid}`);

// --- Auth account -----------------------------------------------------------
let existing = null;
try {
  existing = await auth.getUserByEmail(email);
} catch (err) {
  if (err?.code !== "auth/user-not-found" &&
      err?.code !== "auth/email-not-found") {
    throw err;
  }
}

if (existing && existing.uid !== uid) {
  console.error(
    `\nA user with this email already exists but has a different uid:\n` +
      `  existing: ${existing.uid}\n  expected: ${uid}\n` +
      `This happens if the account was created via the Firebase console\n` +
      `(random uid). Either delete that account and re-run this script to\n` +
      `adopt the deterministic uid, or use the existing uid as ADMIN_UID.`
  );
  process.exit(1);
}

if (existing) {
  console.log("Auth account already exists — leaving credentials untouched.");
} else {
  await auth.createUser({ uid, email, password, displayName: name });
  console.log("Auth account created.");
}

// --- Firestore profile ------------------------------------------------------
const profileRef = db.collection("users").doc(uid);
const profileDoc = await profileRef.get();
await profileRef.set(
  {
    name,
    email,
    role: "admin",
    updatedAt: new Date(),
    createdAt: profileDoc.exists
      ? profileDoc.data().createdAt ?? new Date()
      : new Date(),
  },
  { merge: true }
);
console.log(
  `users/${uid} ${profileDoc.exists ? "updated" : "created"} with role=admin.`
);

console.log(
  "\nDone. Add this line to the matching environment (e.g. .env.local):\n" +
    `  ADMIN_UID=${uid}`
);
