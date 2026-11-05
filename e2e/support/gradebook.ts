import type { Locator, Page } from "@playwright/test";
import {
  createAssignment,
  dateFromToday,
  grade,
  gradeMissing,
  setDueDate,
  submit,
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
