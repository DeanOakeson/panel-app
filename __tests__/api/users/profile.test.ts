// PANEL-94: GET and POST /api/users answer a missing or bad token with 401,
// and only an outage with 500.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/users/route";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../../helpers/emulators";

function getProfile(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return GET(new Request("http://localhost/api/users", { headers }));
}

function postProfile(token: string | undefined, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return POST(
    new Request("http://localhost/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  );
}

beforeEach(clearEmulators);

describe("GET /api/users", () => {
  it("returns 401 without a token", async () => {
    const res = await getProfile();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Missing authentication token." });
  });

  it("returns 401, not 500, for a token that is not a real ID token", async () => {
    const res = await getProfile("not-a-real-token");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid or expired authentication token." });
  });

  it("returns 404 for a signed-in user with no profile", async () => {
    const { idToken } = await createSignedInUser("orphan@example.com");

    const res = await getProfile(idToken);

    expect(res.status).toBe(404);
  });

  it("returns the signed-in user's profile", async () => {
    const { uid, idToken } = await createSignedInUser("ada@example.com", "student");

    const res = await getProfile(idToken);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: uid, email: "ada@example.com", role: "student" });
  });

  it("returns 500 when the token can't be checked because of an outage", async () => {
    const outage = Object.assign(new Error("Error fetching public keys"), {
      code: "app/network-error",
    });
    const spy = vi.spyOn(getAdminAuth(), "verifyIdToken").mockRejectedValueOnce(outage);

    try {
      const res = await getProfile("any-token");
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("POST /api/users", () => {
  it("returns 401 without a token", async () => {
    const res = await postProfile(undefined, { name: "Ada", role: "student" });

    expect(res.status).toBe(401);
  });

  it("returns 401, not 500, for a token that is not a real ID token, and writes nothing", async () => {
    const res = await postProfile("not-a-real-token", { name: "Ada", role: "student" });

    expect(res.status).toBe(401);
    expect((await getAdminDb().collection("users").get()).empty).toBe(true);
  });
});
