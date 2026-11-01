import { APP_URL, AUTH_HOST, FIRESTORE_HOST, PASSWORD, PROJECT_ID, STUB_URL } from "./env";
import { makePdf } from "./pdf";

export type Person = {
  name: string;
  email: string;
  uid: string;
  /** Auth emulator ID token for seeding through the API. */
  token: string;
};

export type SeededAssignment = {
  id: string;
  name: string;
  points: number;
  /** The assignment's page, relative to the app. */
  path: string;
};

export type Scenario = {
  professor: Person;
  /** Ava, Ben and Cara submitted the closed assignment. Dev submitted nothing. */
  students: Record<"ava" | "ben" | "cara" | "dev", Person>;
  course: { id: string; assignmentsPath: string };
  /**
   * Past due. Ava needs grading, Ben was graded and resubmitted, Cara is
   * graded and Dev is missing.
   */
  closed: SeededAssignment;
  /** Due next week. Only Ava has submitted, and nothing is graded. */
  open: SeededAssignment;
};

export const CARA_SCORE = 90;
export const CARA_FEEDBACK = "Clear requirements. Add acceptance criteria to FR-3.";
export const BEN_SCORE = 82;
export const BEN_FEEDBACK = "Good start. FR-2 describes the UI rather than behaviour.";

const PEOPLE = {
  admin: { name: "Jordan Hayes", email: "jordan.hayes@admin.example.edu" },
  professor: { name: "Dr. Elena Park", email: "elena.park@faculty.example.edu" },
  ava: { name: "Ava Martin", email: "ava.martin@students.example.edu" },
  ben: { name: "Ben Carter", email: "ben.carter@students.example.edu" },
  cara: { name: "Cara Diaz", email: "cara.diaz@students.example.edu" },
  dev: { name: "Dev Patel", email: "dev.patel@students.example.edu" },
};

const API_KEY = "fake-api-key";

// #region Requests

type RequestOptions = {
  /** Sent as a Bearer token. The Firestore emulator treats "owner" as an admin that bypasses rules. */
  token?: string;
  json?: unknown;
  form?: FormData;
};

/** Sends a request and returns its JSON body, throwing on any status other than 2xx. */
async function request<T = Record<string, unknown>>(
  method: string,
  url: string,
  { token, json, form }: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : form,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${method} ${url} returned ${response.status}: ${text.slice(0, 300)}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

/** Calls one of the app's API routes. */
function api<T = Record<string, unknown>>(method: string, route: string, token: string, json?: unknown) {
  return request<T>(method, `${APP_URL}${route}`, { token, json });
}

/** Calls the Auth emulator's copy of the Identity Toolkit API. */
function identityToolkit<T>(action: string, json: unknown) {
  return request<T>(
    "POST",
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:${action}?key=${API_KEY}`,
    { json }
  );
}

// #endregion

// #region Steps

/** Deletes every Auth account, Firestore document and stored file. */
export async function resetEmulators() {
  await Promise.all([
    request("DELETE", `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`),
    request("DELETE", `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`),
    request("POST", `${STUB_URL}/reset`),
  ]);
}

/** Signs up and creates the users/{uid} profile, as the login page's sign-up does. */
async function createAccount(person: { name: string; email: string }, role: "student" | "professor") {
  const account = await identityToolkit<{ localId: string; idToken: string }>("signUp", {
    email: person.email,
    password: PASSWORD,
    returnSecureToken: true,
  });
  await api("POST", "/api/users", account.idToken, { name: person.name, role });

  return { ...person, uid: account.localId, token: account.idToken };
}

/** Makes a student an admin with a direct emulator write, since no endpoint creates the first admin. */
async function promoteToAdmin(uid: string) {
  await request(
    "PATCH",
    `http://${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=role`,
    { token: "owner", json: { fields: { role: { stringValue: "admin" } } } }
  );
}

/** Uploads a one-page PDF as a student's submission. */
async function submit(student: Person, courseId: string, assignmentId: string, fileName: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(makePdf(`${student.name}: ${fileName}`))], fileName, { type: "application/pdf" }));

  await request("POST", `${APP_URL}/api/classes/${courseId}/assignments/${assignmentId}/submit`, {
    token: student.token,
    form,
  });
}

/** Grades a student's current submission as the professor. */
async function grade(
  professor: Person,
  courseId: string,
  assignmentId: string,
  student: Person,
  score: number,
  feedback: string
) {
  const assignmentRoute = `/api/classes/${courseId}/assignments/${assignmentId}`;
  const { students } = await api<{ students: { studentId: string; submittedAt?: string }[] }>(
    "GET",
    `${assignmentRoute}/submit`,
    professor.token
  );
  const submittedAt = students.find((row) => row.studentId === student.uid)?.submittedAt;

  await api("POST", `${assignmentRoute}/submissions/${student.uid}/grade`, professor.token, {
    score,
    feedback,
    submittedAt,
  });
}

/** Returns a calendar date in Mountain Time, `days` from today, as YYYY-MM-DD. */
function dateFromToday(days: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  );
}

// #endregion

/**
 * Resets the emulators and seeds one course through the app's own API: a
 * professor, four students, a closed assignment with a submission in every
 * grading state, and an open one.
 */
export async function seedScenario(): Promise<Scenario> {
  await resetEmulators();

  const admin = await createAccount(PEOPLE.admin, "student");
  await promoteToAdmin(admin.uid);

  const [professor, ava, ben, cara, dev] = await Promise.all([
    createAccount(PEOPLE.professor, "professor"),
    createAccount(PEOPLE.ava, "student"),
    createAccount(PEOPLE.ben, "student"),
    createAccount(PEOPLE.cara, "student"),
    createAccount(PEOPLE.dev, "student"),
  ]);
  const students = { ava, ben, cara, dev };
  await api("PATCH", "/api/users", admin.token, { uid: professor.uid, action: "approve" });

  const { class: course } = await api<{ class: { id: string } }>("POST", "/api/classes", admin.token, {
    name: "Software Engineering",
    courseCode: "CS 3450",
    year: 2026,
    term: "Fall",
    section: "001",
    professorId: professor.uid,
  });
  await Promise.all(
    Object.values(students).map((student) =>
      api("POST", `/api/admin/classes/${course.id}/enrollments`, admin.token, { studentId: student.uid })
    )
  );

  /** Creates an assignment as the professor. */
  const createAssignment = async (name: string, points: number, dueDate: string): Promise<SeededAssignment> => {
    const { assignment } = await api<{ assignment: { id: string } }>(
      "POST",
      `/api/classes/${course.id}/assignments`,
      professor.token,
      { name, description: `${name} for the e2e tests.`, points, dueDate }
    );

    return { id: assignment.id, name, points, path: `/classes/${course.id}/assignments/${assignment.id}` };
  };

  // The submit route refuses files after the due date, so the closed
  // assignment collects its work while open and is closed afterwards
  const closed = await createAssignment("Project 1: Requirements", 100, dateFromToday(14));
  const open = await createAssignment("Homework 2: Use Cases", 20, dateFromToday(7));

  await Promise.all([
    submit(ava, course.id, closed.id, "Martin_Project1.pdf"),
    submit(ben, course.id, closed.id, "Carter_Project1.pdf"),
    submit(cara, course.id, closed.id, "Diaz_Project1.pdf"),
    submit(ava, course.id, open.id, "Martin_Homework2.pdf"),
  ]);
  await grade(professor, course.id, closed.id, cara, CARA_SCORE, CARA_FEEDBACK);
  await grade(professor, course.id, closed.id, ben, BEN_SCORE, BEN_FEEDBACK);
  await submit(ben, course.id, closed.id, "Carter_Project1_v2.pdf");

  await api("PATCH", `/api/classes/${course.id}/assignments/${closed.id}`, professor.token, {
    dueDate: dateFromToday(-7),
  });

  return {
    professor,
    students,
    course: { id: course.id, assignmentsPath: `/classes/${course.id}/assignments` },
    closed,
    open,
  };
}
