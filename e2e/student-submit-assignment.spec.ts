import { test, expect } from "./support/fixtures";
import { makePdf } from "./support/pdf";
import { setDueDate } from "./support/scenario";
import { api } from "./support/scenario";

test.describe("Student assignment submissions", () => {
  test("student can view an assignment and their existing submission", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.ava);

    await page.goto(`${scenario.open.path}`);

    await expect(
      page.getByRole("heading", { name: scenario.open.name }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", {
        name: "Your submissions",
        exact: true,
      }),
    ).toBeVisible();

    await expect(page.getByText("Martin_Homework2.pdf")).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Replace submission" }),
    ).toBeVisible();
  });

  test("student can submit an assignment", async ({ scenario, pageAs }) => {
    const page = await pageAs(scenario.students.dev);

    await page.goto(scenario.open.path);

    await expect(
      page.getByText("You have not submitted this assignment yet."),
    ).toBeVisible();

    await page.locator("#assignment-file").setInputFiles({
      name: "Patel_Homework2.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF",
      ),
    });

    await page.getByRole("button", { name: "Submit assignment" }).click();

    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toBeVisible();

    await expect(page.getByText("Patel_Homework2.pdf")).toBeVisible();
  });

  test("student sees the replace submission option when they already submitted", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.ava);

    await page.goto(scenario.open.path);

    await expect(
      page.getByRole("button", { name: "Replace submission" }),
    ).toBeVisible();
  });

  test("student cannot submit to a closed assignment", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.ava);

    await page.goto(scenario.closed.path);

    await expect(page.getByText(/Submissions closed/i)).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Submit assignment" }),
    ).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: "Replace submission" }),
    ).toHaveCount(0);
  });

  test("student sees their grade and feedback", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.cara);

    await page.goto(scenario.closed.path);

    await expect(page.getByText("90 / 100")).toBeVisible();

    await expect(
      page.getByText("Clear requirements. Add acceptance criteria to FR-3."),
    ).toBeVisible();
  });

  test("student sees their missing-work grade", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.dev);

    await page.goto(scenario.closed.path);

    await expect(
      page.getByText("You have not submitted this assignment yet."),
    ).toBeVisible();
  });

  test("student can resubmit after grading and keeps the previous grade", async ({
    scenario,
    pageAs,
  }) => {
    const ben = scenario.students.ben;

    // Reopen the assignment so Ben can submit again.
    await setDueDate(
      scenario.professor,
      scenario.course.id,
      scenario.closed.id,
      7,
    );

    const page = await pageAs(ben);

    await page.goto(scenario.closed.path);

    // Verify the previous grade is visible before resubmitting.
    await expect(page.getByText("82 / 100")).toBeVisible();

    await expect(
      page.getByText("Graded before your latest submission"),
    ).toBeVisible();

    // Upload a new version.
    await page.locator("#assignment-file").setInputFiles({
      name: "Carter_Project1_v3.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Ben Carter: Project 1 version 3"),
    });

    await page.getByRole("button", { name: "Replace submission" }).click();

    // Verify successful upload.
    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toBeVisible();

    // Verify the new file appears.
    await expect(page.getByText("Carter_Project1_v3.pdf")).toBeVisible();

    // The previous grade must remain visible.
    await expect(page.getByText("82 / 100")).toBeVisible();

    await expect(
      page.getByText("Graded before your latest submission"),
    ).toBeVisible();
  });

  test("student sees only the latest three submissions after multiple resubmissions", async ({
    scenario,
    pageAs,
  }) => {
    const ben = scenario.students.ben;

    // Reopen the assignment.
    await setDueDate(
      scenario.professor,
      scenario.course.id,
      scenario.closed.id,
      7,
    );

    const page = await pageAs(ben);

    await page.goto(scenario.closed.path);

    // Ben already has two submissions:
    // Carter_Project1.pdf and Carter_Project1_v2.pdf.
    await expect(page.getByText("Carter_Project1.pdf")).toBeVisible();
    await expect(page.getByText("Carter_Project1_v2.pdf")).toBeVisible();

    // Submit a third version.
    await page.locator("#assignment-file").setInputFiles({
      name: "Carter_Project1_v3.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Ben Carter: Project 1 version 3"),
    });

    await page.getByRole("button", { name: "Replace submission" }).click();

    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toBeVisible();

    // All three versions should be visible.
    await expect(page.getByText("Carter_Project1.pdf")).toBeVisible();
    await expect(page.getByText("Carter_Project1_v2.pdf")).toBeVisible();
    await expect(page.getByText("Carter_Project1_v3.pdf")).toBeVisible();

    // Submit a fourth version.
    await page.locator("#assignment-file").setInputFiles({
      name: "Carter_Project1_v4.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Ben Carter: Project 1 version 4"),
    });

    await page.getByRole("button", { name: "Replace submission" }).click();

    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toBeVisible();

    // Only the latest three versions should remain.
    await expect(page.getByText("Carter_Project1.pdf")).toHaveCount(0);
    await expect(page.getByText("Carter_Project1_v2.pdf")).toBeVisible();
    await expect(page.getByText("Carter_Project1_v3.pdf")).toBeVisible();
    await expect(page.getByText("Carter_Project1_v4.pdf")).toBeVisible();
  });

  test("student cannot upload an unsupported file type", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.dev);

    await page.goto(scenario.open.path);

    await page.locator("#assignment-file").setInputFiles({
      name: "homework.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("This is not an allowed file."),
    });

    await page.getByRole("button", { name: "Submit assignment" }).click();

    await expect(
      page.getByText(/unsupported|invalid file|file type/i),
    ).toBeVisible();

    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toHaveCount(0);
  });

  test("student cannot upload a file larger than 10 MB", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.dev);

    await page.goto(scenario.open.path);

    await page.locator("#assignment-file").setInputFiles({
      name: "large-homework.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.concat([
        Buffer.from("%PDF-1.4\n"),
        Buffer.alloc(10 * 1024 * 1024 + 1, 65),
      ]),
    });

    await page.getByRole("button", { name: "Submit assignment" }).click();

    await expect(
      page.getByText(/10 MB|too large|maximum file size/i),
    ).toBeVisible();

    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toHaveCount(0);
  });

  test("student cannot submit when professor manually locks an assignment", async ({
    scenario,
    pageAs,
  }) => {
    await setDueDate(
      scenario.professor,
      scenario.course.id,
      scenario.open.id,
      7,
    );

    await api(
      "PATCH",
      `/api/classes/${scenario.course.id}/assignments/${scenario.open.id}`,
      scenario.professor.token,
      { isLocked: true },
    );

    const page = await pageAs(scenario.students.dev);
    await page.goto(scenario.open.path);

    await expect(
      page.getByText("Your professor has closed submissions."),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Submit assignment" }),
    ).toBeDisabled();

    await expect(page.locator("#assignment-file")).toBeDisabled();
  });

  test("student cannot submit after the assignment due date", async ({
    scenario,
    pageAs,
  }) => {
    await setDueDate(
      scenario.professor,
      scenario.course.id,
      scenario.open.id,
      -7,
    );

    const page = await pageAs(scenario.students.dev);
    await page.goto(scenario.open.path);

    await expect(page.getByText(/submissions closed/i)).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Submit assignment" }),
    ).toHaveCount(0);

    await expect(page.locator("#assignment-file")).toHaveCount(0);
  });

  test("student can resubmit and keep the previous grade", async ({
    scenario,
    pageAs,
  }) => {
    await setDueDate(
      scenario.professor,
      scenario.course.id,
      scenario.closed.id,
      7,
    );

    const page = await pageAs(scenario.students.ben);
    await page.goto(scenario.closed.path);

    // Check the previous grade
    await expect(page.getByText("82 / 100")).toBeVisible();

    // Upload a new version
    await page.locator("#assignment-file").setInputFiles({
      name: "Carter_Project1_v3.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Updated Project 1"),
    });

    await page.getByRole("button", { name: "Replace submission" }).click();

    // Check successful submission
    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toBeVisible();

    // Previous grade should still be visible
    await expect(page.getByText("82 / 100")).toBeVisible();

    await expect(
      page.getByText("Graded before your latest submission"),
    ).toBeVisible();
  });

  test("student submission history keeps only the latest three files", async ({
    scenario,
    pageAs,
  }) => {
    await setDueDate(
      scenario.professor,
      scenario.course.id,
      scenario.closed.id,
      7,
    );

    const page = await pageAs(scenario.students.ben);
    await page.goto(scenario.closed.path);

    // Upload version 3
    await page.locator("#assignment-file").setInputFiles({
      name: "Carter_Project1_v3.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Updated Project 1 version 3"),
    });

    await page.getByRole("button", { name: "Replace submission" }).click();

    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toBeVisible();

    // Upload version 4
    await page.locator("#assignment-file").setInputFiles({
      name: "Carter_Project1_v4.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Updated Project 1 version 4"),
    });

    await page.getByRole("button", { name: "Replace submission" }).click();

    await expect(
      page.getByText("Assignment submitted successfully!"),
    ).toBeVisible();

    // Latest three files should remain
    await expect(page.getByText("Carter_Project1_v2.pdf")).toBeVisible();
    await expect(page.getByText("Carter_Project1_v3.pdf")).toBeVisible();
    await expect(page.getByText("Carter_Project1_v4.pdf")).toBeVisible();

    // Original file should be removed from history
    await expect(page.getByText("Carter_Project1.pdf")).toHaveCount(0);
  });

  test("student can view their previous submission", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.ben);

    await page.goto(scenario.closed.path);

    const submission = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "Carter_Project1_v2.pdf" });

    await expect(submission).toBeVisible();

    const pagePromise = page.context().waitForEvent("page");

    await submission.getByRole("link", { name: "View file" }).click();

    const newPage = await pagePromise;

    await newPage.waitForLoadState();

    await expect(newPage).toHaveURL(/.+/);
  });

  test("student sees assignment name and points", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.dev);
    await page.goto(scenario.open.path);

    await expect(
      page.getByRole("heading", { name: "Homework 2: Use Cases" }),
    ).toBeVisible();
    await expect(page.getByText("20 points")).toBeVisible();
  });

  test("student cannot see another student's submission", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.dev);
    await page.goto(scenario.closed.path);

    await expect(page.getByText("Carter_Project1.pdf")).toHaveCount(0);
    await expect(page.getByText("Carter_Project1_v2.pdf")).toHaveCount(0);
    await expect(page.getByText("82 / 100")).toHaveCount(0);
  });

  test("student cannot submit without selecting a file", async ({
    scenario,
    pageAs,
  }) => {
    const page = await pageAs(scenario.students.dev);
    await page.goto(scenario.open.path);

    await expect(
      page.getByRole("button", { name: "Submit assignment" }),
    ).toBeDisabled();
  });
});
