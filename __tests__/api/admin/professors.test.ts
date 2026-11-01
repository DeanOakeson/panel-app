import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/professors/route";
import { getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function professors(idToken?: string, authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  else if (idToken) headers.authorization = `Bearer ${idToken}`;

  return GET(new Request("http://localhost/api/admin/professors", { headers }));
}

beforeEach(clearEmulators);

describe("GET /api/admin/professors", () => {
  it("returns 401 without a token", async () => {
    const res = await professors();

    expect(res.status).toBe(401);
  });

  it("returns 401 for a non-Bearer authorization header", async () => {
    const res = await professors(undefined, "Token not-a-bearer-value");

    expect(res.status).toBe(401);
  });

  it("returns 403 for a signed-in user with no users doc", async () => {
    const { idToken } = await createSignedInUser("stranger@example.com");

    const res = await professors(idToken);

    expect(res.status).toBe(403);
  });

  it("returns 403 for a user whose role is professor", async () => {
    const { idToken } = await createSignedInUser("prof@example.com", "professor");

    const res = await professors(idToken);

    expect(res.status).toBe(403);
  });

  it("returns 403 for a user whose role is student", async () => {
    const { idToken } = await createSignedInUser("student@example.com", "student");

    const res = await professors(idToken);

    expect(res.status).toBe(403);
  });

  it("lists only pending professor requests for an admin", async () => {
    const admin = await createSignedInUser("admin@example.com", "admin");
    const applicant = await createSignedInUser("applicant@example.com", "student");
    const declined = await createSignedInUser("declined@example.com", "student");
    const approved = await createSignedInUser("approved@example.com", "professor");

    const db = getAdminDb();
    await db.collection("users").doc(applicant.uid).set({ professorStatus: "pending" }, { merge: true });
    await db.collection("users").doc(declined.uid).set({ professorStatus: "declined" }, { merge: true });
    await db.collection("users").doc(approved.uid).set({ professorStatus: "none" }, { merge: true });

    const res = await professors(admin.idToken);

    expect(res.status).toBe(200);
    const { requests } = await res.json();
    expect(requests).toHaveLength(1);
    expect(requests.at(0)).toEqual({
      uid: applicant.uid,
      name: "",
      email: "applicant@example.com",
      role: "student",
      professorStatus: "pending",
    });
  });
});
