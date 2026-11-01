import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getServiceAccountCredential, toPrivateKeyPem } from "@/lib/firebaseAdmin";

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

/** The key as it appears in a service account JSON file, with escaped newlines. */
const escaped = pem.replace(/\n/g, "\\n");

/** The escaped key with its BEGIN and END lines removed. */
const bodyOnly = pem
  .replace("-----BEGIN PRIVATE KEY-----\n", "")
  .replace("\n-----END PRIVATE KEY-----\n", "")
  .replace(/\n/g, "\\n");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toPrivateKeyPem", () => {
  it("leaves a PEM key unchanged", () => {
    expect(toPrivateKeyPem(pem)).toBe(pem);
  });

  it("turns escaped newlines into real ones", () => {
    expect(toPrivateKeyPem(escaped)).toBe(pem);
  });

  it("restores the BEGIN and END lines of a key stored without them", () => {
    expect(toPrivateKeyPem(bodyOnly)).toBe(pem);
  });
});

describe("getServiceAccountCredential", () => {
  it("accepts a key stored without its BEGIN and END lines", () => {
    vi.stubEnv("FIREBASE_PROJECT_ID", "demo-panel-app");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "admin@demo-panel-app.iam.gserviceaccount.com");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", bodyOnly);

    expect(() => getServiceAccountCredential()).not.toThrow();
  });
});
