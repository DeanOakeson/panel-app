import type { DocumentReference, Query } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
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
