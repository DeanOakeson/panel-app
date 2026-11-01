import { test, expect, signIn } from "./support/fixtures";
import {
  expectCards,
  expectStatus,
  filterButton,
  ownSubmission,
  saveGrade,
  studentCard,
  submissionList,
  timestampLine,
} from "./support/grading";

const FEEDBACK = "Thorough stakeholder analysis. Number the non-functional requirements.";

test.describe("Professor grades a submission", () => {
  test("saves a score and feedback, and shows the grade on the card", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const ava = studentCard(page, "Ava Martin");
    await expect(ava).toContainText("Not graded");
    await saveGrade(ava, "88", FEEDBACK);

    await expect(ava).toContainText("88 / 100");
    await expect(ava).toContainText(FEEDBACK);
    await expect(ava.getByText(timestampLine("Graded"))).toBeVisible();
    await expectStatus(ava, "Graded");
    await expect(ava.getByRole("button", { name: "Edit grade" })).toBeVisible();
    await expect(ava.getByRole("button", { name: "Save grade" })).toHaveCount(0);

    await expect(submissionList(page).getByRole("status")).toHaveText("Grade saved for Ava Martin. 1 left to grade.");
    await expect(page.getByText("3 of 4 submitted · 1 needs grading (1 resubmitted) · 1 missing")).toBeVisible();
    await expect(filterButton(page, "Needs grading")).toHaveText("Needs grading (1)");
    await expect(filterButton(page, "Graded")).toHaveText("Graded (2)");

    await page.reload();
    await expect(studentCard(page, "Ava Martin")).toContainText("88 / 100");
    await expect(studentCard(page, "Ava Martin")).toContainText(FEEDBACK);
  });

  test("under Needs grading, a graded card leaves the view and the counts update", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    await filterButton(page, "Needs grading").click();
    await expectCards(page, ["Ava Martin", "Ben Carter"]);

    const ava = studentCard(page, "Ava Martin");
    await saveGrade(ava, "75", FEEDBACK);

    // The card stays briefly so the professor sees the saved grade
    await expect(ava).toContainText("75 / 100");
    await expectStatus(ava, "Graded");
    await expect(filterButton(page, "Needs grading")).toHaveText("Needs grading (1)");
    await expect(filterButton(page, "Graded")).toHaveText("Graded (2)");

    await expectCards(page, ["Ben Carter"]);
    await expect(filterButton(page, "Needs grading")).toHaveAttribute("aria-pressed", "true");
  });

  test("refuses a score outside 0 to the assignment's points", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const gradeRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/grade")) gradeRequests.push(request.method());
    });

    const ava = studentCard(page, "Ava Martin");
    const score = ava.getByLabel("Score");

    // The browser's own validation stops the form and shows its message beside the field
    await saveGrade(ava, "150", FEEDBACK);
    await expect(score).toHaveJSProperty("validationMessage", "Value must be less than or equal to 100.");

    await saveGrade(ava, "-5", FEEDBACK);
    await expect(score).toHaveJSProperty("validationMessage", "Value must be greater than or equal to 0.");

    await expect(ava).toContainText("Not graded");
    await expectStatus(ava, "Needs grading");
    expect(gradeRequests).toEqual([]);

    await saveGrade(ava, "100", FEEDBACK);
    await expect(ava).toContainText("100 / 100");
    expect(gradeRequests).toEqual(["POST"]);
  });

  test("the student sees the score and feedback", async ({ page, scenario, pageAs }) => {
    const avaPage = await pageAs(scenario.students.ava);
    await avaPage.goto(scenario.closed.path);
    await expect(ownSubmission(avaPage)).toContainText("Not graded yet");

    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);
    const ava = studentCard(page, "Ava Martin");
    await saveGrade(ava, "88", FEEDBACK);
    await expectStatus(ava, "Graded");

    await avaPage.reload();
    const submission = ownSubmission(avaPage);
    await expect(submission).toContainText("Martin_Project1.pdf");
    await expect(submission).toContainText("88 / 100");
    await expect(submission.getByText("Professor feedback")).toBeVisible();
    await expect(submission).toContainText(FEEDBACK);
  });
});
