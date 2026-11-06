import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "@/lib/firebaseAdmin";

/** verifyIdToken error codes that mean the token itself is bad. */
const TOKEN_ERROR_CODES = new Set([
  "auth/argument-error",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/invalid-id-token",
]);

export type TokenVerified = { error?: undefined; uid: string; decoded: DecodedIdToken };
export type TokenRejected = { error: NextResponse; uid?: undefined; decoded?: undefined };

/**
 * Verifies the request's `Authorization: Bearer <Firebase ID token>` header.
 *
 * - No token, or a token Firebase rejects (bad, expired, revoked) → returns a
 *   ready-to-send 401, so the client treats it as a sign-in problem.
 * - Anything else (missing Firebase Admin config, Google's signing keys
 *   unreachable) is thrown, not returned: the caller's catch answers 500, so
 *   an outage never looks like an expired session.
 *
 * ```ts
 * const auth = await verifyRequestToken(request);
 * if (auth.error) return auth.error;
 * // auth.uid is the verified caller
 * ```
 */
export async function verifyRequestToken(
  request: Request
): Promise<TokenVerified | TokenRejected> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    return {
      error: NextResponse.json(
        { error: "Missing authentication token." },
        { status: 401 }
      ),
    };
  }

  // A missing Firebase Admin config throws here, before the token check, so
  // it reaches the caller's catch (a 500) instead of becoming a 401.
  const auth = getAdminAuth();

  try {
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, decoded };
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;

    if (typeof code === "string" && TOKEN_ERROR_CODES.has(code)) {
      return {
        error: NextResponse.json(
          { error: "Invalid or expired authentication token." },
          { status: 401 }
        ),
      };
    }

    throw err;
  }
}
