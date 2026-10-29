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

/** One student on a class roster, as the admin user list shows them. */
export type RosterMember = { uid: string; name: string; email: string };

/** The fields of a `classes/{classId}` doc the admin user list shows. */
export type UserCourseSummary = {
  id: string;
  name: string;
  courseCode: string;
  term: string;
  year: number | null;
  section: string;
};

/** A course a professor teaches, with the students on its roster. */
export type TeachingCourse = UserCourseSummary & { students: RosterMember[] };

/**
 * Per-user course data for the admin user list (PANEL-22/23): the classes a
 * student is enrolled in, or the classes a professor teaches with each
 * course's roster.
 */
export type UserCourseData = {
  /** Populated for students; empty for everyone else. */
  courses: UserCourseSummary[];
  /** Populated for professors; empty for everyone else. */
  teaching: TeachingCourse[];
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

/** Same ordering as the course list, so both surfaces agree row by row. */
function byCourseCode(a: { courseCode: string; name: string }, b: { courseCode: string; name: string }) {
  const code = a.courseCode.localeCompare(b.courseCode);
  return code !== 0 ? code : a.name.localeCompare(b.name);
}

/** Stable roster order: by name, then email as a tiebreaker. */
function sortRoster(members: RosterMember[]) {
  return members.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.email.localeCompare(b.email) ||
      a.uid.localeCompare(b.uid)
  );
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
 * One walk over every student and their enrollment docs.
 *
 * Enrollment is stored as users/{uid}/classes/{doc} with a class_id field (see
 * lib/classAccess.ts), so any roster question means walking the students —
 * Firestore has no cross-collection read. This walk is THE source the admin
 * surface shares: `loadAdminClasses`' studentCount, the user list's per-student
 * course lists, and every professor roster it shows are all derived from this
 * single read, so two admin pages can never report different numbers for the
 * same course (the failure two copies of the join caused before).
 *
 * Returns, per class, its deduplicated roster (a student with the older
 * auto-ID enrollment doc plus a real one for the same class is one member,
 * matching the count's `seen` rule), and per student the deduplicated class
 * ids they are enrolled in. A school has far more students than classes; one
 * subcollection read per student, issued in parallel, keeps this correct
 * today. If the roster grows past a few thousand students, mirror enrollment
 * into classes/{classId}/enrollments and count there instead.
 */
async function loadEnrollmentWalk(): Promise<{
  rosters: Map<string, RosterMember[]>;
  studentCourseIds: Map<string, string[]>;
}> {
  const db = getAdminDb();
  const students = await db.collection("users").where("role", "==", "student").get();

  const rosters = new Map<string, RosterMember[]>();
  const studentCourseIds = new Map<string, string[]>();

  if (students.empty) return { rosters, studentCourseIds };

  const enrollments = await Promise.all(
    students.docs.map(async (doc) => ({
      uid: doc.id,
      name: str(doc.data().name),
      email: str(doc.data().email),
      classes: await db.collection("users").doc(doc.id).collection("classes").get(),
    }))
  );

  for (const student of enrollments) {
    const seen = new Set<string>();
    const courseIds: string[] = [];

    for (const enrollment of student.classes.docs) {
      const classId = enrollment.data().class_id;
      if (typeof classId !== "string" || seen.has(classId)) continue;

      seen.add(classId);
      courseIds.push(classId);

      const roster = rosters.get(classId) ?? [];
      roster.push({ uid: student.uid, name: student.name, email: student.email });
      rosters.set(classId, roster);
    }

    if (courseIds.length > 0) studentCourseIds.set(student.uid, courseIds);
  }

  return { rosters, studentCourseIds };
}

/**
 * Counts enrolled students per class, derived from the shared enrollment walk
 * so the course list, the dashboard, and the user list cannot disagree.
 */
async function getEnrollmentCounts(classIds: Set<string>) {
  const counts = new Map<string, number>();

  if (classIds.size === 0) return counts;

  classIds.forEach((id) => counts.set(id, 0));

  const { rosters } = await loadEnrollmentWalk();

  for (const [classId, members] of rosters) {
    if (counts.has(classId)) counts.set(classId, members.length);
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
 * Per-user course data for the admin user list (PANEL-22/23), one row per uid
 * in the given order.
 *
 * Students get the classes they are enrolled in; professors get the classes
 * whose `professor_id` is them, each with the students on its roster. Both
 * come from the same reads the course list and dashboard already make — the
 * classes collection once, plus the shared enrollment walk — so a professor's
 * roster here and the same course's `studentCount` on /admin/classes are two
 * views of one source, never two numbers.
 *
 * Reads are batched at the collection level: 2 round trips regardless of how
 * many users are listed, no per-row queries. A class deleted after an
 * enrollment, or one whose doc lost its professor, drops out of the lists the
 * same way it drops out of the course table — a course with no doc cannot be
 * named, so showing it would be a lie.
 */
export async function loadAdminUserCourses(
  users: { uid: string; role: string }[]
): Promise<Map<string, UserCourseData>> {
  const db = getAdminDb();
  const data = new Map<string, UserCourseData>();
  for (const user of users) {
    data.set(user.uid, { courses: [], teaching: [] });
  }

  if (users.length === 0) return data;

  const [classSnapshot, walk] = await Promise.all([
    db.collection("classes").get(),
    loadEnrollmentWalk(),
  ]);

  const courseById = new Map<string, UserCourseSummary & { professorId: string | null }>();
  for (const doc of classSnapshot.docs) {
    const d = doc.data();
    courseById.set(doc.id, {
      id: doc.id,
      name: str(d.name),
      courseCode: str(d.courseCode),
      term: str(d.term),
      year: typeof d.year === "number" ? d.year : null,
      section: str(d.section),
      professorId: typeof d.professor_id === "string" && d.professor_id ? d.professor_id : null,
    });
  }

  // Professors teach the classes pointing at them; the roster under each is
  // the same one the course table counts.
  const teachingByProfessor = new Map<string, TeachingCourse[]>();
  for (const course of courseById.values()) {
    if (!course.professorId) continue;
    const entry: TeachingCourse = {
      id: course.id,
      name: course.name,
      courseCode: course.courseCode,
      term: course.term,
      year: course.year,
      section: course.section,
      students: sortRoster([...(walk.rosters.get(course.id) ?? [])]),
    };
    const existing = teachingByProfessor.get(course.professorId) ?? [];
    existing.push(entry);
    teachingByProfessor.set(course.professorId, existing);
  }

  for (const user of users) {
    const row = data.get(user.uid);
    if (!row) continue;

    if (user.role === "student") {
      row.courses = (walk.studentCourseIds.get(user.uid) ?? [])
        .map((classId) => courseById.get(classId))
        .filter((course) => course !== undefined)
        .map(({ id, name, courseCode, term, year, section }) => ({
          id,
          name,
          courseCode,
          term,
          year,
          section,
        }))
        .sort(byCourseCode);
    } else if (user.role === "professor") {
      row.teaching = (teachingByProfessor.get(user.uid) ?? []).sort(byCourseCode);
    }
  }

  return data;
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
