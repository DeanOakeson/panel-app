import { test, expect, signIn } from "./support/fixtures";
import {
  expectMissingScore,
  expectStatus,
  filterButton,
  markMissing,
  ownSubmission,
  saveGrade,
  studentCard,
  submissionList,
  timestampLine,
} from "./support/grading";
import { makePdf } from "./support/pdf";
import { setDueDate } from "./support/scenario";

const FEEDBACK = "No submission received. Talk to me about the late policy.";
const EDITED_FEEDBACK = "Partial credit for the outline you emailed.";

test.describe("Professor grades a student who did not submit", () => {
  test("marks the work missing at 0 without a submission and shows it on the card", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const dev = studentCard(page, "Dev Patel");
    await expectStatus(dev, "Missing");
    await expect(dev.getByRole("button", { name: "Save grade" })).toHaveCount(0);

    // Cancel closes the form without saving
    await dev.getByRole("button", { name: "Mark missing" }).click();
    await expect(dev.getByLabel("Score")).toHaveCount(0);
    await expect(dev).toContainText("Records 0 / 100 as a missing-work grade.");
    await dev.getByLabel("Feedback").fill("Draft");
    await dev.getByRole("button", { name: "Cancel" }).click();
    await expect(dev.getByLabel("Feedback")).toHaveCount(0);
    await expectStatus(dev, "Missing");

    await dev.getByRole("button", { name: "Mark missing" }).click();
    await markMissing(dev, FEEDBACK);

    await expect(dev).toContainText("No submission");
    await expect(dev.getByText("Missing-work grade", { exact: true })).toBeVisible();
    await expectMissingScore(dev, "0 / 100");
    await expect(dev).toContainText(FEEDBACK);
    await expect(dev.getByText(timestampLine("Graded"))).toBeVisible();
    await expectStatus(dev, "Missing work graded");
    await expect(dev.getByRole("button", { name: "Edit feedback" })).toBeVisible();

    await expect(submissionList(page).getByRole("status")).toHaveText("Missing-work grade saved for Dev Patel.");
    await expect(page.getByText("3 of 4 submitted · 2 need grading (1 resubmitted) · 1 missing (1 graded)")).toBeVisible();
    await expect(filterButton(page, "Missing")).toHaveText("Missing (1)");
    await expect(filterButton(page, "Graded")).toHaveText("Graded (1)");

    await page.reload();
    const reloaded = studentCard(page, "Dev Patel");
    await expectStatus(reloaded, "Missing work graded");
    await expectMissingScore(reloaded, "0 / 100");
    await expect(reloaded).toContainText(FEEDBACK);
  });

  test("edits only the feedback of a missing-work grade and keeps its history", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const dev = studentCard(page, "Dev Patel");
    await dev.getByRole("button", { name: "Mark missing" }).click();
    await markMissing(dev, FEEDBACK);
    await expectStatus(dev, "Missing work graded");

    await dev.getByRole("button", { name: "Edit feedback" }).click();
    await expect(dev.getByLabel("Score")).toHaveCount(0);
    await expect(dev.getByLabel("Feedback")).toHaveValue(FEEDBACK);
    await markMissing(dev, EDITED_FEEDBACK, "Save feedback");

    await expectMissingScore(dev, "0 / 100");
    await expect(dev).toContainText(EDITED_FEEDBACK);
    await expect(dev).not.toContainText(FEEDBACK);
    await expect(dev.getByText(timestampLine("Updated"))).toBeVisible();

    await page.reload();
    const reloaded = studentCard(page, "Dev Patel");
    await expect(reloaded).toContainText(EDITED_FEEDBACK);

    await reloaded.getByText("History", { exact: true }).click();
    const versions = reloaded.getByRole("listitem");
    await expect(versions).toHaveCount(2);
    await expect(versions.nth(0)).toContainText(`Graded by ${scenario.professor.name}`);
    await expect(versions.nth(0)).toContainText(FEEDBACK);
    await expect(versions.nth(1)).toContainText(`Edited by ${scenario.professor.name}`);
    await expect(versions.nth(1)).toContainText(EDITED_FEEDBACK);
  });

  test("the student sees their missing-work grade", async ({ page, scenario, pageAs }) => {
    const devPage = await pageAs(scenario.students.dev);
    await devPage.goto(scenario.closed.path);
    await expect(ownSubmission(devPage)).toContainText("You have not submitted this assignment yet.");
    await expect(ownSubmission(devPage).getByText("Missing-work grade", { exact: true })).toHaveCount(0);

    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);
    const dev = studentCard(page, "Dev Patel");
    await dev.getByRole("button", { name: "Mark missing" }).click();
    await markMissing(dev, FEEDBACK);
    await expectStatus(dev, "Missing work graded");

    await devPage.reload();
    const own = ownSubmission(devPage);
    await expect(own).toContainText("You have not submitted this assignment yet.");
    await expect(own.getByText("Missing-work grade", { exact: true })).toBeVisible();
    await expectMissingScore(own, "0 / 100");
    await expect(own).toContainText(FEEDBACK);
    await expect(own.getByText("History", { exact: true })).toHaveCount(0);
  });

  test("is not offered while submissions are open", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.open.path);

    for (const name of ["Ben Carter", "Cara Diaz", "Dev Patel"]) {
      const card = studentCard(page, name);
      await expectStatus(card, "Not submitted");
      await expect(card.getByRole("button", { name: "Mark missing" })).toHaveCount(0);
    }

    await page.goto(scenario.closed.path);
    await expect(studentCard(page, "Dev Patel").getByRole("button", { name: "Mark missing" })).toBeVisible();
  });

  test("a later submission keeps the missing-work grade and is flagged for grading", async ({
    page,
    scenario,
    pageAs,
  }) => {
    const { closed, course, professor } = scenario;

    await signIn(page, professor);
    await page.goto(closed.path);
    const dev = studentCard(page, "Dev Patel");
    await dev.getByRole("button", { name: "Mark missing" }).click();
    await markMissing(dev, FEEDBACK);
    await expectStatus(dev, "Missing work graded");

    // The professor extends the due date, which lets Dev submit late
    await setDueDate(professor, course.id, closed.id, 7);
    await page.reload();
    const reopened = studentCard(page, "Dev Patel");
    await expectStatus(reopened, "Missing work graded");
    await expect(reopened.getByRole("button", { name: "Edit feedback" })).toBeVisible();

    const devPage = await pageAs(scenario.students.dev);
    await devPage.goto(closed.path);
    await expectMissingScore(ownSubmission(devPage), `0 / ${closed.points}`);
    await devPage.locator("#assignment-file").setInputFiles({
      name: "Patel_Project1.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Dev Patel: Project 1"),
    });
    await devPage.getByRole("button", { name: "Submit assignment" }).click();
    await expect(devPage.getByText("Assignment submitted successfully!")).toBeVisible();

    const notice = `Submitted after a missing-work grade of 0 / ${closed.points}`;
    const own = ownSubmission(devPage);
    await expect(own).toContainText("Patel_Project1.pdf");
    await expect(own).toContainText("Not graded yet");
    await expectMissingScore(own, notice);

    await page.reload();
    const flagged = studentCard(page, "Dev Patel");
    await expectStatus(flagged, "Submitted after missing grade");
    await expect(flagged).toContainText("Patel_Project1.pdf");
    await expectMissingScore(flagged, notice);
    await expect(
      page.getByText("4 of 4 submitted · 3 need grading (1 resubmitted, 1 after a missing-work grade)")
    ).toBeVisible();

    await saveGrade(flagged, "72", "Late, but complete.");
    await expectStatus(flagged, "Graded");
    await expect(flagged).toContainText(`72 / ${closed.points}`);
    await expect(flagged.getByText(notice)).toBeVisible();

    await devPage.reload();
    await expect(own).toContainText(`72 / ${closed.points}`);
    await expect(own.getByText(notice)).toBeVisible();
  });
});
