type Check = { ok: true } | { ok: false; error: string };

/** Runs `load` and reports whether it threw, with the error message when it did. */
async function check(load: () => Promise<unknown>): Promise<Check> {
  try {
    await load();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * GET /api/health
 *
 * Reports what the deployment is running and whether the server-side Firebase Admin SDK
 * loads, for debugging a host whose logs are not available. Reports only whether each
 * secret is set, never its value.
 */
export async function GET() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY ?? "";

  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    node: process.version,
    firebaseAdmin: {
      app: await check(() => import("firebase-admin/app")),
      auth: await check(() => import("firebase-admin/auth")),
      firestore: await check(() => import("firebase-admin/firestore")),
    },
    env: {
      FIREBASE_PROJECT_ID: Boolean(process.env.FIREBASE_PROJECT_ID),
      FIREBASE_CLIENT_EMAIL: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      FIREBASE_PRIVATE_KEY: Boolean(privateKey),
      FIREBASE_PRIVATE_KEY_IS_PEM: privateKey.includes("BEGIN PRIVATE KEY"),
      FIRESTORE_EMULATOR_HOST: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
      ADMIN_UID: Boolean(process.env.ADMIN_UID),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    },
  });
}
