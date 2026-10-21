import { defineConfig } from "vitest/config";

// Tests run against the Auth and Firestore emulators. `npm test` starts them
// with `firebase emulators:exec`, which also sets the *_EMULATOR_HOST variables.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: ["__tests__/setup.ts"],
    // Every file shares one emulator and wipes it in beforeEach, so files must
    // not run at the same time.
    fileParallelism: false,
    env: {
      // lib/firebaseAdmin.ts reads this. The demo- prefix keeps the emulators
      // offline even if a real project ID is set in the shell.
      FIREBASE_PROJECT_ID: "demo-panel-app",
    },
  },
});
