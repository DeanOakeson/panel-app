import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";

/** The caller's `users/{uid}` profile, loaded after the admin role was confirmed. */
export type AdminProfile = {
  uid: string;
  role: "admin";
  name: string;
  email: string;
};

/** Granted: the caller is an admin and `admin` carries their profile. */
export type AdminGranted = { error?: undefined; admin: AdminProfile };

/** Denied: return `error` straight to the client — it already has the status and body. */
export type AdminDenied = { error: NextResponse; admin?: undefined };

export type AdminGuardResult = AdminGranted | AdminDenied;

/**
 * The one admin check for API routes. Verifies the `Authorization: Bearer <id
 * token>` header against Firebase, loads `users/{uid}`, and only then looks at
 * the role. Role comes from Firestore alone — `ADMIN_UID` is not consulted.
 *
 * Status contract:
 * - **401 Unauthorized** — the caller's identity could not be established: no
 *   `Bearer` token in the request, or a token that is invalid, expired, or
 *   malformed. Nothing further is read from Firestore.
 * - **403 Forbidden** — identity is proven but the caller may not act as an
 *   admin: no `users/{uid}` document, or a document whose `role` is not
 *   `"admin"`. Re-logging in will not change this, so the client must not
 *   treat 403 as a session problem.
 *
 * Any other failure (emulator or Firestore error) is thrown, not returned, so a
 * caller cannot mistake an outage for a denial. Wrap the call in `try/catch`
 * and answer 500 the way the existing admin routes do.
 *
 * Use it at the top of a route and pass the denial through unchanged:
 *
 * ```ts
 * const { error, admin } = await requireAdmin(request);
 * if (error) return error;
 * // admin.uid is the verified admin
 * ```
 *
 * A test needs no helper from this module: build a `Request` with the token from
 * `createSignedInUser()` in `__tests__/helpers/emulators.ts` and call it directly.
 */
export async function requireAdmin(request: Request): Promise<AdminGuardResult> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    return {
      error: NextResponse.json(
        { error: "Missing authentication token." },
        { status: 401 }
      ),
    };
  }

  let uid: string;

  try {
    uid = (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid or expired authentication token." },
        { status: 401 }
      ),
    };
  }

  const userDoc = await getAdminDb().collection("users").doc(uid).get();
  const profile = userDoc.data();
  const role = profile?.role as string | undefined;

  if (!userDoc.exists || role !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      ),
    };
  }

  return {
    admin: {
      uid,
      role: "admin",
      name: (profile?.name as string | undefined) ?? "",
      email: (profile?.email as string | undefined) ?? "",
    },
  };
}
