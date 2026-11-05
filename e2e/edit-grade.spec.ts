import { test, expect, signIn } from "./support/fixtures";
import {
  expectStatus,
  filterButton,
  ownSubmission,
  saveGrade,
  studentCard,
  timestampLine,
} from "./support/grading";
import { BEN_FEEDBACK, BEN_SCORE, CARA_FEEDBACK, CARA_SCORE } from "./support/scenario";

const EDITED_FEEDBACK = "Regraded: the acceptance criteria in the appendix cover FR-3.";

test.describe("Professor edits a saved grade", () => {
  test("changes the score and feedback, and marks the grade Updated", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const cara = studentCard(page, "Cara Diaz");
    await expect(cara).toContainText(`${CARA_SCORE} / 100`);
    await expect(cara.getByText(timestampLine("Updated"))).toHaveCount(0);

    // Cancel leaves the saved grade alone
    await cara.getByRole("button", { name: "Edit grade" }).click();
    await cara.getByLabel("Score").fill("10");
    await cara.getByRole("button", { name: "Cancel" }).click();
    await expect(cara).toContainText(`${CARA_SCORE} / 100`);

    await cara.getByRole("button", { name: "Edit grade" }).click();
    await expect(cara.getByLabel("Score")).toHaveValue(String(CARA_SCORE));
    await expect(cara.getByLabel("Feedback")).toHaveValue(CARA_FEEDBACK);
    await saveGrade(cara, "95", EDITED_FEEDBACK, "Save changes");

    await expect(cara).toContainText("95 / 100");
    await expect(cara).toContainText(EDITED_FEEDBACK);
    await expect(cara).not.toContainText(CARA_FEEDBACK);
    await expect(cara.getByText(timestampLine("Graded"))).toBeVisible();
    await expect(cara.getByText(timestampLine("Updated"))).toBeVisible();
    await expectStatus(cara, "Graded");
    await expect(cara.getByRole("button", { name: "Edit grade" })).toBeVisible();
    await expect(page.getByText("3 of 4 submitted · 2 need grading (1 resubmitted) · 1 missing")).toBeVisible();

    await page.reload();
    await expect(studentCard(page, "Cara Diaz")).toContainText("95 / 100");
    await expect(studentCard(page, "Cara Diaz").getByText(timestampLine("Updated"))).toBeVisible();

    // History keeps the original grade and the edit, oldest first
    const reloaded = studentCard(page, "Cara Diaz");
    await reloaded.getByText("History", { exact: true }).click();
    const versions = reloaded.getByRole("listitem");
    await expect(versions).toHaveCount(2);
    await expect(versions.nth(0)).toContainText(`${CARA_SCORE} / 100`);
    await expect(versions.nth(0)).toContainText(`Graded by ${scenario.professor.name}`);
    await expect(versions.nth(0)).toContainText(CARA_FEEDBACK);
    await expect(versions.nth(1)).toContainText("95 / 100");
    await expect(versions.nth(1)).toContainText(`Edited by ${scenario.professor.name}`);
    await expect(versions.nth(1)).toContainText(EDITED_FEEDBACK);
  });

  test("grades a resubmitted version, which clears Resubmitted", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const ben = studentCard(page, "Ben Carter");
    await expectStatus(ben, "Resubmitted");
    await expect(ben.getByText("Resubmitted after grading")).toBeVisible();
    await expect(ben.getByRole("button", { name: "Edit grade" })).toHaveCount(0);

    await ben.getByRole("button", { name: "Grade new version" }).click();
    await expect(ben.getByLabel("Score")).toHaveValue(String(BEN_SCORE));
    await expect(ben.getByLabel("Feedback")).toHaveValue(BEN_FEEDBACK);
    await saveGrade(ben, "91", "Version 2 fixes FR-2.", "Save changes");

    await expect(ben).toContainText("91 / 100");
    await expect(ben.getByText("Resubmitted after grading")).toHaveCount(0);
    await expectStatus(ben, "Graded");
    await expect(ben.getByRole("button", { name: "Edit grade" })).toBeVisible();
    await expect(page.getByText("3 of 4 submitted · 1 needs grading · 1 missing")).toBeVisible();
    await expect(filterButton(page, "Graded")).toHaveText("Graded (2)");

    await page.reload();
    await expectStatus(studentCard(page, "Ben Carter"), "Graded");
  });

  test("the student sees the edited grade", async ({ page, scenario, pageAs }) => {
    const caraPage = await pageAs(scenario.students.cara);
    await caraPage.goto(scenario.closed.path);
    await expect(ownSubmission(caraPage)).toContainText(`${CARA_SCORE} / 100`);
    await expect(ownSubmission(caraPage)).toContainText(CARA_FEEDBACK);

    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);
    const cara = studentCard(page, "Cara Diaz");
    await cara.getByRole("button", { name: "Edit grade" }).click();
    await saveGrade(cara, "95", EDITED_FEEDBACK, "Save changes");
    await expect(cara.getByText(timestampLine("Updated"))).toBeVisible();

    await caraPage.reload();
    const submission = ownSubmission(caraPage);
    await expect(submission).toContainText("95 / 100");
    await expect(submission).toContainText(EDITED_FEEDBACK);
    await expect(submission).not.toContainText(CARA_FEEDBACK);
    await expect(submission.getByText(/^Updated /)).toBeVisible();
  });
});
