import type { DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

/**
 * The single place enrollment requests are read and written.
 *
 * A request is the enrollment half of the professor-request pattern: the
 * professor flow records its intent on the user doc (`users/{uid}.professorStatus`)
 * and the admin surface reads it, instead of letting the applicant write directly
 * into the privileged list. Enrollment now works the same way — a student asks,
 * an admin decides, and only the admin's approval writes the enrollment doc.
 *
 * Storage: `requestedCourses` on `users/{uid}`, an array of
 * `{ classId, status, requestedAt }` with `status === "pending"`. A request that
 * is decided is REMOVED from the array rather than stored as "rejected" or
 * "approved" — the same way the professor flow clears the request once decided —
 * so the array only ever holds what an admin still owes an answer on, and the
 * approved result lives where the rest of the app already looks for it: the
 * enrollment doc at `users/{uid}/classes/{classId}`.
 *
 * Two Firestore constraints shape every write and read here, and both are easy
 * to get wrong silently:
 *
 * - The array is matched by `classId` in code, never by index. Array position
 *   filters (`arrayRemove`/`arrayUnion` with position, and update paths like
 *   `requestedCourses.0.status`) depend on `arrayPositionFilter` ordering, which
 *   the emulator defaults to UNORDERED_ARRAY — a position predicate that matches
 *   ANY element, so the wrong entry gets rewritten with no error.
 * - Firestore cannot filter on a field inside an array element. Neither
 *   `where("requestedCourses.status", "==", "pending")` (paths do not reach into
 *   array items) nor `where("requestedCourses", "array-contains", {classId,
 *   status, requestedAt})` (needs an exact match, so it would have to guess the
 *   timestamp) finds pending requests. Listing them therefore reads the user
 *   docs and filters in code — one round trip for the whole queue, then two
 *   batched reads to resolve courses and students.
 *
 * If the queue ever outgrows that, mirror requests into a top-level
 * `enrollmentRequests` collection with a `status` field and query it directly;
 * do not bolt a derived flag onto the user doc, which every write path would
 * then have to remember to maintain.
 *
 * Every caller is server-side (Admin SDK). `firestore.rules` grants the client no
 * access to `users/{uid}/classes`, and the request list is written through these
 * helpers from API routes only, exactly like enrollment itself.
 */

export const REQUEST_STATUS_PENDING = "pending";

/** One pending request as stored on the student's user doc. */
export type RequestedCourse = {
  classId: string;
  status: string;
  requestedAt: string;
};

/** A pending request with its course and student resolved — one admin list row. */
export type EnrollmentRequestRow = {
  classId: string;
  courseCode: string;
  name: string;
  term: string;
  year: number | null;
  section: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  requestedAt: string;
};

/** The fields of a `classes/{classId}` document the request list shows. */
export type RequestCourseSummary = {
  courseCode: string;
  name: string;
  term: string;
  year: number | null;
  section: string;
};

/** What `addEnrollmentRequest` did, so the route can report it honestly. */
export type AddRequestOutcome =
  /** The student is already on the roster — no request was created. */
  | { kind: "alreadyEnrolled" }
  /** A pending request for this class already existed; nothing was written. */
  | { kind: "alreadyRequested" }
  /** The pending entry was written (replacing a stale `cancelled` one). */
  | { kind: "requested"; requestedAt: string };

/** What `removeEnrollmentRequest` did. */
export type RemoveRequestOutcome =
  | { kind: "removed" }
  /** No pending entry for that class, so the caller's decision was stale. */
  | { kind: "notPending" };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Normalizes one `requestedCourses` entry.
 *
 * A missing or blank `classId` would otherwise read back as a pending request
 * with no course attached — a row an admin can neither approve nor name, which
 * is the failure this whole ticket exists to prevent. Anything malformed is
 * dropped on read instead of being shown or trusted.
 */
function parseRequestedEntry(value: unknown): RequestedCourse | null {
  if (!value || typeof value !== "object") return null;

  const entry = value as Record<string, unknown>;
  const classId = typeof entry.classId === "string" ? entry.classId.trim() : "";
  if (!classId) return null;

  return {
    classId,
    status: str(entry.status) || REQUEST_STATUS_PENDING,
    requestedAt: str(entry.requestedAt),
  };
}

/** Every entry on the user doc, normalized, malformed ones dropped. */
function parseRequestedCourses(value: unknown): RequestedCourse[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(parseRequestedEntry)
    .filter((entry): entry is RequestedCourse => entry !== null);
}

/** The pending requests on one user doc, newest duplicate collapsed. */
function pendingRequestsOn(userDoc: DocumentData | undefined): RequestedCourse[] {
  const seen = new Set<string>();
  const pending: RequestedCourse[] = [];

  for (const entry of parseRequestedCourses(userDoc?.requestedCourses)) {
    if (entry.status !== REQUEST_STATUS_PENDING || seen.has(entry.classId)) continue;
    seen.add(entry.classId);
    pending.push(entry);
  }

  return pending;
}

/**
 * The enrollment doc for `classId` under `users/{uid}/classes`, or null.
 *
 * Doc IDs are not guaranteed to equal the class id: the pre-request flow used
 * `add()` for some enrollments, so the code matches on the `class_id` field the
 * same way `lib/classAccess.ts` does, and returns the document id so callers can
 * delete or report it.
 */
export async function findEnrollmentDoc(
  uid: string,
  classId: string
): Promise<{ docId: string } | null> {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("classes")
    .where("class_id", "==", classId)
    .limit(1)
    .get();

  const doc = snapshot.docs[0];
  return doc ? { docId: doc.id } : null;
}

/**
 * Records a student's request to join `classId`.
 *
 * Idempotent by design, mirroring the enroll route it replaces: an enrolled
 * student is reported rather than given a pending entry, and a repeat call while
 * a request is pending is a no-op so a double click cannot queue two decisions.
 * A previously cancelled request is replaced by a fresh pending one, so a student
 * who withdrew can ask again.
 *
 * The whole write is one compare-and-set transaction, so a concurrent admin
 * approval can never be undone by a late request from the student.
 */
export async function addEnrollmentRequest(
  uid: string,
  classId: string
): Promise<AddRequestOutcome> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (transaction) => {
    const [userDoc, enrollmentSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(
        userRef.collection("classes").where("class_id", "==", classId).limit(1)
      ),
    ]);

    if (enrollmentSnapshot.docs.length > 0) return { kind: "alreadyEnrolled" as const };

    const entries = parseRequestedCourses(userDoc.data()?.requestedCourses);
    const existing = entries.find((entry) => entry.classId === classId);

    if (existing?.status === REQUEST_STATUS_PENDING) {
      return { kind: "alreadyRequested" as const };
    }

    const requestedAt = new Date().toISOString();

    // Rewriting the array keeps the write single-field and never depends on
    // array-position semantics. Entries that were cancelled are dropped rather
    // than kept as history: a cancelled request is not something an admin can
    // act on, and a new one supersedes it.
    const next = entries
      .filter((entry) => entry.classId !== classId)
      .concat({ classId, status: REQUEST_STATUS_PENDING, requestedAt });

    if (userDoc.exists) {
      transaction.update(userRef, { requestedCourses: next });
    } else {
      transaction.set(userRef, { requestedCourses: next });
    }

    return { kind: "requested" as const, requestedAt };
  });
}

/**
 * Drops the pending request for `classId`. Used by an admin's Reject, by a
 * student withdrawing their own request, and by Approve's cleanup step.
 *
 * The read that resolves the request row happens first, so a decision that is
 * already stale (rejected twice, approved elsewhere) is reported as `notPending`
 * instead of throwing the caller's transaction away on a document read that was
 * never going to change.
 */
export async function removeEnrollmentRequest(
  uid: string,
  classId: string
): Promise<RemoveRequestOutcome> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    const entries = parseRequestedCourses(userDoc.data()?.requestedCourses);
    const remaining = entries.filter(
      (entry) => !(entry.classId === classId && entry.status === REQUEST_STATUS_PENDING)
    );

    if (remaining.length === entries.length) return { kind: "notPending" as const };

    // arrayRemove with an object value would need an index that does not exist;
    // an arrayUnion of the survivor would leave the removed entry in place. A
    // whole-field write under transaction protection is what is left, and the
    // transaction makes it safe: this only ever runs after a read of the same
    // user doc, so a concurrent writer re-runs the transaction rather than
    // racing a partial update.
    transaction.update(userRef, { requestedCourses: remaining });

    return { kind: "removed" as const };
  });
}

/**
 * Writes the enrollment doc that an approved request becomes.
 *
 * Returns `alreadyEnrolled` when the student is already on the roster, so the
 * caller can answer 409 the way POST /api/admin/classes/[classId]/enrollments
 * does — the two approval paths (admin picks a student, admin approves a request)
 * must reject a duplicate identically.
 *
 * The pending entry is cleared here in the same transaction as the enrollment
 * write. Doing the two in separate requests would let an approval leave a pending
 * request behind that an admin could approve a second time.
 */
export async function approveEnrollmentRequest(
  uid: string,
  classId: string
): Promise<
  | { kind: "enrolled" }
  | { kind: "alreadyEnrolled" }
  | { kind: "noProfile" }
  | { kind: "notStudent" }
> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (transaction) => {
    const [userDoc, enrollmentSnapshot] = await Promise.all([
      transaction.get(userRef),
      transaction.get(
        userRef.collection("classes").where("class_id", "==", classId).limit(1)
      ),
    ]);

    if (!userDoc.exists) return { kind: "noProfile" as const };
    // Same check POST /api/admin/classes/[classId]/enrollments makes: an admin
    // approving a request must not be able to hand a roster seat to a profile
    // that is not a student (a role flip between request and approval, or a
    // hand-crafted request).
    if (userDoc.data()?.role !== "student") return { kind: "notStudent" as const };
    if (enrollmentSnapshot.docs.length > 0) return { kind: "alreadyEnrolled" as const };

    transaction.set(userRef.collection("classes").doc(classId), {
      class_id: classId,
      enrolledAt: new Date().toISOString(),
    });

    const remaining = parseRequestedCourses(userDoc.data()?.requestedCourses).filter(
      (entry) => !(entry.classId === classId && entry.status === REQUEST_STATUS_PENDING)
    );

    transaction.update(userRef, {
      requestedCourses: remaining,
    });

    return { kind: "enrolled" as const };
  });
}

/**
 * The class ids this user has a pending request for. Used by the browse list so
 * a student sees "Requested" instead of a second Request button.
 *
 * Reads one document — the user's own — so it costs nothing next to the reads
 * the browse list already does.
 */
export async function getPendingRequestedClassIds(uid: string): Promise<Set<string>> {
  const userDoc = await getAdminDb().collection("users").doc(uid).get();

  return new Set(pendingRequestsOn(userDoc.data()).map((request) => request.classId));
}

/**
 * How many pending requests exist school-wide. The /admin dashboard tile.
 *
 * Deliberately NOT part of `loadAdminClasses`/`studentCount`: those report
 * actual enrollments (END-21, END-48), and a queue length is a different
 * number answering a different question. Surfacing it as its own tile keeps
 * "who is enrolled" and "who is waiting" from ever being confused for each
 * other on the same screen.
 */
export async function countPendingRequests(): Promise<number> {
  const snapshot = await getAdminDb().collection("users").get();
  let count = 0;

  for (const doc of snapshot.docs) {
    count += pendingRequestsOn(doc.data()).length;
  }

  return count;
}

/**
 * Every pending enrollment request in the school, with its course and student
 * resolved — the answer to "which course did this student ask to join?".
 *
 * One read of `users` plus two batched `getAll` reads (courses, students) no
 * matter how many requests are in the queue, the same shape
 * `lib/adminClasses.ts:getProfessors` uses. The `users` read is unfiltered
 * because Firestore cannot filter into array elements (see the module comment):
 * a `where` on this array would either be a no-op or a guess. `getEnrollmentCounts`
 * in lib/adminClasses.ts already walks the user docs for the same reason, so the
 * admin surface has one read pattern to reason about, and a request stays
 * visible even if the requester's role changed after they asked.
 *
 * A course that was deleted after the request, or a student whose profile
 * vanished, drops out: a row with no course on it cannot be approved and cannot
 * answer the question the list exists to answer.
 */
export async function loadEnrollmentRequests(): Promise<EnrollmentRequestRow[]> {
  const db = getAdminDb();

  const userSnapshot = await db.collection("users").get();

  const entries: { studentUid: string; request: RequestedCourse }[] = [];

  for (const doc of userSnapshot.docs) {
    for (const request of pendingRequestsOn(doc.data())) {
      entries.push({ studentUid: doc.id, request });
    }
  }

  if (entries.length === 0) return [];

  const classIds = [...new Set(entries.map((entry) => entry.request.classId))];
  const studentUids = [...new Set(entries.map((entry) => entry.studentUid))];

  const [classDocs, studentDocs] = await Promise.all([
    db.getAll(...classIds.map((id) => db.collection("classes").doc(id))),
    db.getAll(...studentUids.map((id) => db.collection("users").doc(id))),
  ]);

  const courses = new Map<string, RequestCourseSummary>();
  classDocs.forEach((doc, index) => {
    if (!doc.exists) return;
    const data = doc.data();
    const year = Number(data?.year);
    courses.set(classIds[index], {
      courseCode: str(data?.courseCode),
      name: str(data?.name),
      term: str(data?.term),
      year: Number.isFinite(year) ? year : null,
      section: str(data?.section),
    });
  });

  const students = new Map<string, { name: string; email: string }>();
  studentDocs.forEach((doc, index) => {
    if (!doc.exists) return;
    students.set(studentUids[index], {
      name: str(doc.data()?.name),
      email: str(doc.data()?.email),
    });
  });

  const rows: EnrollmentRequestRow[] = [];

  for (const { studentUid, request } of entries) {
    const course = courses.get(request.classId);
    const student = students.get(studentUid);
    if (!course || !student) continue;

    rows.push({
      classId: request.classId,
      courseCode: course.courseCode,
      name: course.name,
      term: course.term,
      year: course.year,
      section: course.section,
      studentUid,
      studentName: student.name,
      studentEmail: student.email,
      requestedAt: request.requestedAt,
    });
  }

  // Oldest request first: an admin works a queue front to back, and a course
  // code break ties between two requests made in the same second.
  return rows.sort(
    (a, b) =>
      a.requestedAt.localeCompare(b.requestedAt) ||
      a.courseCode.localeCompare(b.courseCode) ||
      a.studentName.localeCompare(b.studentName)
  );
}
