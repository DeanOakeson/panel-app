import { test, expect, signIn } from "./support/fixtures";
import {
  expectStatus,
  filterButton,
  ownSubmission,
  saveGrade,
  studentCard,
  submissionList,
  timestampLine,
} from "./support/grading";
import { makePdf } from "./support/pdf";

const FEEDBACK = "No submission received. Talk to me about the late policy.";
const EDITED_FEEDBACK = "Partial credit for the outline you emailed.";

test.describe("Professor grades a student who did not submit", () => {
  test("saves a missing-work grade without a submission and shows it on the card", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const dev = studentCard(page, "Dev Patel");
    await expectStatus(dev, "Missing");
    await expect(dev.getByRole("button", { name: "Save grade" })).toHaveCount(0);

    // Cancel closes the form without saving
    await dev.getByRole("button", { name: "Grade missing work" }).click();
    await dev.getByLabel("Score").fill("50");
    await dev.getByRole("button", { name: "Cancel" }).click();
    await expect(dev.getByLabel("Score")).toHaveCount(0);
    await expectStatus(dev, "Missing");

    await dev.getByRole("button", { name: "Grade missing work" }).click();
    await saveGrade(dev, "0", FEEDBACK);

    await expect(dev).toContainText("No submission");
    await expect(dev.getByText("Missing-work grade", { exact: true })).toBeVisible();
    await expect(dev).toContainText("0 / 100");
    await expect(dev).toContainText(FEEDBACK);
    await expect(dev.getByText(timestampLine("Graded"))).toBeVisible();
    await expectStatus(dev, "Missing work graded");
    await expect(dev.getByRole("button", { name: "Edit missing-work grade" })).toBeVisible();

    await expect(submissionList(page).getByRole("status")).toHaveText("Missing-work grade saved for Dev Patel.");
    await expect(page.getByText("3 of 4 submitted · 2 need grading (1 resubmitted) · 1 missing (1 graded)")).toBeVisible();
    await expect(filterButton(page, "Missing")).toHaveText("Missing (1)");
    await expect(filterButton(page, "Graded")).toHaveText("Graded (1)");

    await page.reload();
    const reloaded = studentCard(page, "Dev Patel");
    await expectStatus(reloaded, "Missing work graded");
    await expect(reloaded).toContainText("0 / 100");
    await expect(reloaded).toContainText(FEEDBACK);
  });

  test("edits a missing-work grade and marks it Updated", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const dev = studentCard(page, "Dev Patel");
    await dev.getByRole("button", { name: "Grade missing work" }).click();
    await saveGrade(dev, "0", FEEDBACK);
    await expectStatus(dev, "Missing work graded");

    await dev.getByRole("button", { name: "Edit missing-work grade" }).click();
    await expect(dev.getByLabel("Score")).toHaveValue("0");
    await expect(dev.getByLabel("Feedback")).toHaveValue(FEEDBACK);
    await saveGrade(dev, "15", EDITED_FEEDBACK, "Save changes");

    await expect(dev).toContainText("15 / 100");
    await expect(dev).toContainText(EDITED_FEEDBACK);
    await expect(dev).not.toContainText(FEEDBACK);
    await expect(dev.getByText(timestampLine("Updated"))).toBeVisible();

    await page.reload();
    await expect(studentCard(page, "Dev Patel")).toContainText("15 / 100");
  });

  test("the student sees their missing-work grade", async ({ page, scenario, pageAs }) => {
    const devPage = await pageAs(scenario.students.dev);
    await devPage.goto(scenario.closed.path);
    await expect(ownSubmission(devPage)).toContainText("You have not submitted this assignment yet.");
    await expect(ownSubmission(devPage).getByText("Missing-work grade", { exact: true })).toHaveCount(0);

    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);
    const dev = studentCard(page, "Dev Patel");
    await dev.getByRole("button", { name: "Grade missing work" }).click();
    await saveGrade(dev, "0", FEEDBACK);
    await expectStatus(dev, "Missing work graded");

    await devPage.reload();
    const own = ownSubmission(devPage);
    await expect(own).toContainText("You have not submitted this assignment yet.");
    await expect(own.getByText("Missing-work grade", { exact: true })).toBeVisible();
    await expect(own).toContainText("0 / 100");
    await expect(own).toContainText(FEEDBACK);
  });

  test("a later submission keeps the missing-work grade and is flagged for grading", async ({
    page,
    scenario,
    pageAs,
  }) => {
    const { open } = scenario;

    await signIn(page, scenario.professor);
    await page.goto(open.path);
    const ben = studentCard(page, "Ben Carter");
    await ben.getByRole("button", { name: "Grade missing work" }).click();
    await saveGrade(ben, "0", FEEDBACK);
    await expectStatus(ben, "Missing work graded");

    const benPage = await pageAs(scenario.students.ben);
    await benPage.goto(open.path);
    await expect(ownSubmission(benPage)).toContainText(`0 / ${open.points}`);
    await benPage.locator("#assignment-file").setInputFiles({
      name: "Carter_Homework2.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Ben Carter: Homework 2"),
    });
    await benPage.getByRole("button", { name: "Submit assignment" }).click();
    await expect(benPage.getByText("Assignment submitted successfully!")).toBeVisible();

    const notice = `Submitted after a missing-work grade of 0 / ${open.points}`;
    const own = ownSubmission(benPage);
    await expect(own).toContainText("Carter_Homework2.pdf");
    await expect(own).toContainText("Not graded yet");
    await expect(own.getByText(notice)).toBeVisible();

    await page.reload();
    const flagged = studentCard(page, "Ben Carter");
    await expectStatus(flagged, "Submitted after missing grade");
    await expect(flagged).toContainText("Carter_Homework2.pdf");
    await expect(flagged.getByText(notice)).toBeVisible();
    await expect(page.getByText("2 of 4 submitted · 2 need grading (1 after a missing-work grade) · 2 not submitted")).toBeVisible();

    await saveGrade(flagged, "18", "Late, but complete.");
    await expectStatus(flagged, "Graded");
    await expect(flagged).toContainText(`18 / ${open.points}`);
    await expect(flagged.getByText(notice)).toBeVisible();

    await benPage.reload();
    await expect(own).toContainText(`18 / ${open.points}`);
    await expect(own.getByText(notice)).toBeVisible();
  });
});
