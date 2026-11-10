import type { MissingStatus, SubmittedStatus } from "@/lib/gradingStatus";


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
    /** ISO 8601 string. Null until the grade is edited. */
    gradeUpdatedAt: string | null;
    /** True when the graded file has been replaced. */
    resubmittedAfterGrading: boolean;
    /** True while the student's grade is a missing-work grade given before this submission. */
    submittedAfterMissingGrade: boolean;
    fileUrl: string | null;
};

/** A missing-work grade, one with no submittedAt, as the roster and the student see it. */
export type MissingGradeSummary = {
    score: number;
    feedback: string;
    /** ISO 8601 string. */
    gradedAt: string;
    /** ISO 8601 string. Null until the grade is edited. */
    updatedAt: string | null;
};

/** A student on a professor's list for an assignment. */
type ListedStudent = {
    studentId: string;
    /** Null when the student has no profile. */
    studentName: string | null;
    /** Null when the student has no profile. */
    studentEmail: string | null;
    /** The student's missing-work grade. Null when their grade belongs to a submission, or they have none. */
    missingGrade: MissingGradeSummary | null;
};

/** A student on the professor's list who has not submitted. */
export type MissingStudent = ListedStudent & { gradingStatus: MissingStatus };

/** A student on the professor's list with their submission and grade. */
export type SubmittedStudent = ListedStudent &
    Submission & { gradingStatus: SubmittedStatus };

/** One row of a professor's list: every enrolled student, submitted or not. */
export type RosterStudent = MissingStudent | SubmittedStudent;

/**
 * A grade for one student on an assignment, stored at
 * classes/{classId}/assignments/{assignmentId}/grades/{studentUid}.
 * The IDs repeat the path so a collection-group query on grades can filter by them.
 */
export type Grade = {
    studentId: string;
    classId: string;
    assignmentId: string;
    score: number;
    feedback: string;
    /**
     * The graded submission's submittedAt, which identifies the file version.
     * Null on a missing-work grade, given to a student without a submission.
     */
    submittedAt: string | null;
    /** The uid of the professor or admin who graded. */
    gradedBy: string;
    /** ISO 8601 string. */
    gradedAt: string;
    /** ISO 8601 string of the latest edit. Absent until edited. */
    updatedAt?: string;
    /** The uid of whoever last edited the grade. Absent until edited. */
    updatedBy?: string;
};
