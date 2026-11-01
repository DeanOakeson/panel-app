import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("reports that the Firebase Admin SDK loads", async () => {
    const body = await (await GET()).json();

    expect(body.firebaseAdmin).toEqual({
      app: { ok: true },
      auth: { ok: true },
      firestore: { ok: true },
    });
  });

  it("reports whether secrets are set without returning their values", async () => {
    vi.stubEnv(
      "FIREBASE_PRIVATE_KEY",
      "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----\n"
    );
    vi.stubEnv("SUPABASE_SECRET_KEY", "supabase-secret-value");

    const text = await (await GET()).text();

    expect(text).not.toContain("private-key-body");
    expect(text).not.toContain("supabase-secret-value");
    expect(JSON.parse(text).env).toMatchObject({
      FIREBASE_PRIVATE_KEY: true,
      FIREBASE_PRIVATE_KEY_IS_PEM: true,
      SUPABASE_SECRET_KEY: true,
    });
  });
});
