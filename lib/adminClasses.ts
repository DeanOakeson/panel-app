import type { DocumentData } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";

/**
 * The single place the admin surface turns `classes/` documents into the rows
 * the admin pages show: professor resolved from `users/{professor_id}`, plus an
 * enrolled-student count per class.
 *
 * `GET /api/admin/classes` (the /admin/classes page) and `GET /api/admin/summary`
 * (the /admin dashboard tiles and course table) both read through here on
 * purpose. Two copies of the enrollment count is how a dashboard and a list
 * page start reporting different numbers for the same course.
 */

export type ProfessorSummary = { uid: string; name: string; email: string };

export type ClassSummary = {
  id: string;
  name: string;
  courseCode: string;
  year: number | null;
  term: string;
  section: string;
  professorId: string | null;
  professor: ProfessorSummary | null;
  studentCount: number;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Sort by course code then name so the list order is stable. */
function sortClasses(classes: ClassSummary[]) {
  return classes.sort((a, b) => {
    const code = a.courseCode.localeCompare(b.courseCode);
    return code !== 0 ? code : a.name.localeCompare(b.name);
  });
}

/**
 * Joins users/{professor_id} for the given classes in one batched read, so a
 * page with N courses costs 1 round trip instead of N. A professor whose
 * profile is missing (deleted account, bad id) yields `professor: null` and
 * the page renders "Unassigned" rather than failing.
 */
async function getProfessors(professorIds: (string | null)[]) {
  const db = getAdminDb();
  const ids = [...new Set(professorIds.filter((id): id is string => Boolean(id)))];

  if (ids.length === 0) return new Map<string, ProfessorSummary>();

  const docs = await db.getAll(...ids.map((id) => db.collection("users").doc(id)));
  const professors = new Map<string, ProfessorSummary>();

  docs.forEach((doc, index) => {
    if (!doc.exists) return;
    const data = doc.data() as DocumentData;
    professors.set(ids[index], {
      uid: ids[index],
      name: str(data.name),
      email: str(data.email),
    });
  });

  return professors;
}

/**
 * Counts enrolled students per class.
 *
 * Enrollment is stored as users/{uid}/classes/{doc} with a class_id field (see
 * lib/classAccess.ts), so totalling it means walking the students. A school has
 * far more students than classes and Firestore has no cross-collection count
 * without such a scan; one subcollection read per student keeps this correct
 * today. If the roster grows past a few thousand students, mirror enrollment
 * into classes/{classId}/enrollments and count there instead.
 */
async function getEnrollmentCounts(classIds: Set<string>) {
  const db = getAdminDb();
  const counts = new Map<string, number>();

  if (classIds.size === 0) return counts;

  classIds.forEach((id) => counts.set(id, 0));

  const students = await db.collection("users").where("role", "==", "student").get();

  const enrollments = await Promise.all(
    students.docs.map((doc) => db.collection("users").doc(doc.id).collection("classes").get())
  );

  for (const snapshot of enrollments) {
    const seen = new Set<string>();

    for (const enrollment of snapshot.docs) {
      const classId = enrollment.data().class_id;

      if (typeof classId !== "string" || !counts.has(classId) || seen.has(classId)) continue;

      seen.add(classId);
      counts.set(classId, (counts.get(classId) ?? 0) + 1);
    }
  }

  return counts;
}

/**
 * Every class with its professor and enrolled-student count, in stable order.
 *
 * `search` is matched case-insensitively against the course name and code; an
 * empty or blank search returns everything. Server-side because at class scale
 * it is cheaper than an index-backed range query.
 */
export async function loadAdminClasses(search = ""): Promise<ClassSummary[]> {
  const needle = search.trim().toLowerCase();
  const snapshot = await getAdminDb().collection("classes").get();

  const rows = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: str(data.name),
        courseCode: str(data.courseCode),
        professorId: typeof data.professor_id === "string" ? data.professor_id : null,
        year: typeof data.year === "number" ? data.year : null,
        term: str(data.term),
        section: str(data.section),
      };
    })
    .filter((row) => {
      if (!needle) return true;

      return (
        row.name.toLowerCase().includes(needle) ||
        row.courseCode.toLowerCase().includes(needle)
      );
    });

  const professors = await getProfessors(rows.map((row) => row.professorId));
  const counts = await getEnrollmentCounts(new Set(rows.map((row) => row.id)));

  return sortClasses(
    rows.map((row) => ({
      ...row,
      professor: row.professorId ? professors.get(row.professorId) ?? null : null,
      studentCount: counts.get(row.id) ?? 0,
    }))
  );
}

/**
 * How many users hold the given role. Used by the dashboard tiles.
 *
 * A plain read rather than a count() aggregate: the numbers are shown side by
 * side with the course rows above, and a count aggregate on the emulator has no
 * reason to disagree with the docs the rest of the admin surface reads.
 */
export async function countUsersByRole(role: "student" | "professor"): Promise<number> {
  const snapshot = await getAdminDb().collection("users").where("role", "==", role).get();

  return snapshot.size;
}
