
export type ClassItem = {
  id: string;
  name: string;
  courseCode?: string;
  year?: number;
  term?: string;
  section?: string;
  professorId?: string;
};

export type Assignment = {
    id: string;
    name: string;
    description?: string;
    points: number;
    dueDate: string | null;
    /** When submissions close, as an ISO instant. Null when there is no due date. */
    closesAt?: string | null;
};

export type Submission = {
    studentId?: string;
    /** Set on a professor's list. Null when the student has no profile. */
    studentName?: string | null;
    /** Set on a professor's list. Null when the student has no profile. */
    studentEmail?: string | null;
    fileName: string;
    fileType: string;
    fileSize: number;
    submittedAt: string;
    status: string;
    grade: number | null;
    feedback: string;
    /** ISO 8601 string. Null until graded. */
    gradedAt: string | null;
    /** True when the graded file has been replaced. */
    resubmittedAfterGrading: boolean;
    fileUrl: string | null;
};

/**
 * A professor's grade for one submission, stored at
 * classes/{classId}/assignments/{assignmentId}/grades/{studentUid}.
 * The IDs repeat the path so a collection-group query on grades can filter by them.
 */
export type Grade = {
    studentId: string;
    classId: string;
    assignmentId: string;
    score: number;
    feedback: string;
    /** The graded submission's submittedAt, which identifies the file version. */
    submittedAt: string;
    /** The grading professor's uid. */
    gradedBy: string;
    /** ISO 8601 string. */
    gradedAt: string;
};