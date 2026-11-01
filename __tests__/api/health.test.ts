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

  it("reports a credential that cannot be built without returning the key", async () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "demo-panel-app");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "admin@demo-panel-app.iam.gserviceaccount.com");
    vi.stubEnv(
      "FIREBASE_PRIVATE_KEY",
      "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key-body\\n-----END PRIVATE KEY-----\\n"
    );

    const text = await (await GET()).text();
    const body = JSON.parse(text);

    expect(text).not.toContain("not-a-real-key-body");
    expect(body.credential.ok).toBe(false);
    expect(body.clientEmailMatchesProject).toBe(true);
    expect(body.privateKey).toMatchObject({ escapedNewlines: true, newlines: false });
  });

  it("describes how the private key is formatted", async () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nbody\n-----END PRIVATE KEY-----\n";

    vi.stubEnv("FIREBASE_PRIVATE_KEY", `"${pem}"`);
    expect((await (await GET()).json()).privateKey).toMatchObject({
      quoted: true,
      newlines: true,
      json: false,
      base64Pem: false,
    });

    vi.stubEnv("FIREBASE_PRIVATE_KEY", Buffer.from(pem).toString("base64"));
    expect((await (await GET()).json()).privateKey).toMatchObject({
      quoted: false,
      base64Pem: true,
    });

    vi.stubEnv("FIREBASE_PRIVATE_KEY", JSON.stringify({ private_key: pem }));
    expect((await (await GET()).json()).privateKey).toMatchObject({ json: true });
  });
});
