import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  Transaction,
} from "firebase-admin/firestore";

/** One saved version of a grade, stored append-only under the grade it belongs to. */
export type GradeHistoryEntry = {
  score: number;
  feedback: string;
  /** The graded submission's version. Absent on missing-work grades. */
  submittedAt?: string;
  /** The uid of whoever saved this version. */
  savedBy: string;
  /** ISO 8601 string. */
  savedAt: string;
  action: "created" | "edited";
};

/** Returns the history subcollection of a grade or missing-work grade document. */
export function gradeHistory(gradeRef: DocumentReference): CollectionReference {
  return gradeRef.collection("history");
}

/**
 * Returns the history entry for a grade as stored: "created" by its grader,
 * or "edited" by whoever last edited it.
 */
export function entryFromStoredGrade(stored: DocumentData): GradeHistoryEntry {
  const edited = typeof stored.updatedAt === "string";

  return {
    score: stored.score,
    feedback: stored.feedback ?? "",
    ...(typeof stored.submittedAt === "string" && { submittedAt: stored.submittedAt }),
    savedBy: edited ? stored.updatedBy : stored.gradedBy,
    savedAt: edited ? stored.updatedAt : stored.gradedAt,
    action: edited ? "edited" : "created",
  };
}

/** Adds a history entry to a grade inside a transaction. */
export function appendHistory(
  transaction: Transaction,
  gradeRef: DocumentReference,
  entry: GradeHistoryEntry
) {
  transaction.create(gradeHistory(gradeRef).doc(), entry);
}

/**
 * Reads, inside a transaction, whether a grade has any history yet. Grades
 * saved before history was kept have none.
 */
export async function hasHistory(
  transaction: Transaction,
  gradeRef: DocumentReference
): Promise<boolean> {
  const snapshot = await transaction.get(gradeHistory(gradeRef).limit(1));

  return !snapshot.empty;
}

/** Returns a grade's history, oldest first. */
export async function loadGradeHistory(
  gradeRef: DocumentReference
): Promise<GradeHistoryEntry[]> {
  const snapshot = await gradeHistory(gradeRef).orderBy("savedAt").get();

  return snapshot.docs.map((entry) => entry.data() as GradeHistoryEntry);
}
