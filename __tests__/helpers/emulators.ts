import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

const TEST_PASSWORD = "test-password";

async function expectOk(res: Response, action: string) {
  if (!res.ok) {
    throw new Error(`${action} failed: ${res.status} ${await res.text()}`);
  }
}

/** Deletes every Auth account and Firestore document in the emulators. */
export async function clearEmulators() {
  const [firestore, auth] = await Promise.all([
    fetch(
      `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
      { method: "DELETE" }
    ),
    fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, {
      method: "DELETE",
    }),
  ]);
  await expectOk(firestore, "Clearing the Firestore emulator");
  await expectOk(auth, "Clearing the Auth emulator");
}

/**
 * Creates an Auth account, optionally with a users/{uid} profile holding
 * `role`, and returns a real ID token for it from the Auth emulator.
 */
export async function createSignedInUser(email: string, role?: string) {
  const { uid } = await getAdminAuth().createUser({ email, password: TEST_PASSWORD });

  if (role) {
    await getAdminDb().collection("users").doc(uid).set({ email, role });
  }

  const res = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: TEST_PASSWORD, returnSecureToken: true }),
    }
  );
  await expectOk(res, `Signing in ${email}`);
  const { idToken } = (await res.json()) as { idToken: string };

  return { uid, idToken };
}
