// Refuse to run outside the emulators. Without these variables the Admin SDK
// would talk to a real Firebase project, and clearEmulators() would fail.
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
    "Tests must run against the Firebase emulators. Use `npm test`, which starts them."
  );
}

export {};
