// Seeds a course at a representative size and times the gradebook API against
// the 2-second target: "LOAD 2000: Gradebook Load Test", Fall 2026, Section
// 001. Everything goes through the app's own API routes, so grade history and
// file uploads are real.
//
// The course has 40 students and 20 assignments:
//   * 14 closed, 5 open and 1 with no due date
//   * a fixed mix of cells, generated from each student and assignment, that
//     covers every state: graded with and without feedback, to grade,
//     resubmitted, a missing-work 0, turned in after a missing-work grade,
//     regraded over a missing-work grade, missing, and not yet submitted
//   * one student who leaves the class at the end
//
// After seeding, the professor loads GET /api/classes/{id}/gradebook once to
// warm up, then 20 times in a row. The script prints the median, p95 and max,
// and exits with 1 when p95 reaches 2000 ms or the response is missing
// assignments or students.
//
// Local emulators (the default):
//   npm run test:load
//
// The app must be running on APP_URL (default http://127.0.0.1:3000) against
// the emulators, with a storage backend for the uploads. Time a production
// build, since a dev server compiles routes on demand. The README covers
// starting one against the emulators and the e2e storage stub.
//
// Locally the accounts default to admin@panel-app.test and
// professor@panel-app.test, and every password to demo1234. The admin must
// exist already, which scripts/seed-admin.mjs creates. Students are created as
// loadNN@load.panel-app.test.
//
// Production:
//   SEED_TARGET=production APP_URL=https://... FIREBASE_API_KEY=... \
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... PROFESSOR_EMAIL=... PROFESSOR_PASSWORD=... \
//   STUDENT_PASSWORD=... npm run test:load
//
// Production has no defaults for those variables. A run without
// SEED_CONFIRM=yes prints the plan and stops before writing anything.
// Credentials come from the environment only, never from arguments.
//
// Variables:
//   SEED_TARGET          "emulators" (default) or "production"
//   APP_URL              the running app
//   FIREBASE_API_KEY     the web API key for Identity Toolkit sign-in (production only)
//   FIREBASE_AUTH_EMULATOR_HOST  the Auth emulator (default 127.0.0.1:9099)
//   ADMIN_EMAIL, ADMIN_PASSWORD          an existing admin, who creates the course
//   PROFESSOR_EMAIL, PROFESSOR_PASSWORD  the professor who teaches it
//   PROFESSOR_NAME       the professor's name, if the account is created (default "Load Test Professor")
//   STUDENT_PASSWORD     the password for every load-test student
//   SEED_CONFIRM         "yes" to write to production
//   LOAD_TEST_SKIP_SEED  "1" to only time a course seeded earlier, which writes
//                        nothing and needs no STUDENT_PASSWORD or SEED_CONFIRM
//
// A professor account that doesn't exist is signed up, applies as a
// professor, and is approved by the admin.
//
// Running it again fills in whatever is missing and leaves the rest alone. It
// finds the course by code, term, year and section, the assignments by name,
// and each student's work through the assignment's roster. Existing accounts
// are signed in, not created again.
//
// An app without the missing-work grade route, such as an older deployment,
// answers 404 there. The script then skips the missing-work zeros and the
// work turned in after one, with a warning. A later run against an app that
// has the route adds them.

const COURSE = {
  courseCode: "LOAD 2000",
  name: "Gradebook Load Test",
  year: 2026,
  term: "Fall",
  section: "001",
};

/** How many requests run at once while seeding one assignment. */
const CONCURRENCY = 8;

/** How many timed gradebook loads follow the warm-up. */
const TIMED_LOADS = 20;

/** The p95 the gradebook API must stay under, in milliseconds. */
const TARGET_P95_MS = 2000;

// #region Plan

const FIRST_NAMES = [
  "Ava", "Ben", "Cara", "Dev", "Elena", "Felix", "Grace", "Hugo", "Iris", "Jonah",
  "Kira", "Liam", "Maya", "Noah", "Olive", "Paul", "Quinn", "Rosa", "Sam", "Tess",
];

const LAST_NAMES = [
  "Martin", "Carter", "Diaz", "Patel", "Ruiz", "Nguyen", "Okafor", "Lindqvist", "Tanaka", "Brooks",
  "Cohen", "Ellis", "Fischer", "Garcia", "Hughes", "Ito", "Jensen", "Khan", "Lopez", "Moreau",
];

/** The students, keyed load01 to load40. */
const STUDENTS = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => {
    const key = `load${String(index + 1).padStart(2, "0")}`;
    const first = FIRST_NAMES[index % FIRST_NAMES.length];
    const last = LAST_NAMES[(index * 7 + Math.floor(index / FIRST_NAMES.length) * 3) % LAST_NAMES.length];

    return [key, { name: `${first} ${last}`, email: `${key}@load.panel-app.test` }];
  })
);

/** The student who leaves the class once the seeding is done. */
const LEAVER = "load40";

/** How many assignments the student who leaves has work on. */
const LEAVER_ASSIGNMENTS = 5;

const FEEDBACK = [
  "Clear and complete.",
  "Good work. Check the edge cases in part 2.",
  "Cite your sources for the second section.",
  "Strong analysis. The conclusion needs one more example.",
  "Watch the naming in the diagram.",
  "Meets every requirement.",
];

const MISSING_FEEDBACK = ["Nothing received by the due date.", "", "No submission. Talk to me about the late policy."];

/** Returns a number from 0 to 99 that is fixed for the given whole numbers. */
function roll(...parts) {
  let hash = 2166136261;
  for (const part of parts) {
    hash = Math.imul(hash ^ part, 16777619);
  }
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);

  return ((hash ^ (hash >>> 16)) >>> 0) % 100;
}

/** Returns a realistic score out of `points` for one student's work. */
function scoreFor(points, studentIndex, assignmentIndex) {
  return Math.round((points * (55 + (roll(studentIndex, assignmentIndex, 3) * 45) / 100)) / 100);
}

/** Returns feedback for about half the grades, and "" for the rest. */
function feedbackFor(studentIndex, assignmentIndex) {
  const pick = roll(studentIndex, assignmentIndex, 2);
  return pick < 50 ? FEEDBACK[pick % FEEDBACK.length] : "";
}

// Each outcome is one student's work on one assignment. A student with no
// outcome turned nothing in: "Missing" once the assignment closes, "Not
// submitted" while it is open, and a dash for the student who left.
//   graded       submitted and graded, with optional feedback
//   resubmitted  graded, then turned in again, so the earlier score stands
//   submitted    turned in and waiting for a grade
//   missingZero  a missing-work grade of 0 (closed assignments only)
//   afterMissing a missing-work grade of 0, then turned in late while the due
//                date was moved out (closed assignments only)
//   regraded     with afterMissing, the late work graded over the 0

/**
 * Returns one student's outcome on a closed assignment, numbered from 0 for
 * the oldest. The newest four have more work left to grade.
 */
function closedOutcome(studentIndex, assignmentIndex) {
  const pick = roll(studentIndex, assignmentIndex, 1);
  const score = scoreFor(pointsFor(assignmentIndex), studentIndex, assignmentIndex);
  const feedback = feedbackFor(studentIndex, assignmentIndex);
  const missingFeedback = MISSING_FEEDBACK[pick % MISSING_FEEDBACK.length];
  const toGradeShare = assignmentIndex >= 10 ? 16 : 2;

  if (pick < 4) return null;
  if (pick < 9) return { missingZero: missingFeedback };
  if (pick < 11) return { afterMissing: missingFeedback };
  if (pick < 13) return { afterMissing: missingFeedback, regraded: score, feedback };
  if (pick < 18) return { resubmitted: score, feedback };
  if (pick < 18 + toGradeShare) return { submitted: true };

  return { graded: score, feedback };
}

/** Returns one student's outcome on an assignment that is still open, the nearest first. */
function openOutcome(studentIndex, assignmentIndex, openIndex) {
  const pick = roll(studentIndex, assignmentIndex, 1);
  const gradedShare = [30, 15, 5, 0, 0][openIndex];
  const submittedShare = [70, 45, 25, 10, 0][openIndex];

  if (openIndex === 0 && pick < 5) {
    return { resubmitted: scoreFor(pointsFor(assignmentIndex), studentIndex, assignmentIndex), feedback: "" };
  }
  if (pick < gradedShare) {
    return {
      graded: scoreFor(pointsFor(assignmentIndex), studentIndex, assignmentIndex),
      feedback: feedbackFor(studentIndex, assignmentIndex),
    };
  }
  if (pick < submittedShare) return { submitted: true };

  return null;
}

const KINDS = [
  { kind: "Homework", points: 20 },
  { kind: "Quiz", points: 10 },
  { kind: "Lab", points: 15 },
  { kind: "Homework", points: 20 },
  { kind: "Project", points: 100 },
];

/** Returns the points of the assignment at `assignmentIndex`, where the last is the extra credit. */
function pointsFor(assignmentIndex) {
  return assignmentIndex === 19 ? 5 : KINDS[assignmentIndex % KINDS.length].points;
}

/**
 * The assignments, in due-date order. `due` is days from today: negative
 * closes the assignment, null leaves it without a due date.
 */
const ASSIGNMENTS = (() => {
  const numbers = new Map();
  const closedDue = Array.from({ length: 14 }, (_, index) => -98 + index * 7);
  const openDue = [4, 11, 18, 25, 32];
  const studentKeys = Object.keys(STUDENTS);

  return [...closedDue, ...openDue, null].map((due, assignmentIndex) => {
    const extraCredit = due === null;
    const { kind } = KINDS[assignmentIndex % KINDS.length];
    const number = (numbers.get(kind) ?? 0) + 1;
    numbers.set(kind, number);

    const outcomes = {};
    for (const [studentIndex, key] of studentKeys.entries()) {
      if (key === LEAVER && assignmentIndex >= LEAVER_ASSIGNMENTS) continue;

      let outcome;
      if (extraCredit) {
        const pick = roll(studentIndex, assignmentIndex, 1);
        outcome = pick < 15 ? { graded: 5, feedback: feedbackFor(studentIndex, assignmentIndex) } : pick < 30 ? { submitted: true } : null;
      } else if (due < 0) {
        outcome = closedOutcome(studentIndex, assignmentIndex);
      } else {
        outcome = openOutcome(studentIndex, assignmentIndex, assignmentIndex - closedDue.length);
      }

      if (outcome) outcomes[key] = outcome;
    }

    return {
      name: extraCredit ? "Extra Credit" : `${kind} ${number}`,
      file: extraCredit ? "ExtraCredit" : `${kind}${number}`,
      points: pointsFor(assignmentIndex),
      due,
      outcomes,
    };
  });
})();

/** Returns the cell state an outcome produces, for the plan's summary. */
function cellState(outcome, due) {
  if (!outcome) return due !== null && due < 0 ? "missing" : "not yet submitted";
  if ("regraded" in outcome) return "regraded over a missing-work grade";
  if ("afterMissing" in outcome) return "turned in after a missing-work grade";
  if ("missingZero" in outcome) return "missing-work 0";
  if ("resubmitted" in outcome) return "resubmitted";
  if ("submitted" in outcome) return "to grade";

  return outcome.feedback ? "graded with feedback" : "graded without feedback";
}

/** Counts the cells of each state the plan seeds, leaving out the student who left. */
function countCellStates() {
  const counts = new Map();

  for (const plan of ASSIGNMENTS) {
    for (const key of Object.keys(STUDENTS)) {
      if (key === LEAVER && !plan.outcomes[key]) continue;
      const state = cellState(plan.outcomes[key], plan.due);
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
  }

  return counts;
}

const CELL_STATES = [
  "graded with feedback",
  "graded without feedback",
  "to grade",
  "resubmitted",
  "missing-work 0",
  "turned in after a missing-work grade",
  "regraded over a missing-work grade",
  "missing",
  "not yet submitted",
];

// #endregion

// #region Config

/** Prints a message and exits with a failure status. */
function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Returns whether a URL points at this machine. */
function isLoopback(url) {
  const { hostname } = new URL(url);
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/**
 * Reads the target and credentials from the environment. Emulators get local
 * defaults, and production requires every value.
 */
function readConfig() {
  const target = process.env.SEED_TARGET ?? "emulators";
  const env = (name) => process.env[name]?.trim() || undefined;
  const professorName = env("PROFESSOR_NAME") ?? "Load Test Professor";
  const skipSeed = env("LOAD_TEST_SKIP_SEED") === "1";

  if (target === "emulators") {
    const appUrl = env("APP_URL") ?? "http://127.0.0.1:3000";
    if (!isLoopback(appUrl)) {
      fail(`APP_URL ${appUrl} is not local. Set SEED_TARGET=production to test a deployed app.`);
    }

    const authHost = env("FIREBASE_AUTH_EMULATOR_HOST") ?? "127.0.0.1:9099";

    return {
      target,
      skipSeed,
      appUrl: appUrl.replace(/\/+$/, ""),
      identityUrl: `http://${authHost}/identitytoolkit.googleapis.com/v1`,
      apiKey: "fake-api-key",
      admin: { email: env("ADMIN_EMAIL") ?? "admin@panel-app.test", password: env("ADMIN_PASSWORD") ?? "demo1234" },
      professor: {
        email: env("PROFESSOR_EMAIL") ?? "professor@panel-app.test",
        password: env("PROFESSOR_PASSWORD") ?? "demo1234",
        name: professorName,
      },
      studentPassword: env("STUDENT_PASSWORD") ?? "demo1234",
      confirmed: true,
    };
  }

  if (target === "production") {
    const required = [
      "APP_URL",
      "FIREBASE_API_KEY",
      "ADMIN_EMAIL",
      "ADMIN_PASSWORD",
      "PROFESSOR_EMAIL",
      "PROFESSOR_PASSWORD",
      ...(skipSeed ? [] : ["STUDENT_PASSWORD"]),
    ];
    const missing = required.filter((name) => !env(name));
    if (missing.length > 0) {
      fail(`SEED_TARGET=production needs every one of these, and has no defaults:\n  ${missing.join("\n  ")}`);
    }

    const appUrl = env("APP_URL");
    if (!appUrl.startsWith("https://") || isLoopback(appUrl)) {
      fail(`APP_URL ${appUrl} must be the deployed app's https:// address in production.`);
    }

    for (const name of skipSeed ? [] : ["PROFESSOR_PASSWORD", "STUDENT_PASSWORD"]) {
      if (env(name).length < 6) fail(`${name} must be at least 6 characters.`);
    }

    return {
      target,
      skipSeed,
      appUrl: appUrl.replace(/\/+$/, ""),
      identityUrl: "https://identitytoolkit.googleapis.com/v1",
      apiKey: env("FIREBASE_API_KEY"),
      admin: { email: env("ADMIN_EMAIL"), password: env("ADMIN_PASSWORD") },
      professor: { email: env("PROFESSOR_EMAIL"), password: env("PROFESSOR_PASSWORD"), name: professorName },
      studentPassword: env("STUDENT_PASSWORD"),
      confirmed: env("SEED_CONFIRM") === "yes",
    };
  }

  fail(`SEED_TARGET must be "emulators" or "production", not "${target}".`);
}

const config = readConfig();

// #endregion

// #region Requests

/** An error from a request, carrying its status and parsed body. */
class RequestError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Sends a request and returns its JSON body, throwing a RequestError on any status other than 2xx. */
async function request(method, url, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : form,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }

  if (!response.ok) {
    const shownUrl = url.replace(/key=[^&]+/, "key=***");
    const shownText = body.text === undefined ? text.slice(0, 300) : "(not JSON)";
    throw new RequestError(`${method} ${shownUrl} returned ${response.status}: ${shownText}`, response.status, body);
  }

  return body;
}

/** Calls one of the app's API routes. */
function api(method, route, token, json) {
  return request(method, `${config.appUrl}${route}`, { token, json });
}

/** Returns whether a request failed with this status and a JSON error from the route itself. */
function isApiError(error, status) {
  return error instanceof RequestError && error.status === status && typeof error.body?.error === "string";
}

/** Returns whether a request failed because the app has no such route, which answers with a 404 page. */
function isMissingRoute(error) {
  return error instanceof RequestError && error.status === 404 && typeof error.body?.error !== "string";
}

/** Calls an Identity Toolkit account action, on the Auth emulator or on Google. */
function identityToolkit(action, json) {
  return request("POST", `${config.identityUrl}/accounts:${action}?key=${config.apiKey}`, { json });
}

/** Returns the Identity Toolkit error code from a failed request, like "EMAIL_EXISTS". */
function identityError(error) {
  return error instanceof RequestError ? String(error.body?.error?.message ?? "") : "";
}

/** Signs in with a password and returns the uid and ID token, or null when no such account exists. */
async function trySignIn(email, password) {
  try {
    const account = await identityToolkit("signInWithPassword", { email, password, returnSecureToken: true });
    return { uid: account.localId, token: account.idToken };
  } catch (error) {
    // With email enumeration protection on, a wrong password and an unknown email look the same
    const code = identityError(error);
    if (code === "EMAIL_NOT_FOUND" || code === "INVALID_LOGIN_CREDENTIALS") return null;
    throw error;
  }
}

/** Signs up a new account and returns its uid and ID token. */
async function signUp(email, password) {
  try {
    const account = await identityToolkit("signUp", { email, password, returnSecureToken: true });
    return { uid: account.localId, token: account.idToken };
  } catch (error) {
    if (identityError(error) === "EMAIL_EXISTS") {
      fail(`${email} exists with a different password than the one set for it.`);
    }
    throw error;
  }
}

/** Returns the signed-in user's profile, or null when they have none. */
async function loadProfile(token) {
  try {
    return await api("GET", "/api/users", token);
  } catch (error) {
    if (isApiError(error, 404)) return null;
    throw error;
  }
}

/** Runs `task` on every item, at most CONCURRENCY at a time. */
async function inParallel(items, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

// #endregion

// #region Accounts

/** Signs in the admin and checks the role. */
async function signInAdmin() {
  const session = await trySignIn(config.admin.email, config.admin.password);
  if (!session) fail(`Couldn't sign in as ${config.admin.email}. Check ADMIN_EMAIL and ADMIN_PASSWORD.`);

  const profile = await loadProfile(session.token);
  if (profile?.role !== "admin") fail(`${config.admin.email} is not an admin.`);

  return { ...config.admin, ...session };
}

/**
 * Signs the professor in, or signs them up and applies as a professor when the
 * account doesn't exist, then has the admin approve a pending application.
 */
async function ensureProfessor(admin) {
  const { email, password, name } = config.professor;
  let session = await trySignIn(email, password);
  if (!session) {
    session = await signUp(email, password);
    console.log(`  created ${email}`);
  }

  let profile = await loadProfile(session.token);
  if (!profile) {
    await api("POST", "/api/users", session.token, { name, role: "professor" });
    profile = await loadProfile(session.token);
  }

  if (profile.role === "student" && profile.professorStatus === "pending") {
    await api("PATCH", "/api/users", admin.token, { uid: session.uid, action: "approve" });
    console.log(`  approved ${email} as a professor`);
    profile = await loadProfile(session.token);
  }

  if (profile.role !== "professor") {
    fail(`${email} has the role "${profile.role}" and no pending professor application, so it can't teach the course.`);
  }

  return { email, name: profile.name, ...session };
}

/**
 * Signs a load-test student in, or signs them up, and makes sure they have a
 * student profile. Returns the student and whether the account is new.
 */
async function ensureStudent(student) {
  let session = await trySignIn(student.email, config.studentPassword);
  const created = !session;
  if (!session) session = await signUp(student.email, config.studentPassword);

  let profile = await loadProfile(session.token);
  if (!profile) {
    await api("POST", "/api/users", session.token, { name: student.name, role: "student" });
    profile = { role: "student" };
  }

  if (profile.role !== "student") fail(`${student.email} has the role "${profile.role}", not "student".`);

  return { student: { ...student, ...session }, created };
}

// #endregion

// #region Work

/** Returns a calendar date in Mountain Time, `days` from today, as YYYY-MM-DD. */
function dateFromToday(days) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(
    new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  );
}

/** Escapes text for a PDF string literal and replaces anything outside printable ASCII. */
function escapePdfText(text) {
  return text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/[^\x20-\x7e]/g, "?");
}

/** Builds a one-page PDF that shows a single line of text. */
function makePdf(text) {
  const stream = `BT /F1 14 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((content, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/**
 * Returns whether a student's work already matches their outcome, judged from
 * their roster row: submittedAt, grade (a score or null),
 * resubmittedAfterGrading and missingGrade. A grade saved over a missing-work
 * grade clears missingGrade.
 */
function isDone(outcome, row) {
  const submitted = Boolean(row?.submittedAt);
  const missingGraded = Boolean(row?.missingGrade);

  if ("regraded" in outcome) return submitted && row.grade !== null;
  if ("graded" in outcome) return submitted && row.grade !== null;
  if ("resubmitted" in outcome) return Boolean(row?.resubmittedAfterGrading);
  if ("submitted" in outcome) return submitted;
  if ("missingZero" in outcome) return missingGraded;
  if ("afterMissing" in outcome) return missingGraded && submitted;

  return true;
}

/**
 * Seeds what is missing on one assignment, tracking its due date as it opens
 * and closes. Students' requests run in parallel within each step, and the
 * steps run in order around the due-date changes.
 */
class AssignmentSeeder {
  /**
   * `plan` is the assignment from ASSIGNMENTS, `assignment` the stored one or
   * null, and `state.missingGrades` false once the app turns out to lack the
   * missing-work grade route.
   */
  constructor({ professor, students, courseId, plan, assignment, state }) {
    Object.assign(this, { professor, students, courseId, plan, assignment, state });
    this.route = `/api/classes/${courseId}/assignments`;
    this.closes = plan.due !== null && plan.due < 0;
    this.changes = new Map();
  }

  /** Creates the assignment if needed and fills in every student's outcome. */
  async run() {
    await this.ensureAssignment();
    let roster = await this.loadRoster();
    const outcomes = Object.entries(this.plan.outcomes).map(([key, outcome]) => ({
      student: this.students[key],
      outcome,
    }));
    const pending = (...fields) =>
      outcomes.filter(
        ({ student, outcome }) =>
          fields.some((field) => field in outcome) && !isDone(outcome, roster.get(student.uid))
      );

    const toSubmit = pending("graded", "resubmitted", "submitted").filter(
      ({ student }) => !roster.get(student.uid)?.submittedAt
    );
    if (toSubmit.length > 0) {
      await this.open();
      await inParallel(toSubmit, ({ student }) => this.submit(student));
      roster = await this.loadRoster();
    }

    const toGrade = pending("graded", "resubmitted").filter(({ student }) => roster.get(student.uid).grade === null);
    await inParallel(toGrade, async ({ student, outcome }) => {
      await this.api("POST", `/submissions/${student.uid}/grade`, {
        score: outcome.graded ?? outcome.resubmitted,
        feedback: outcome.feedback ?? "",
        submittedAt: roster.get(student.uid).submittedAt,
      });
      this.note("graded");
    });

    const toResubmit = pending("resubmitted");
    if (toResubmit.length > 0) {
      await this.open();
      await inParallel(toResubmit, ({ student }) => this.submit(student, "_v2"));
    }

    if (this.closes) {
      await this.close();
      await this.seedMissingWork(roster, pending("missingZero", "afterMissing"));
    }

    const summary = [...this.changes].map(([label, count]) => (label === "created" ? label : `${count} ${label}`));
    console.log(`  ${this.plan.name}: ${summary.length > 0 ? summary.join(", ") : "complete"}`);
  }

  /** Counts one change of a kind, for the summary line. */
  note(label) {
    this.changes.set(label, (this.changes.get(label) ?? 0) + 1);
  }

  /**
   * Grades missing work with a zero, turns in the late work that follows one,
   * and grades some of that late work over the zero.
   */
  async seedMissingWork(roster, missingWork) {
    const eligible = missingWork.filter(({ student }) => {
      const row = roster.get(student.uid);
      if (row?.submittedAt && !row.missingGrade) {
        console.warn(`  warning: ${student.name} turned in ${this.plan.name} without a missing-work grade, so none can be added`);
        return false;
      }
      return true;
    });

    await this.markMissing(eligible.filter(({ student }) => !roster.get(student.uid)?.missingGrade));
    if (!this.state.missingGrades) return;

    const toTurnIn = eligible.filter(
      ({ student, outcome }) => "afterMissing" in outcome && !roster.get(student.uid)?.submittedAt
    );
    if (toTurnIn.length > 0) {
      await this.open();
      await inParallel(toTurnIn, ({ student }) => this.submit(student, "_late"));
      await this.close();
    }

    const toRegrade = eligible.filter(({ outcome }) => "regraded" in outcome);
    if (toRegrade.length === 0) return;

    // The grade route's PATCH saves over the missing-work grade it was last saved as
    const current = await this.loadRoster();
    await inParallel(toRegrade, async ({ student, outcome }) => {
      const row = current.get(student.uid);
      await this.api("PATCH", `/submissions/${student.uid}/grade`, {
        score: outcome.regraded,
        feedback: outcome.feedback ?? "",
        submittedAt: row.submittedAt,
        lastSavedAt: row.missingGrade.updatedAt ?? row.missingGrade.gradedAt,
      });
      this.note("regraded");
    });
  }

  /**
   * Saves missing-work zeros. The first goes alone, so an app without the
   * route is found before the rest are sent.
   */
  async markMissing(toMark) {
    if (toMark.length === 0 || !this.state.missingGrades) return;

    const mark = async ({ student, outcome }) => {
      await this.api("POST", `/missing-grades/${student.uid}`, { feedback: outcome.missingZero ?? outcome.afterMissing });
      this.note("marked missing");
    };
    const [first, ...rest] = toMark;

    try {
      await mark(first);
    } catch (error) {
      if (!isMissingRoute(error)) throw error;

      this.state.missingGrades = false;
      console.warn("  warning: the app has no missing-work grade route, so missing-work zeros and late work are skipped");
      return;
    }

    await inParallel(rest, mark);
  }

  /** Calls a route under this assignment as the professor. */
  api(method, path, json) {
    return api(method, `${this.route}/${this.assignment.id}${path}`, this.professor.token, json);
  }

  /**
   * Creates the assignment unless it exists. A closed one starts out due in
   * two weeks so it can collect work, and `target` keeps the due date it
   * closes on.
   */
  async ensureAssignment() {
    const { plan } = this;

    if (this.assignment) {
      const closedNow = this.assignment.closesAt !== null && Date.parse(this.assignment.closesAt) < Date.now();
      this.dueDate = this.assignment.dueDate ?? null;
      this.target = this.closes && !closedNow ? dateFromToday(plan.due) : this.dueDate;
      return;
    }

    this.dueDate = plan.due === null ? null : dateFromToday(this.closes ? 14 : plan.due);
    this.target = plan.due === null ? null : dateFromToday(plan.due);
    const { assignment } = await api("POST", this.route, this.professor.token, {
      name: plan.name,
      description: `${plan.name}. Seeded for the gradebook load test.`,
      points: plan.points,
      ...(this.dueDate === null ? {} : { dueDate: this.dueDate }),
    });
    this.assignment = assignment;
    this.note("created");
  }

  /** Returns the professor's roster for the assignment, keyed by student uid. */
  async loadRoster() {
    const { students } = await this.api("GET", "/submit");
    return new Map(students.map((row) => [row.studentId, row]));
  }

  /** Moves the due date as the professor. */
  async setDueDate(dueDate) {
    await this.api("PATCH", "", { dueDate });
    this.dueDate = dueDate;
  }

  /** Moves a closed assignment's due date out two weeks so it takes work again. */
  async open() {
    if (this.closes && this.dueDate === this.target) await this.setDueDate(dateFromToday(14));
  }

  /** Moves the due date back to the one the assignment closes on. */
  async close() {
    if (this.dueDate !== this.target) await this.setDueDate(this.target);
  }

  /** Uploads a one-page PDF as a student's submission. The assignment must be open. */
  async submit(student, suffix = "") {
    const lastName = student.name.split(" ").at(-1);
    const fileName = `${lastName}_${this.plan.file}${suffix}.pdf`;
    const form = new FormData();
    const pdf = new Uint8Array(makePdf(`${student.name}: ${this.plan.name}`));
    form.append("file", new File([pdf], fileName, { type: "application/pdf" }));

    await request("POST", `${config.appUrl}${this.route}/${this.assignment.id}/submit`, { token: student.token, form });
    this.note({ _v2: "resubmitted", _late: "turned in late" }[suffix] ?? "submitted");
  }
}

// #endregion

// #region Course

/** Returns the load-test course found by code, term, year and section, or null. */
async function findCourse(admin) {
  const { classes } = await api("GET", `/api/admin/classes?q=${encodeURIComponent(COURSE.courseCode)}`, admin.token);

  return (
    classes.find(
      (course) =>
        course.courseCode === COURSE.courseCode &&
        course.term === COURSE.term &&
        course.year === COURSE.year &&
        course.section === COURSE.section
    ) ?? null
  );
}

/** Enrolls a student as the admin. Returns false when they already are. */
async function enroll(admin, courseId, student) {
  try {
    await api("POST", `/api/admin/classes/${courseId}/enrollments`, admin.token, { studentId: student.uid });
    return true;
  } catch (error) {
    if (isApiError(error, 409)) return false;
    throw error;
  }
}

/** Takes a student out of the course as the admin. Returns false when they weren't enrolled. */
async function unenroll(admin, courseId, student) {
  try {
    await api("DELETE", `/api/admin/classes/${courseId}/enrollments/${student.uid}`, admin.token);
    return true;
  } catch (error) {
    if (isApiError(error, 404)) return false;
    throw error;
  }
}

/** Prints what the script makes sure exists, for a check before a production run. */
async function printPlan(admin, course) {
  const professorExists = Boolean(await trySignIn(config.professor.email, config.professor.password));
  const closed = ASSIGNMENTS.filter((plan) => plan.due !== null && plan.due < 0).length;
  const undated = ASSIGNMENTS.filter((plan) => plan.due === null).length;
  const uploads = ASSIGNMENTS.flatMap((plan) => Object.values(plan.outcomes)).filter(
    (outcome) => !("missingZero" in outcome)
  ).length;

  console.log(`\nPlan for ${config.appUrl}, as ${admin.email}:`);
  console.log(
    professorExists
      ? `  professor ${config.professor.email} exists`
      : `  sign up ${config.professor.email} as ${config.professor.name}, apply as a professor and approve`
  );
  console.log(
    course
      ? `  ${COURSE.courseCode} exists (${course.id}). Only missing work is added.`
      : `  create ${COURSE.courseCode}: ${COURSE.name}, ${COURSE.term} ${COURSE.year}, Section ${COURSE.section}`
  );
  console.log("  closed to enrollment requests afterwards");
  console.log(`  ${Object.keys(STUDENTS).length} students as loadNN@load.panel-app.test, signed up unless they exist`);
  console.log(
    `  ${ASSIGNMENTS.length} assignments: ${closed} closed, ${ASSIGNMENTS.length - closed - undated} open, ${undated} with no due date`
  );
  console.log(`  about ${uploads} one-page PDF uploads to storage`);
  console.log(`  ${STUDENTS[LEAVER].name} leaves the class at the end`);
  console.log(`  then ${TIMED_LOADS + 1} gradebook loads as the professor`);
}

// #endregion

// #region Timing

/** Returns the value at percentile `percent` of sorted numbers, by the nearest-rank method. */
function percentile(sorted, percent) {
  return sorted[Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)];
}

/** Returns why a gradebook response is incomplete, or null when it has every assignment and student. */
function checkGradebook(gradebook) {
  const expectedStudents = Object.entries(STUDENTS).filter(
    ([key]) => key !== LEAVER || ASSIGNMENTS.some((plan) => plan.outcomes[key])
  );
  const emails = new Set(gradebook.students.map((student) => student.email));
  const absent = expectedStudents.filter(([, student]) => !emails.has(student.email));
  const leaver = gradebook.students.find((student) => student.email === STUDENTS[LEAVER].email);

  if (gradebook.assignments.length !== ASSIGNMENTS.length) {
    return `expected ${ASSIGNMENTS.length} assignments, got ${gradebook.assignments.length}`;
  }
  if (gradebook.students.length !== expectedStudents.length) {
    return `expected ${expectedStudents.length} students, got ${gradebook.students.length}`;
  }
  if (absent.length > 0) return `missing students: ${absent.map(([key]) => key).join(", ")}`;
  if (leaver?.enrolled) return `${STUDENTS[LEAVER].name} is still enrolled`;

  return null;
}

/**
 * Loads the gradebook once to warm up, then TIMED_LOADS times in a row, and
 * prints the median, p95 and max. Returns whether p95 met the target and every
 * response was complete.
 */
async function timeGradebook(professor, courseId) {
  const route = `/api/classes/${courseId}/gradebook`;
  const problems = new Set();
  const check = (gradebook) => {
    const problem = checkGradebook(gradebook);
    if (problem) problems.add(problem);
  };

  check(await api("GET", route, professor.token));

  const timings = [];
  for (let run = 0; run < TIMED_LOADS; run += 1) {
    const started = performance.now();
    const gradebook = await api("GET", route, professor.token);
    timings.push(performance.now() - started);
    check(gradebook);
  }

  const sorted = [...timings].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const p95 = percentile(sorted, 95);
  const max = sorted.at(-1);

  console.log(`\nGET ${route}, ${TIMED_LOADS} loads after a warm-up:`);
  console.log(`  median ${median.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, max ${max.toFixed(0)} ms`);

  for (const problem of problems) console.error(`  incomplete response: ${problem}`);

  if (p95 >= TARGET_P95_MS) {
    console.error(`  p95 is ${p95.toFixed(0)} ms, over the ${TARGET_P95_MS} ms target`);
  } else {
    console.log(`  p95 is under the ${TARGET_P95_MS} ms target`);
  }

  return p95 < TARGET_P95_MS && problems.size === 0;
}

// #endregion

/** Signs everyone in, creates what is missing, and returns the course and its professor. */
async function seed(admin, course) {
  const started = performance.now();

  console.log("Accounts");
  const professor = await ensureProfessor(admin);
  const students = {};
  let createdCount = 0;
  await inParallel(Object.entries(STUDENTS), async ([key, student]) => {
    const result = await ensureStudent(student);
    students[key] = result.student;
    if (result.created) createdCount += 1;
  });
  console.log(`  ${createdCount} students created, ${Object.keys(STUDENTS).length - createdCount} signed in`);

  if (course && course.professorId !== professor.uid) {
    fail(`${COURSE.courseCode} (${course.id}) is taught by someone other than ${professor.email}.`);
  }

  if (!course) {
    ({ class: course } = await api("POST", "/api/classes", admin.token, { ...COURSE, professorId: professor.uid }));
    console.log(`Created course ${course.id}`);
  } else {
    console.log(`Found course ${course.id}`);
  }

  const { assignments } = await api("GET", `/api/classes/${course.id}/assignments`, professor.token);
  const byName = new Map(assignments.map((assignment) => [assignment.name, assignment]));
  const state = { missingGrades: true };
  const seeders = ASSIGNMENTS.map(
    (plan) =>
      new AssignmentSeeder({
        professor,
        students,
        courseId: course.id,
        plan,
        assignment: byName.get(plan.name) ?? null,
        state,
      })
  );

  // The student who left is enrolled again only while some of their work is missing
  const leaver = students[LEAVER];
  let leaverHasGaps = false;
  for (const seeder of seeders) {
    const outcome = seeder.plan.outcomes[LEAVER];
    if (!outcome) continue;
    const row = seeder.assignment ? (await seeder.loadRoster()).get(leaver.uid) : undefined;
    if (!isDone(outcome, row)) leaverHasGaps = true;
  }

  let enrolledCount = 0;
  await inParallel(Object.entries(students), async ([key, student]) => {
    if (key === LEAVER && !leaverHasGaps) return;
    if (await enroll(admin, course.id, student)) enrolledCount += 1;
  });
  if (enrolledCount > 0) console.log(`Enrolled ${enrolledCount} students`);

  console.log("Assignments");
  for (const seeder of seeders) await seeder.run();

  if (await unenroll(admin, course.id, leaver)) console.log(`${leaver.name} left the class`);
  await api("PATCH", `/api/admin/classes/${course.id}`, admin.token, { enrollmentOpen: false });

  if (!state.missingGrades) {
    console.warn("\nMissing-work zeros and late work were skipped. Run this again once the app has the route.");
  }
  console.log(`Seeded in ${((performance.now() - started) / 1000).toFixed(1)} s`);

  return { course, professor };
}

async function main() {
  const counts = countCellStates();
  const absentStates = CELL_STATES.filter((state) => !counts.get(state));
  if (absentStates.length > 0) fail(`The generated plan has no cells for: ${absentStates.join(", ")}`);

  const where = config.target === "production" ? "PRODUCTION" : "the emulators";
  console.log(`Gradebook load test on ${where}: ${config.appUrl}`);
  console.log(`Cells: ${CELL_STATES.map((state) => `${counts.get(state)} ${state}`).join(", ")}`);

  const admin = await signInAdmin();
  let course = await findCourse(admin);
  let professor;

  if (config.skipSeed) {
    if (!course) fail(`${COURSE.courseCode} doesn't exist yet. Run without LOAD_TEST_SKIP_SEED to seed it.`);
    professor = await trySignIn(config.professor.email, config.professor.password);
    if (!professor) fail(`Couldn't sign in as ${config.professor.email}. Check PROFESSOR_EMAIL and PROFESSOR_PASSWORD.`);
    console.log(`Found course ${course.id}. Skipping the seeding.`);
  } else {
    if (config.target === "production" && !config.confirmed) {
      await printPlan(admin, course);
      console.log("\nNothing was written. Run again with SEED_CONFIRM=yes to seed it.");
      return;
    }

    ({ course, professor } = await seed(admin, course));
  }

  const passed = await timeGradebook(professor, course.id);
  console.log(`\nThe course is at ${config.appUrl}/classes/${course.id}/grades`);
  if (!passed) process.exit(1);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
