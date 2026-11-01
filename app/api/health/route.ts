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

/** Describes how FIREBASE_PRIVATE_KEY is formatted, without revealing any of it. */
function describePrivateKey(privateKey: string) {
  const trimmed = privateKey.trim();

  return {
    length: privateKey.length,
    quoted: /^["']/.test(trimmed),
    escapedNewlines: privateKey.includes("\\n"),
    newlines: privateKey.includes("\n"),
    json: trimmed.startsWith("{"),
    base64Pem: Buffer.from(trimmed, "base64").toString("utf8").includes("BEGIN PRIVATE KEY"),
  };
}

/**
 * GET /api/health
 *
 * Reports what the deployment is running, whether the server-side Firebase Admin SDK
 * loads, and whether the service account key can get a Google access token, for
 * debugging a host whose logs are not available. Reports only whether each secret is
 * set and how it is formatted, never its value.
 */
export async function GET() {
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? "";
  const privateKey = process.env.FIREBASE_PRIVATE_KEY ?? "";

  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    node: process.version,
    firebaseAdmin: {
      app: await check(() => import("firebase-admin/app")),
      auth: await check(() => import("firebase-admin/auth")),
      firestore: await check(() => import("firebase-admin/firestore")),
    },
    // Imported here so this route still loads when firebase-admin does not
    credential: await check(async () => {
      const { getServiceAccountCredential } = await import("@/lib/firebaseAdmin");
      await getServiceAccountCredential().getAccessToken();
    }),
    firebaseProjectId: projectId || null,
    clientEmailMatchesProject: clientEmail.endsWith(`@${projectId}.iam.gserviceaccount.com`),
    privateKey: describePrivateKey(privateKey),
    env: {
      FIREBASE_PROJECT_ID: Boolean(projectId),
      FIREBASE_CLIENT_EMAIL: Boolean(clientEmail),
      FIREBASE_PRIVATE_KEY: Boolean(privateKey),
      FIREBASE_PRIVATE_KEY_IS_PEM: privateKey.includes("BEGIN PRIVATE KEY"),
      FIRESTORE_EMULATOR_HOST: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
      ADMIN_UID: Boolean(process.env.ADMIN_UID),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    },
  });
}
