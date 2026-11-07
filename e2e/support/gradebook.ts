import { expect, type Locator, type Page } from "@playwright/test";
import { AUTH_HOST, PASSWORD } from "./env";
import {
  api,
  createAssignment,
  dateFromToday,
  grade,
  gradeMissing,
  setDueDate,
  submit,
  type Person,
  type Scenario,
  type SeededAssignment,
} from "./scenario";

export const QUIZ_POINTS = 10;
export const QUIZ_CARA_SCORE = 10;
export const QUIZ_CARA_FEEDBACK = "Perfect score.\nEvery use case names its actor and its trigger.";
export const QUIZ_DEV_FEEDBACK = "No quiz received. Come to office hours to make it up.";

/**
 * Adds a closed "Quiz 1" to the seeded course: Ava scored 0 with no feedback,
 * Cara scored full marks with feedback, Dev has a missing-work grade and Ben
 * is missing with no grade.
 */
export async function addQuiz(scenario: Scenario): Promise<SeededAssignment> {
  const { professor, students, course } = scenario;
  const quiz = await createAssignment(professor, course.id, "Quiz 1", QUIZ_POINTS, dateFromToday(7));

  await Promise.all([
    submit(students.ava, course.id, quiz.id, "Martin_Quiz1.pdf"),
    submit(students.cara, course.id, quiz.id, "Diaz_Quiz1.pdf"),
  ]);
  await grade(professor, course.id, quiz.id, students.ava, 0, "");
  await grade(professor, course.id, quiz.id, students.cara, QUIZ_CARA_SCORE, QUIZ_CARA_FEEDBACK);

  await setDueDate(professor, course.id, quiz.id, -3);
  await gradeMissing(professor, course.id, quiz.id, students.dev, QUIZ_DEV_FEEDBACK);

  return quiz;
}

/** Returns a course's gradebook page, relative to the app. */
export function gradesPath(scenario: Scenario): string {
  return `/classes/${scenario.course.id}/grades`;
}

/** Escapes text for use inside a regular expression. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the gradebook cell button for a student's work on an assignment. */
export function gradeCell(page: Page, studentName: string, assignmentName: string): Locator {
  return page
    .getByRole("table")
    .getByRole("button", {
      name: new RegExp(`\\. ${escapeRegExp(studentName)}, ${escapeRegExp(assignmentName)}$`),
    });
}

/** Returns the gradebook's details panel. */
export function detailsPanel(page: Page): Locator {
  return page.getByRole("dialog");
}

/** Returns the grid's frozen student column header for a student. */
export function studentRowHeader(page: Page, studentName: string): Locator {
  return page.getByRole("rowheader").filter({ hasText: studentName });
}

/**
 * Expects a cell to sit fully clear of the frozen student column and the
 * frozen header row, so its focus outline can be seen.
 */
export async function expectClearOfFrozenParts(page: Page, cell: Locator) {
  const [cellBox, columnBox, headerBox] = await Promise.all([
    cell.boundingBox(),
    page.getByRole("rowheader").first().boundingBox(),
    page.getByRole("columnheader").first().boundingBox(),
  ]);

  expect(cellBox && columnBox && headerBox).toBeTruthy();
  expect(cellBox!.x).toBeGreaterThanOrEqual(columnBox!.x + columnBox!.width - 1);
  expect(cellBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
}

/** Takes a student out of the seeded course as the seeded admin. */
export async function unenroll(scenario: Scenario, student: Person) {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "jordan.hayes@admin.example.edu",
        password: PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  const { idToken } = (await response.json()) as { idToken: string };

  await api("DELETE", `/api/admin/classes/${scenario.course.id}/enrollments/${student.uid}`, idToken);
}
