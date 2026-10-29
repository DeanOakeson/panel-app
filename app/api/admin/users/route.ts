import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { loadAdminUserCourses } from "@/lib/adminClasses";

/**
 * ADMIN-ONLY. Creates a Firebase Auth account + a users/{uid} profile record
 * with a role. The caller must hold a valid Firebase ID token AND have
 * role === "admin" in their own users/{uid} document.
 *
 * NOTE (by design, to be hardened later): role is read from Firestore, and the
 * current Firestore rules are open for development. Do not rely on this as a
 * final security boundary — tighten rules before production.
 */

// Roles an admin can assign through the form. "admin" is intentionally NOT
// self-mintable here to prevent accidental privilege escalation / admin sprawl.
const ASSIGNABLE_ROLES = ["student", "professor"] as const;

// Simple well-formedness check. Firebase still does authoritative validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getCallerRole(uid: string): Promise<string | null> {
  const doc = await getAdminDb().collection("users").doc(uid).get();
  return (doc.data()?.role as string | undefined) ?? null;
}

export async function POST(req: Request) {
  try {
    // 1. Require a valid Firebase ID token.
    const token = req.headers.get("authorization")?.split("Bearer ")[1];
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let decoded: { uid: string };
    try {
      decoded = await getAdminAuth().verifyIdToken(token);
    } catch {
      return Response.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const callerUid = decoded.uid;

    // 2. Only admins may use this endpoint.
    const callerRole = await getCallerRole(callerUid);
    if (callerRole !== "admin") {
      return Response.json(
        { error: "Forbidden: admin role required" },
        { status: 403 }
      );
    }

    // 3. Parse and validate the request body.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const b = (body ?? {}) as Record<string, unknown>;
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const email =
      typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const role = typeof b.role === "string" ? b.role.trim().toLowerCase() : "";
    const password = typeof b.password === "string" ? b.password : "";

    if (!name) {
      return Response.json({ error: "Name is required." }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return Response.json(
        { error: "Invalid email address." },
        { status: 400 }
      );
    }
    if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
      return Response.json(
        { error: "Role must be one of: student, professor." },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return Response.json(
        { error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    // 4. Create the Firebase Auth account.
    //    On a duplicate email, createUser throws before anything is persisted,
    //    so nothing is created — exactly the required behavior.
    let uid: string;
    try {
      const userRecord = await getAdminAuth().createUser({
        email,
        password,
        displayName: name,
        emailVerified: false,
      });
      uid = userRecord.uid;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // firebase-admin reports the duplicate as "auth/email-already-exists";
      // the client SDK uses "auth/email-already-in-use". Accept both.
      if (
        code === "auth/email-already-in-use" ||
        code === "auth/email-already-exists"
      ) {
        return Response.json(
          { error: "A user with this email already exists." },
          { status: 409 }
        );
      }
      if (code === "auth/invalid-email") {
        return Response.json(
          { error: "Invalid email address." },
          { status: 400 }
        );
      }
      throw err;
    }

    // 5. Persist the users/{uid} profile with the role.
    //    If this fails, clean up the orphaned auth account so we don't leave a
    //    half-created user behind.
    try {
      await getAdminDb()
        .collection("users")
        .doc(uid)
        .set({
          name,
          email,
          role,
          createdAt: new Date(),
        });
    } catch (err) {
      try {
        await getAdminAuth().deleteUser(uid);
      } catch {
        // Ignore cleanup failure; surface the original error via the rethrow.
      }
      throw err;
    }

    return Response.json(
      { success: true, uid, email, role },
      { status: 201 }
    );
  } catch {
    return Response.json(
      { error: "Failed to create user." },
      { status: 500 }
    );
  }
}

/**
 * ADMIN-ONLY. Lists users, optionally filtered by role:
 * GET /api/admin/users?role=professor
 * Returns uid, name, email, and role — plus each user's course data (PANEL-22/23):
 * the classes a student is enrolled in, or the classes a professor teaches with
 * the students on each roster. The join lives in lib/adminClasses.ts, so the
 * course list, the dashboard, and this page cannot report different numbers for
 * the same course. Role is included because the admin user list edits it; the
 * filter values are unchanged.
 */
export async function GET(req: Request) {
  try {
    const token = req.headers.get("authorization")?.split("Bearer ")[1];
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let callerUid: string;
    try {
      callerUid = (await getAdminAuth().verifyIdToken(token)).uid;
    } catch {
      return Response.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    if ((await getCallerRole(callerUid)) !== "admin") {
      return Response.json(
        { error: "Forbidden: admin role required" },
        { status: 403 }
      );
    }

    const role = new URL(req.url).searchParams.get("role");
    let query: FirebaseFirestore.Query = getAdminDb().collection("users");

    if (role) {
      if (!["student", "professor", "admin"].includes(role)) {
        return Response.json({ error: "Unknown role." }, { status: 400 });
      }
      query = query.where("role", "==", role);
    }

    const snapshot = await query.get();
    const users = snapshot.docs
      .map((doc) => ({
        uid: doc.id,
        name: (doc.data().name as string | undefined) ?? "",
        email: (doc.data().email as string | undefined) ?? "",
        role: (doc.data().role as string | undefined) ?? "",
      }))
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

    // One shared join for the whole page: 2 collection reads regardless of how
    // many users are listed, no per-row queries.
    const courseData = await loadAdminUserCourses(
      users.map((user) => ({ uid: user.uid, role: user.role }))
    );

    return Response.json(
      {
        users: users.map((user) => ({
          ...user,
          ...courseData.get(user.uid),
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET /api/admin/users error:", error);
    return Response.json({ error: "Failed to load users." }, { status: 500 });
  }
}
