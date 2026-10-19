import { beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/users/route";
import { POST as adminCreateUser } from "@/app/api/admin/users/route";
import { getHomePath, HOME_PATHS, NO_ROLE_PATH, PENDING_APPROVAL_PATH } from "@/lib/homePath";
import { getAdminAuth } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PASSWORD = "secret123";

/** Signs in through the Auth emulator and returns a real ID token. */
async function signIn(email: string) {
  const res = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }
  );
  return ((await res.json()) as { idToken: string }).idToken;
}

function authed(idToken: string, method = "GET", body?: unknown) {
  return new Request("http://localhost/api/users", {
    method,
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Mirrors lib/userProfile.ts: a 404 from GET /api/users means no profile. */
async function homePathFor(idToken: string) {
  const res = await GET(authed(idToken));
  return getHomePath(res.status === 404 ? null : await res.json());
}

beforeEach(clearEmulators);

describe("home path for real profiles", () => {
  it("sends a self-registered student to the student course dashboard", async () => {
    await getAdminAuth().createUser({ email: "sam@example.com", password: PASSWORD });
    const idToken = await signIn("sam@example.com");
    await POST(authed(idToken, "POST", { name: "Sam", role: "student" }));

    expect(await homePathFor(idToken)).toBe(HOME_PATHS.student);
  });

  it("holds back a self-registered professor until approved", async () => {
    await getAdminAuth().createUser({ email: "pat@example.com", password: PASSWORD });
    const idToken = await signIn("pat@example.com");
    await POST(authed(idToken, "POST", { name: "Pat", role: "professor" }));

    expect(await homePathFor(idToken)).toBe(PENDING_APPROVAL_PATH);
  });

  // Admin-created profiles have a role but no professorStatus
  it.each([
    ["student", HOME_PATHS.student],
    ["professor", HOME_PATHS.professor],
  ])("sends an admin-created %s to their home view", async (role, expected) => {
    const { idToken: adminToken } = await createSignedInUser("admin@example.com", "admin");
    const email = `new-${role}@example.com`;

    const created = await adminCreateUser(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ name: "New User", email, role, password: PASSWORD }),
      })
    );
    expect(created.status).toBe(201);

    expect(await homePathFor(await signIn(email))).toBe(expected);
  });

  it("sends an admin to the admin home view", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    expect(await homePathFor(idToken)).toBe(HOME_PATHS.admin);
  });

  it("sends a user with no profile to the contact-admin page", async () => {
    const { idToken } = await createSignedInUser("ghost@example.com");

    expect(await homePathFor(idToken)).toBe(NO_ROLE_PATH);
  });
});
