
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
    fileUrl: string | null;
};