import { test, expect, signIn } from "./support/fixtures";
import {
  QUIZ_CARA_FEEDBACK,
  addQuiz,
  detailsPanel,
  gradeCell,
  gradesPath,
} from "./support/gradebook";
import { saveGrade, studentCard } from "./support/grading";
import { BEN_SCORE, CARA_SCORE } from "./support/scenario";

const QUIZ = "Quiz 1";
const PROJECT = "Project 1: Requirements";
const HOMEWORK = "Homework 2: Use Cases";

test.describe("Professor gradebook", () => {
  test("opens from the course nav and tells every grading state apart", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}`);

    await page.getByRole("link", { name: "Grades", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${gradesPath(scenario)}$`));
    await expect(page.getByRole("heading", { name: "Grades", level: 1 })).toBeVisible();
    await expect(page.getByText("CS 3450 · Software Engineering")).toBeVisible();
    await expect(page.getByText("3 submissions to grade")).toBeVisible();

    // Columns run by due date: Project 1, then Quiz 1, then the open Homework 2
    await expect(page.getByRole("columnheader")).toHaveText([
      "Student",
      new RegExp(`^${PROJECT}`),
      new RegExp(`^${QUIZ}`),
      new RegExp(`^${HOMEWORK}`),
    ]);
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${PROJECT}`) })).toContainText(
      "2 to grade"
    );
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${QUIZ}`) })).toContainText(
      "All graded"
    );

    // A graded 0, a missing-work 0 and missing work without a grade
    const avaQuiz = gradeCell(page, "Ava Martin", QUIZ);
    await expect(avaQuiz).toHaveText("0/10");
    await expect(avaQuiz).toHaveAccessibleName("0 out of 10. Ava Martin, Quiz 1");

    const devQuiz = gradeCell(page, "Dev Patel", QUIZ);
    await expect(devQuiz).toHaveText("0/10Missing");
    await expect(devQuiz).toHaveAccessibleName(/^0 out of 10, Missing, has feedback\./);

    const benQuiz = gradeCell(page, "Ben Carter", QUIZ);
    await expect(benQuiz).toHaveText("Missing");
    await expect(benQuiz).toHaveAccessibleName(/^Missing, no grade yet\./);

    await expect(gradeCell(page, "Cara Diaz", QUIZ)).toHaveAccessibleName(
      /^10 out of 10, has feedback\./
    );

    // The closed project: to grade, resubmitted with its standing score, graded and missing
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("Needs grading");
    await expect(gradeCell(page, "Ben Carter", PROJECT)).toHaveText(`Resubmitted${BEN_SCORE}/100`);
    await expect(gradeCell(page, "Cara Diaz", PROJECT)).toHaveText(`${CARA_SCORE}/100`);
    await expect(gradeCell(page, "Dev Patel", PROJECT)).toHaveText("Missing");

    // The open homework: not submitted yet rather than missing
    await expect(gradeCell(page, "Ava Martin", HOMEWORK)).toHaveText("Needs grading");
    await expect(gradeCell(page, "Ben Carter", HOMEWORK)).toHaveText("Not submitted");

    await expect(page.getByRole("region", { name: "Key" })).toContainText("Missing-work grade of 0");
  });

  test("opens a cell's details with the full feedback and closes with Escape", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    const cell = gradeCell(page, "Cara Diaz", QUIZ);
    await cell.focus();
    await page.keyboard.press("Enter");

    const panel = detailsPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAccessibleName("Cara Diaz");
    await expect(panel).toContainText(QUIZ);
    await expect(panel).toContainText("Graded");
    await expect(panel).toContainText("10/ 10");
    await expect(panel).toContainText(QUIZ_CARA_FEEDBACK);
    await expect(panel.getByRole("link", { name: "Edit grade" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(cell).toBeFocused();

    // A click outside the drawer closes it too
    await gradeCell(page, "Dev Patel", QUIZ).click();
    await expect(panel).toContainText("A missing-work grade, saved because nothing was turned in.");
    await expect(panel.getByRole("link", { name: "Edit feedback" })).toBeVisible();
    await page.mouse.click(20, 400);
    await expect(panel).toBeHidden();
  });

  test("grades a submission from the gradebook and comes back to the new score", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));
    await expect(page.getByText("3 submissions to grade")).toBeVisible();

    await gradeCell(page, "Ava Martin", PROJECT).click();
    await detailsPanel(page).getByRole("link", { name: "Grade submission" }).click();

    await expect(page).toHaveURL(
      `${scenario.closed.path}?student=${scenario.students.ava.uid}&from=grades`
    );
    const card = studentCard(page, "Ava Martin");
    await expect(card).toBeFocused();
    await saveGrade(card, "88", "Solid outline.");
    await expect(card).toContainText("88 / 100");

    await page.getByRole("link", { name: "← Back to grades" }).click();
    await expect(page).toHaveURL(new RegExp(`${gradesPath(scenario)}$`));
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("88/100");
    await expect(page.getByText("2 submissions to grade")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${PROJECT}`) })).toContainText(
      "1 to grade"
    );
  });

  test("updates an open gradebook when another tab saves a grade", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("Needs grading");
    await page.evaluate(() => {
      (window as unknown as { gradebookMarker: boolean }).gradebookMarker = true;
    });

    const grading = await page.context().newPage();
    await grading.goto(scenario.closed.path);
    await saveGrade(studentCard(grading, "Ava Martin"), "77", "Graded in another tab.");
    await expect(studentCard(grading, "Ava Martin")).toContainText("77 / 100");

    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("77/100");
    expect(
      await page.evaluate(
        () => (window as unknown as { gradebookMarker?: boolean }).gradebookMarker
      )
    ).toBe(true);
  });

  test("points a student to the assignments instead of a gradebook", async ({ pageAs, scenario }) => {
    const page = await pageAs(scenario.students.ava);
    await page.goto(gradesPath(scenario));

    await expect(page.getByText("Your grades and feedback are on each assignment's page.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await page.getByRole("link", { name: "Go to assignments" }).click();
    await expect(page).toHaveURL(new RegExp(`${scenario.course.assignmentsPath}$`));
  });
});
