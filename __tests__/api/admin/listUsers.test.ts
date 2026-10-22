import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/users/route";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function listUsers(idToken?: string, role?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  const query = role ? `?role=${role}` : "";

  return GET(new Request(`http://localhost/api/admin/users${query}`, { headers }));
}

beforeEach(clearEmulators);

describe("GET /api/admin/users", () => {
  it("returns 401 without a token", async () => {
    const res = await listUsers();

    expect(res.status).toBe(401);
  });

  it.each(["student", "professor"])("returns 403 for a %s", async (role) => {
    const { idToken } = await createSignedInUser(`${role}@example.com`, role);

    const res = await listUsers(idToken, "professor");

    expect(res.status).toBe(403);
  });

  it("lists only professors when filtered by role", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");
    await createSignedInUser("prof@example.com", "professor");
    await createSignedInUser("student@example.com", "student");

    const res = await listUsers(idToken, "professor");

    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(users).toHaveLength(1);
    expect(users.at(0)).toMatchObject({ email: "prof@example.com" });
  });

  it("returns 400 for an unknown role", async () => {
    const { idToken } = await createSignedInUser("admin@example.com", "admin");

    const res = await listUsers(idToken, "janitor");

    expect(res.status).toBe(400);
  });
});
