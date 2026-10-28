// END-49: emulator-backed proof of the admin reject path on PATCH /api/users.
//
// Kevin's manual pass (END-28) approved the one seeded professor request and was
// left with nothing to reject, so the reject branch had no test and no live demo.
// These tests cover the whole branch chain: the decision itself, a second
// decision on the same uid, what the rejected applicant is routed to afterwards,
// and who is allowed to make the decision at all.
//
// Style follows `__tests__/api/admin/professors.test.ts` (route handlers called
// directly with real emulator tokens, one shared emulator wiped per test).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, PATCH, POST } from "@/app/api/users/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { getHomePath, HOME_PATHS, PENDING_APPROVAL_PATH } from "@/lib/homePath";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

/**
 * `PATCH /api/users` still authorizes with the stale `verifyAdmin`/`ADMIN_UID`
 * path (allowlisted in `__tests__/lib/adminGuardDrift.test.ts`; migrating it is
 * out of END-49 scope). Vitest does not load `.env.local`, so tests that expect
 * an admin to be granted must name that admin in the env var the route reads —
 * exactly the shape Kevin's live environment has.
 */
async function makeAdmin(email = "admin@example.com") {
  const user = await createSignedInUser(email, "admin");
  process.env.ADMIN_UID = user.uid;
  return user;
}

afterEach(() => {
  delete process.env.ADMIN_UID;
});

function patchUsers(idToken: string | undefined, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return PATCH(
    new Request("http://localhost/api/users", {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    })
  );
}

/** Registers a profile through the app's own flow, as the person themselves would. */
async function registerSelf(email: string, role: "student" | "professor", name = "Test User") {
  const { uid, idToken } = await createSignedInUser(email);

  const res = await POST(
    new Request("http://localhost/api/users", {
      method: "POST",
      headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name, role }),
    })
  );
  expect(res.status).toBe(200);

  return { uid, idToken };
}

function readProfile(uid: string) {
  return getAdminDb().collection("users").doc(uid).get().then((doc) => doc.data());
}

/** Mirrors lib/userProfile.ts: a 404 from GET /api/users means no profile. */
async function homePathFor(idToken: string) {
  const res = await GET(
    new Request("http://localhost/api/users", {
      headers: { authorization: `Bearer ${idToken}` },
    })
  );
  return getHomePath(res.status === 404 ? null : await res.json());
}

beforeEach(clearEmulators);

describe("PATCH /api/users — reject a pending professor request", () => {
  it("sets the applicant back to student with professorStatus rejected", async () => {
    const admin = await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");

    // The app's own flow really did park them in the pending queue.
    expect(await readProfile(applicant.uid)).toMatchObject({
      role: "student",
      professorStatus: "pending",
    });

    const res = await patchUsers(admin.idToken, { uid: applicant.uid, action: "reject" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      message: "Professor application rejected",
    });

    const profile = await readProfile(applicant.uid);
    expect(profile?.role).toBe("student");
    expect(profile?.professorStatus).toBe("rejected");
    // Rejecting must not damage the rest of the profile.
    expect(profile).toMatchObject({ name: "Wendy W", email: "wendy@example.com" });
  });

  it("routes the rejected applicant to the student home, not the pending page", async () => {
    const admin = await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");

    // Before the decision they are held on the pending page...
    expect(await homePathFor(applicant.idToken)).toBe(PENDING_APPROVAL_PATH);

    await patchUsers(admin.idToken, { uid: applicant.uid, action: "reject" });

    // ...and after it they land on the student home while staying a student.
    expect(await homePathFor(applicant.idToken)).toBe(HOME_PATHS.student);
    expect(await homePathFor(applicant.idToken)).not.toBe(PENDING_APPROVAL_PATH);
  });

  it("leaves a rejected applicant off the admin's pending list", async () => {
    // The pending list query is professorStatus == "pending"; a rejected doc must
    // drop out of it so the row Kevin just clicked cannot reappear.
    const admin = await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");
    await patchUsers(admin.idToken, { uid: applicant.uid, action: "reject" });

    const pending = await getAdminDb()
      .collection("users")
      .where("professorStatus", "==", "pending")
      .get();

    expect(pending.docs.map((doc) => doc.id)).not.toContain(applicant.uid);
  });

  it("refuses a second reject on the same uid without rewriting the profile", async () => {
    const admin = await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");

    expect(
      (await patchUsers(admin.idToken, { uid: applicant.uid, action: "reject" })).status
    ).toBe(200);
    const afterFirst = await readProfile(applicant.uid);

    const second = await patchUsers(admin.idToken, { uid: applicant.uid, action: "reject" });

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: "This application is no longer pending",
    });
    expect(await readProfile(applicant.uid)).toEqual(afterFirst);
  });

  it("refuses to approve an already-rejected request (no silent flip)", async () => {
    const admin = await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");
    await patchUsers(admin.idToken, { uid: applicant.uid, action: "reject" });

    const res = await patchUsers(admin.idToken, { uid: applicant.uid, action: "approve" });

    expect(res.status).toBe(409);
    expect(await readProfile(applicant.uid)).toMatchObject({
      role: "student",
      professorStatus: "rejected",
    });
  });

  it("refuses to reject an already-approved professor", async () => {
    const admin = await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");

    expect(
      (await patchUsers(admin.idToken, { uid: applicant.uid, action: "approve" })).status
    ).toBe(200);

    const res = await patchUsers(admin.idToken, { uid: applicant.uid, action: "reject" });

    expect(res.status).toBe(409);
    expect(await readProfile(applicant.uid)).toMatchObject({
      role: "professor",
      professorStatus: "approved",
    });
  });

  it("answers 401 with no token and leaves the applicant pending", async () => {
    await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");

    const res = await patchUsers(undefined, { uid: applicant.uid, action: "reject" });

    expect(res.status).toBe(401);
    expect(await readProfile(applicant.uid)).toMatchObject({ professorStatus: "pending" });
  });

  it.each([
    ["student", "student"],
    ["professor", "professor"],
  ])("answers 403 for a signed-in %s caller even if ADMIN_UID is set", async (role) => {
    await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");
    const { idToken } = await createSignedInUser(`caller-${role}@example.com`, role);

    const res = await patchUsers(idToken, { uid: applicant.uid, action: "reject" });

    expect(res.status).toBe(403);
    expect(await readProfile(applicant.uid)).toMatchObject({ professorStatus: "pending" });
  });

  it("answers 403 for a signed-in user with no users doc", async () => {
    await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");
    const { idToken } = await createSignedInUser("ghost@example.com");

    const res = await patchUsers(idToken, { uid: applicant.uid, action: "reject" });

    expect(res.status).toBe(403);
    expect(await readProfile(applicant.uid)).toMatchObject({ professorStatus: "pending" });
  });

  it("does not treat an ADMIN_UID-matching token without a profile as admin", async () => {
    // Privilege-escalation stop: the env var alone must not be enough.
    await makeAdmin();
    const applicant = await registerSelf("wendy@example.com", "professor", "Wendy W");
    const { uid, idToken } = await createSignedInUser("nobody@example.com");
    process.env.ADMIN_UID = uid;

    const res = await patchUsers(idToken, { uid: applicant.uid, action: "reject" });

    expect(res.status).toBe(403);
    expect(await readProfile(applicant.uid)).toMatchObject({ professorStatus: "pending" });
  });

  it("answers 404 for a uid that has no profile", async () => {
    const admin = await makeAdmin();

    const res = await patchUsers(admin.idToken, { uid: "no-such-uid", action: "reject" });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "Applicant not found" });
  });

  it.each([
    ["a missing uid", { action: "reject" }],
    ["an unknown action", { uid: "whatever", action: "delete" }],
    ["an approve/reject misspelling", { uid: "whatever", action: "rej" }],
  ])("answers 400 for %s", async (_label, body) => {
    const admin = await makeAdmin();

    const res = await patchUsers(admin.idToken, body);

    expect(res.status).toBe(400);
  });

  it("refuses to reject the admin account itself", async () => {
    const admin = await makeAdmin();

    const res = await patchUsers(admin.idToken, { uid: admin.uid, action: "reject" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "The admin account cannot be changed here",
    });
    expect(await readProfile(admin.uid)).toMatchObject({ role: "admin" });
  });
});
