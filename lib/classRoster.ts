import type { DocumentReference, Query } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import {
  buildGradebook,
  rosterIds,
  type Gradebook,
  type StoredWork,
} from "@/lib/gradebook";
import {
  countGradingStatuses,
  getGradingStatus,
  type GradingCounts,
} from "@/lib/gradingStatus";

/**
 * Returns the uids of every student enrolled in a class, without duplicates.
 * Enrollment is stored as users/{uid}/classes/{doc} with a class_id field.
 */
export async function loadEnrolledStudentIds(classId: string): Promise<string[]> {
  const snapshot = await getAdminDb()
    .collectionGroup("classes")
    .where("class_id", "==", classId)
    .get();

  const uids = new Set<string>();

  for (const enrollment of snapshot.docs) {
    const userRef = enrollment.ref.parent.parent;

    // The collection group also matches any other collection named "classes"
    if (userRef && userRef.parent.id === "users") {
      uids.add(userRef.id);
    }
  }

  return [...uids];
}

/**
 * Returns the query for a student's enrollment in a class, which matches
 * nothing when they are not enrolled.
 */
export function enrollmentQuery(classId: string, studentId: string): Query {
  return getAdminDb()
    .collection("users")
    .doc(studentId)
    .collection("classes")
    .where("class_id", "==", classId)
    .limit(1);
}

/**
 * Counts an assignment's grading states. Every enrolled student counts, and
 * so does anyone else who submitted or has a grade.
 */
export async function loadGradingCounts(
  assignmentRef: DocumentReference,
  enrolledIds: string[]
): Promise<GradingCounts> {
  const [submissions, grades] = await Promise.all([
    assignmentRef.collection("submissions").select("submittedAt").get(),
    assignmentRef.collection("grades").select("submittedAt").get(),
  ]);

  const submissionsById = new Map(
    submissions.docs.map((submission) => [submission.id, submission.data()])
  );
  const gradesById = new Map(grades.docs.map((grade) => [grade.id, grade.data()]));
  const studentIds = new Set([
    ...enrolledIds,
    ...submissionsById.keys(),
    ...gradesById.keys(),
  ]);

  return countGradingStatuses(
    [...studentIds].map((studentId) =>
      getGradingStatus(submissionsById.get(studentId), gradesById.get(studentId))
    )
  );
}

/**
 * Loads a course's gradebook: every student on any assignment's roster
 * against every assignment, with saved scores, feedback and dates. Returns
 * null when the class does not exist. `canGradeSubmissions` is passed through
 * for the page to choose its grading actions.
 */
export async function loadGradebook(
  classId: string,
  { canGradeSubmissions }: { canGradeSubmissions: boolean }
): Promise<Gradebook | null> {
  const db = getAdminDb();
  const classRef = db.collection("classes").doc(classId);
  const [classDoc, enrolledIds, assignmentSnapshot] = await Promise.all([
    classRef.get(),
    loadEnrolledStudentIds(classId),
    classRef.collection("assignments").get(),
  ]);

  if (!classDoc.exists) return null;

  const work: StoredWork[] = await Promise.all(
    assignmentSnapshot.docs.map(async (assignment) => {
      const [submissions, grades] = await Promise.all([
        assignment.ref.collection("submissions").select("submittedAt").get(),
        assignment.ref
          .collection("grades")
          .select("score", "feedback", "submittedAt", "gradedAt", "updatedAt")
          .get(),
      ]);

      return {
        submissions: new Map(submissions.docs.map((doc) => [doc.id, doc.data()])),
        grades: new Map(grades.docs.map((doc) => [doc.id, doc.data()])),
      };
    })
  );

  const studentIds = rosterIds(enrolledIds, work);
  // getAll() rejects an empty argument list
  const profileDocs =
    studentIds.length === 0
      ? []
      : await db.getAll(
          ...studentIds.map((studentId) => db.collection("users").doc(studentId)),
          { fieldMask: ["name", "email"] }
        );
  const classData = classDoc.data() ?? {};

  return buildGradebook({
    class: {
      id: classId,
      name: typeof classData.name === "string" ? classData.name : "Untitled course",
      courseCode: typeof classData.courseCode === "string" ? classData.courseCode : null,
      term: typeof classData.term === "string" ? classData.term : null,
      year: typeof classData.year === "number" ? classData.year : null,
      section: typeof classData.section === "string" ? classData.section : null,
    },
    canGradeSubmissions,
    assignments: assignmentSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    work,
    enrolledIds,
    profiles: new Map(profileDocs.map((doc) => [doc.id, doc.data()])),
  });
}
