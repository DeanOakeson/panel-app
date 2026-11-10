import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { requireAdmin } from "@/lib/adminGuard";
import { gradeHistory } from "@/lib/gradeHistory";
import type { DocumentData, DocumentReference } from "firebase-admin/firestore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const SUBMISSION_BUCKET = "assignment-submissions";

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
 * - promoting to professor sets `professorStatus: "approved"` (the admin action
 *   is the approval); demoting a professor resets a pending/approved status.
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

      // Promotion: an admin promoting someone to professor IS the approval.
      // Without this, a pending applicant moved to `professor` keeps
      // `professorStatus: "pending"`: `lib/homePath.ts` still routes them to
      // /pending-approval instead of the professor dashboard, and the Reject
      // button on the approve/reject endpoint (`app/api/users/route.ts`, which
      // only accepts a pending applicant) would demote them back to student and
      // stamp `rejected` onto someone who is already teaching. So the status
      // becomes "approved" — the same value the approve route writes.
      if (requestedRole === "professor") {
        update.professorStatus = "approved";
      }

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
 * Submissions and grades belonging to this user, by *uid*, everywhere they can
 * exist. Two walks, deliberately overlapping:
 *
 * 1. the enrollment-based walk: every assignment inside every class the user is
 *    currently enrolled in contributes `.../submissions/{uid}` and
 *    `.../grades/{uid}`. Exact document paths, no index needed. This also
 *    covers a grade whose submission doc is already gone, because it is derived
 *    from enrollment rather than from the submission list.
 * 2. the collection-group sweep: `where("studentId" == uid)` across all
 *    `submissions` / `grades` subcollections. This is what catches docs the
 *    enrollment walk cannot reach — the admin unenroll route
 *    (`app/api/admin/classes/[classId]/enrollments/[studentId]`) deletes only
 *    the enrollment mirror and leaves submissions behind, so after an
 *    enroll → submit → unenroll → delete-user sequence the user's submission
 *    sits in a class they are no longer enrolled in. Both routes stamp
 *    `studentId` into the doc body (see `app/components/Types.ts`: "The IDs
 *    repeat the path so a collection-group query can filter by them"), so the
 *    sweep is the intended way to find them.
 *
 * References are deduped by path: the two walks hit the same doc for any
 * currently-enrolled class, and the batch would otherwise carry duplicate
 * deletes.
 */
async function readUserOwnedClassDocs(uid: string, classIds: string[]) {
  const db = getAdminDb();
  const byPath = new Map<string, DocumentReference>();

  const add = (ref: DocumentReference) => byPath.set(ref.path, ref);

  // Walk 1: assignment-scoped, enrollment-based.
  for (const classId of classIds) {
    const assignments = await db
      .collection("classes")
      .doc(classId)
      .collection("assignments")
      .get();

    for (const assignment of assignments.docs) {
      add(assignment.ref.collection("submissions").doc(uid));
      add(assignment.ref.collection("grades").doc(uid));
    }
  }

  // Walk 2: uid-scoped sweep across every class, catches unenrolled leftovers.
  const [submissions, grades] = await Promise.all([
    db.collectionGroup("submissions").where("studentId", "==", uid).get(),
    db.collectionGroup("grades").where("studentId", "==", uid).get(),
  ]);

  for (const doc of submissions.docs) add(doc.ref);
  for (const doc of grades.docs) add(doc.ref);

  const refs = [...byPath.values()];
  return {
    submissionRefs: refs.filter((ref) =>
      ref.path.endsWith("/submissions/" + uid)
    ),
    gradeRefs: refs.filter((ref) => ref.path.endsWith("/grades/" + uid)),
  };
}


function getSubmissionFilePaths(data: DocumentData | undefined): string[] {
  if (!data) return [];

  const paths = new Set<string>();

  if (typeof data.filePath === "string") {
    paths.add(data.filePath);
  }

  if (Array.isArray(data.submissionHistory)) {
    for (const submission of data.submissionHistory) {
      if (typeof submission?.filePath === "string") {
        paths.add(submission.filePath);
      }
    }
  }

  return [...paths];
}

async function readUserSubmissionFilePaths(
  submissionRefs: DocumentReference[],
) {
  const snapshots = await Promise.all(
    submissionRefs.map((ref) => ref.get()),
  );

  const paths = new Set<string>();

  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;

    for (const path of getSubmissionFilePaths(snapshot.data())) {
      paths.add(path);
    }
  }

  return [...paths];
}

async function findUnreferencedSubmissionFiles(
  candidatePaths: string[],
  deletingSubmissionRefs: DocumentReference[],
) {
  if (candidatePaths.length === 0) return [];

  const db = getAdminDb();
  const candidates = new Set(candidatePaths);
  const deletingPaths = new Set(
    deletingSubmissionRefs.map((ref) => ref.path),
  );
  const referencedPaths = new Set<string>();

  const submissions = await db.collectionGroup("submissions").get();

  for (const submission of submissions.docs) {
    if (deletingPaths.has(submission.ref.path)) continue;

    for (const path of getSubmissionFilePaths(submission.data())) {
      if (candidates.has(path)) {
        referencedPaths.add(path);
      }
    }
  }

  return candidatePaths.filter((path) => !referencedPaths.has(path));
}

/**
 * DELETE /api/admin/users/[uid] — ADMIN-ONLY.
 *
 * Removes the Firebase Auth account, the `users/{uid}` profile, the user's
 * `users/{uid}/classes/*` enrollment mirrors, and their submission and grade
 * docs, with each grade's history. Self-deletion is refused.
 *
 * Submissions/grades are found by uid rather than by current enrollment, so a
 * submission left behind by an earlier unenroll is still removed — see
 * readUserOwnedClassDocs.
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
        { status: 403 },
      );
    }

    const db = getAdminDb();
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    let authAccountExists = true;

    try {
      await getAdminAuth().getUser(uid);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code !== "auth/user-not-found") {
        throw err;
      }

      authAccountExists = false;
    }

    if (!userDoc.exists && !authAccountExists) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 },
      );
    }

    // Collect all user-owned documents before deleting anything.
    const enrollments = await readEnrollments(uid);

    const { submissionRefs, gradeRefs } = await readUserOwnedClassDocs(
      uid,
      enrollments.map((enrollment) => enrollment.classId),
    );

    // Collect both current submission files and all historical files.
    const allFilePaths = await readUserSubmissionFilePaths(submissionRefs);

    // Do not delete files referenced by another active submission record.
    const filesToDelete = await findUnreferencedSubmissionFiles(
      allFilePaths,
      submissionRefs,
    );

    // Delete grade history before deleting the grade documents.
    for (const gradeRef of gradeRefs) {
      await db.recursiveDelete(gradeHistory(gradeRef));
    }

    // Create a durable cleanup task before deleting Firestore records.
    // It remains in the waiting state until Firestore deletion succeeds.
    let cleanupTaskRef: DocumentReference | null = null;

    if (filesToDelete.length > 0) {
      cleanupTaskRef = db.collection("storageCleanupTasks").doc();

      await cleanupTaskRef.set({
        userId: uid,
        bucket: SUBMISSION_BUCKET,
        filePaths: filesToDelete,
        status: "waiting_for_firestore_delete",
        createdAt: new Date().toISOString(),
      });
    }

    const docsToDelete: DocumentReference[] = [
      ...enrollments.map((enrollment) => enrollment.ref),
      ...submissionRefs,
      ...gradeRefs,
      userRef,
    ];

    // Firestore batches have a 500-write limit.
    for (let i = 0; i < docsToDelete.length; i += 500) {
      const batch = db.batch();

      for (const ref of docsToDelete.slice(i, i + 500)) {
        batch.delete(ref);
      }

      await batch.commit();
    }

    let storageCleanupPending = false;

    // Mark cleanup as pending only after all Firestore deletions succeed.
    if (cleanupTaskRef) {
      await cleanupTaskRef.update({
        status: "pending",
        updatedAt: new Date().toISOString(),
      });

      try {
        const { error: storageError } = await getSupabaseAdmin()
          .storage.from(SUBMISSION_BUCKET)
          .remove(filesToDelete);

        if (storageError) {
          throw storageError;
        }

        // Remove the task after successful file cleanup.
        await cleanupTaskRef.delete();
      } catch (cleanupError) {
        storageCleanupPending = true;

        console.error(
          "Supabase submission file cleanup failed:",
          {
            userId: uid,
            filePaths: filesToDelete,
            error: cleanupError,
          },
        );

        // Keep the task so a background job can retry it.
        try {
          await cleanupTaskRef.set(
            {
              status: "failed",
              lastError:
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError),
              updatedAt: new Date().toISOString(),
            },
            { merge: true },
          );
        } catch (taskError) {
          console.error(
            "Could not update submission cleanup task:",
            taskError,
          );
        }
      }
    }

    // Delete Firebase Authentication account last.
    if (authAccountExists) {
      await getAdminAuth().deleteUser(uid);
    }

    return NextResponse.json({
      success: true,
      deleted: uid,
      removedEnrollments: enrollments.length,
      removedSubmissions: submissionRefs.length,
      removedGrades: gradeRefs.length,
      removedSubmissionFiles: storageCleanupPending
        ? 0
        : filesToDelete.length,
      storageCleanupPending,
    });
  } catch (error) {
    console.error("DELETE /api/admin/users/[uid] failed:", error);

    return NextResponse.json(
      { error: "Failed to delete user." },
      { status: 500 },
    );
  }
}
