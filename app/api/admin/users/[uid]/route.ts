import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";
import type { DocumentReference } from "firebase-admin/firestore";

type RouteContext = { params: Promise<{ uid: string }> };

/**
 * Roles an admin may move a user into. "admin" is intentionally excluded here,
 * matching the `ASSIGNABLE_ROLES` stance in `app/api/admin/users/route.ts`:
 * minting admins through this endpoint would make privilege escalation as easy
 * as a PATCH, so it stays out until there is a deliberate admin-promotion story.
 */
const ASSIGNABLE_ROLES = ["student", "professor"] as const;

/**
 * professorStatus values that must be cleared when a user stops being a
 * professor. See the demotion branch in PATCH below for why.
 */
const PROFESSOR_STATUSES_TO_CLEAR = ["pending", "approved"] as const;

/** Fields the profile owns but this endpoint never lets a caller write. */
const READ_ONLY_FIELDS = ["email", "password", "uid", "professorStatus"];

/**
 * PATCH /api/admin/users/[uid] — ADMIN-ONLY.
 *
 * Updates `name` and/or `role` on `users/{uid}`. Guardrails:
 * - the caller may not change **their own** role (an admin demoting themself
 *   could delete the last admin account), and may not delete themself;
 * - `role` is limited to student|professor — never `admin`;
 * - demoting a professor resets a pending/approved `professorStatus`.
 *
 * Body: any of `{ name, role }`. At least one is required.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { error, admin } = await requireAdmin(request);
    if (error) return error;

    const { uid } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const b = body as Record<string, unknown>;

    for (const field of READ_ONLY_FIELDS) {
      if (field in b) {
        return NextResponse.json(
          {
            error: `${field} cannot be changed from this endpoint.`,
          },
          { status: 400 }
        );
      }
    }

    const wantsName = "name" in b;
    const wantsRole = "role" in b;

    if (!wantsName && !wantsRole) {
      return NextResponse.json(
        { error: "Provide at least one of: name, role." },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {};

    if (wantsName) {
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name) {
        return NextResponse.json({ error: "Name is required." }, { status: 400 });
      }
      if (name.length > 200) {
        return NextResponse.json(
          { error: "Name must be 200 characters or fewer." },
          { status: 400 }
        );
      }
      update.name = name;
    }

    let requestedRole: string | undefined;
    if (wantsRole) {
      const role =
        typeof b.role === "string" ? b.role.trim().toLowerCase() : "";
      if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
        return NextResponse.json(
          { error: "Role must be one of: student, professor." },
          { status: 400 }
        );
      }
      requestedRole = role;
    }

    // An admin may not change their own role. This is the lockout guard: as
    // long as nobody can step down from admin, there is always at least one
    // admin left who can reach /admin and fix accounts.
    if (requestedRole !== undefined && uid === admin.uid) {
      return NextResponse.json(
        {
          error:
            "You cannot change your own role. Ask another admin so the last admin cannot be locked out.",
        },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const current = userDoc.data() ?? {};
    const currentRole = current.role as string | undefined;

    if (requestedRole !== undefined) {
      update.role = requestedRole;

      // A demoted professor must not keep a professor-shaped status:
      // - "approved" would leave them with a status that no longer matches a
      //   role that grants them nothing, and `app/api/users/route.ts` treats an
      //   approved status as protected, so it would never clear on its own;
      // - "pending" would keep routing them to /pending-approval after the
      //   change (see lib/homePath.ts) instead of the student dashboard.
      // Both are reset to "not_requested", the same value a fresh student
      // profile carries, so they can apply to be a professor again later.
      const professorStatus = current.professorStatus as string | undefined;
      if (
        currentRole === "professor" &&
        requestedRole === "student" &&
        (PROFESSOR_STATUSES_TO_CLEAR as readonly string[]).includes(
          professorStatus ?? ""
        )
      ) {
        update.professorStatus = "not_requested";
      }
    }

    await userRef.set(update, { merge: true });

    // Read the document back so the response reports what is actually stored
    // rather than what was requested.
    const after = (await userRef.get()).data() ?? {};

    return NextResponse.json({
      success: true,
      uid,
      name: (after.name as string | undefined) ?? "",
      email: (after.email as string | undefined) ?? "",
      role: after.role as string | undefined,
      professorStatus: after.professorStatus as string | undefined,
    });
  } catch (error) {
    console.error("PATCH /api/admin/users/[uid] failed:", error);
    return NextResponse.json(
      { error: "Failed to update user." },
      { status: 500 }
    );
  }
}

/**
 * Every `users/{uid}/classes/{classId}` enrollment mirror for this user, plus
 * the class ids they point at. Enrollments live on the user side only
 * (`lib/classAccess.ts` and the admin roster routes both read them here), so
 * deleting these removes the user's enrollment entries from the data model.
 */
async function readEnrollments(uid: string) {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .get();

  return snapshot.docs.map((doc) => ({
    ref: doc.ref,
    classId: (doc.data().class_id as string | undefined) ?? doc.id,
  }));
}

/**
 * Submission docs this user owns inside a class: the submit route writes them
 * at `classes/{classId}/assignments/{assignmentId}/submissions/{uid}` (see
 * `app/api/classes/[classId]/assignments/[assignmentId]/submit/route.ts`), so
 * they only live in classes the user was enrolled in.
 */
async function readSubmissionRefs(uid: string, classIds: string[]) {
  const db = getAdminDb();
  const refs: DocumentReference[] = [];

  for (const classId of classIds) {
    const assignments = await db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .get();

    for (const assignment of assignments.docs) {
      refs.push(assignment.ref.collection("submissions").doc(uid));
    }
  }

  return refs;
}

/**
 * DELETE /api/admin/users/[uid] — ADMIN-ONLY.
 *
 * Removes the Firebase Auth account, the `users/{uid}` profile, the user's
 * `users/{uid}/classes/*` enrollment mirrors, and their submission docs in
 * those classes. Self-deletion is refused.
 *
 * Classes the user taught are left alone: `professor_id` keeps pointing at the
 * removed uid, which the admin class detail view already renders as
 * "Unassigned". Deleting a user must never take a course with it — that is the
 * course-delete feature's job.
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    const { error, admin } = await requireAdmin(request);
    if (error) return error;

    const { uid } = await params;

    if (uid === admin.uid) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 403 }
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    let authAccountExists = true;
    try {
      await getAdminAuth().getUser(uid);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== "auth/user-not-found") throw err;
      authAccountExists = false;
    }

    if (!userDoc.exists && !authAccountExists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    // Collect everything that hangs off this user before deleting anything, so
    // a mid-way failure leaves a recoverable (and retryable) state rather than
    // a half-wiped one.
    const enrollments = await readEnrollments(uid);
    const submissionRefs = await readSubmissionRefs(
      uid,
      enrollments.map((e) => e.classId)
    );

    const docsToDelete: DocumentReference[] = [
      ...enrollments.map((e) => e.ref),
      ...submissionRefs,
      userRef,
    ];

    // Firestore batches cap at 500 writes; enrollments and submissions are far
    // below that for any real account, but chunk so the route can't blow up on
    // an outlier.
    for (let i = 0; i < docsToDelete.length; i += 500) {
      const batch = db.batch();
      for (const ref of docsToDelete.slice(i, i + 500)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    // The Auth account goes last: everything Firestore-side is already gone, so
    // a failure here cannot leave an orphaned profile or enrollment doc.
    if (authAccountExists) {
      await getAdminAuth().deleteUser(uid);
    }

    return NextResponse.json({
      success: true,
      deleted: uid,
      removedEnrollments: enrollments.length,
      removedSubmissions: submissionRefs.length,
    });
  } catch (error) {
    console.error("DELETE /api/admin/users/[uid] failed:", error);
    return NextResponse.json(
      { error: "Failed to delete user." },
      { status: 500 }
    );
  }
}
