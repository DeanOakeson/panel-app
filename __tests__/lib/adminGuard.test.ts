import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "@/lib/adminGuard";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { clearEmulators, createSignedInUser } from "../helpers/emulators";

/** A request shaped like the ones the admin routes receive. */
function adminRequest(idToken?: string) {
  const headers: Record<string, string> = {};
  if (idToken) headers.authorization = `Bearer ${idToken}`;

  return new Request("http://localhost/api/admin/anything", { headers });
}

beforeEach(clearEmulators);

describe("requireAdmin", () => {
  it("returns 401 without a token", async () => {
    const { error, admin } = await requireAdmin(adminRequest());

    expect(admin).toBeUndefined();
    expect(error?.status).toBe(401);
    await expect(error?.json()).resolves.toEqual({
      error: "Missing authentication token.",
    });
  });

  it("returns 401 for a token that is not a Bearer token", async () => {
    const { uid } = await createSignedInUser("admin@example.com", "admin");
    const request = new Request("http://localhost/api/admin/anything", {
      headers: { authorization: uid },
    });

    const { error } = await requireAdmin(request);

    expect(error?.status).toBe(401);
  });

  it("returns 401 for a token that is not a real ID token", async () => {
    const { error } = await requireAdmin(adminRequest("not-a-firebase-token"));

    expect(error?.status).toBe(401);
    await expect(error?.json()).resolves.toEqual({
      error: "Invalid or expired authentication token.",
    });
  });

  it.each(["student", "professor"])(
    "returns 403 for an authenticated %s",
    async (role) => {
      const { idToken } = await createSignedInUser(
        `${role}@example.com`,
        role
      );

      const { error, admin } = await requireAdmin(adminRequest(idToken));

      expect(admin).toBeUndefined();
      expect(error?.status).toBe(403);
      await expect(error?.json()).resolves.toEqual({
        error: "Administrator access required.",
      });
    }
  );

  it("returns 403 for a signed-in user with no users/{uid} profile", async () => {
    const { idToken } = await createSignedInUser("orphan@example.com");

    const { error } = await requireAdmin(adminRequest(idToken));

    expect(error?.status).toBe(403);
  });

  it("returns the admin profile for an admin token", async () => {
    const { uid, idToken } = await createSignedInUser("admin@example.com", "admin");
    await getAdminDb()
      .collection("users")
      .doc(uid)
      .set({ email: "admin@example.com", role: "admin", name: "Ada Admin" });

    const { admin, error } = await requireAdmin(adminRequest(idToken));

    expect(error).toBeUndefined();
    expect(admin).toEqual({
      uid,
      role: "admin",
      name: "Ada Admin",
      email: "admin@example.com",
    });
  });

  it("does not accept an admin uid from outside Firestore", async () => {
    // The ADMIN_UID shortcut the older routes use must not be honoured here:
    // a token whose uid matches the env var is still a 403 without role=admin.
    const { uid, idToken } = await createSignedInUser("nobody@example.com", "student");
    process.env.ADMIN_UID = uid;

    try {
      const { error } = await requireAdmin(adminRequest(idToken));

      expect(error?.status).toBe(403);
    } finally {
      delete process.env.ADMIN_UID;
    }
  });

  it("throws instead of returning 401 when the token can't be checked", async () => {
    // Simulates an outage, such as Google's signing keys being unreachable.
    // Only verifyIdToken is replaced, and only for this test.
    const outage = Object.assign(new Error("Error fetching public keys"), {
      code: "app/network-error",
    });
    const spy = vi.spyOn(getAdminAuth(), "verifyIdToken").mockRejectedValueOnce(outage);

    try {
      await expect(requireAdmin(adminRequest("any-token"))).rejects.toBe(outage);
    } finally {
      spy.mockRestore();
    }
  });
});
