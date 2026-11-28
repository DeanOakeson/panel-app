import { test, expect, signIn } from "./support/fixtures";
import { expectStatus, ownSubmission, studentCard, submissionList } from "./support/grading";
import { makePdf } from "./support/pdf";
import { api, dateFromToday } from "./support/scenario";

const REASON = "Hospital stay, note from the clinic on file.";

/** Formats a YYYY-MM-DD date as the student sees its cutoff, like "Dec 1, 11:59 PM MT". */
function cutoff(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const monthName = new Date(Date.UTC(year, month - 1, 15)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });

  return `${monthName} ${day}, 11:59 PM MT`;
}

test.describe("Professor grants one student a submission exception", () => {
  test("reopens the closed assignment for one student only, then removes it", async ({
    page,
    scenario,
    pageAs,
  }) => {
    const { closed, professor, students } = scenario;

    await signIn(page, professor);
    await page.goto(closed.path);

    const dev = studentCard(page, "Dev Patel");
    await expectStatus(dev, "Missing");
    await dev.getByRole("button", { name: "Grant exception" }).click();
    await dev.getByLabel("Due date").fill(dateFromToday(3));
    await dev.getByLabel("Allow resubmission").check();
    await dev.getByLabel("Reason (optional)").fill(REASON);
    await dev.getByRole("button", { name: "Save exception" }).click();

    await expect(submissionList(page).getByRole("status")).toHaveText("Exception granted for Dev Patel.");
    await expect(dev).toContainText(REASON);
    await expect(dev).toContainText("Resubmission allowed");
    await expect(dev.getByText(/^Due [A-Z][a-z]{2} \d{1,2}, 11:59 PM MT$/)).toBeVisible();
    await expect(dev.getByRole("button", { name: "Edit exception" })).toBeVisible();
    await expect(studentCard(page, "Cara Diaz").getByRole("button", { name: "Grant exception" })).toBeVisible();

    const devPage = await pageAs(students.dev);
    await devPage.goto(closed.path);
    await expect(
      devPage.getByText(/^You have an extension\. Your due date is [A-Z][a-z]{2} \d{1,2}, 11:59 PM MT\.$/)
    ).toBeVisible();
    await expect(devPage.getByText(REASON)).toHaveCount(0);
    await devPage.locator("#assignment-file").setInputFiles({
      name: "Patel_Project1.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Dev Patel: Project 1"),
    });
    await devPage.getByRole("button", { name: "Submit assignment" }).click();
    await expect(devPage.getByText("Assignment submitted successfully!")).toBeVisible();
    const own = ownSubmission(devPage);
    await expect(own).toContainText("Patel_Project1.pdf");
    await expect(own.getByText("Late", { exact: true })).toHaveCount(0);
    await expect(devPage.getByRole("button", { name: "Replace submission" })).toBeVisible();

    // Ava has no exception, so the assignment stays closed for her
    const avaPage = await pageAs(students.ava);
    await avaPage.goto(closed.path);
    await expect(avaPage.getByText(/Submissions closed/)).toBeVisible();
    await expect(avaPage.getByText(/You have an extension/)).toHaveCount(0);
    await expect(avaPage.getByRole("button", { name: "Replace submission" })).toHaveCount(0);

    await page.reload();
    const submitted = studentCard(page, "Dev Patel");
    await expectStatus(submitted, "Needs grading");
    await expect(submitted).toContainText("Patel_Project1.pdf");
    await expect(submitted.getByText("Late", { exact: true })).toHaveCount(0);
    await expect(submitted).toContainText(REASON);

    await submitted.getByRole("button", { name: "Remove exception" }).click();
    await expect(submissionList(page).getByRole("status")).toHaveText("Exception removed for Dev Patel.");
    await expect(submitted).not.toContainText(REASON);
    await expect(submitted.getByRole("button", { name: "Grant exception" })).toBeVisible();

    // The submission stays, and the assignment is closed for Dev again
    await devPage.reload();
    await expect(ownSubmission(devPage)).toContainText("Patel_Project1.pdf");
    await expect(devPage.getByText(/Submissions closed/)).toBeVisible();
    await expect(devPage.getByRole("button", { name: "Replace submission" })).toHaveCount(0);

    await page.reload();
    await expect(studentCard(page, "Dev Patel")).toContainText("Patel_Project1.pdf");
    await expect(studentCard(page, "Dev Patel")).not.toContainText(REASON);
  });

  test("lets a student replace a submission on a locked assignment once resubmission is allowed", async ({
    page,
    scenario,
    pageAs,
  }) => {
    const { open, course, professor, students } = scenario;
    await api("PATCH", `/api/classes/${course.id}/assignments/${open.id}`, professor.token, { isLocked: true });

    await signIn(page, professor);
    await page.goto(open.path);

    const ava = studentCard(page, "Ava Martin");
    await ava.getByRole("button", { name: "Grant exception" }).click();
    await ava.getByLabel("Due date").fill(dateFromToday(5));
    await ava.getByRole("button", { name: "Save exception" }).click();
    await expect(ava).toContainText("Resubmission not allowed");

    // Ava has already submitted, so an exception without resubmission leaves her locked out
    const avaPage = await pageAs(students.ava);
    await avaPage.goto(open.path);
    await expect(avaPage.getByText("Your professor has closed submissions.")).toBeVisible();
    await expect(avaPage.getByRole("button", { name: "Replace submission" })).toBeDisabled();

    await ava.getByRole("button", { name: "Edit exception" }).click();
    await expect(ava.getByLabel("Due date")).toHaveValue(dateFromToday(5));
    await ava.getByLabel("Allow resubmission").check();
    await ava.getByRole("button", { name: "Save exception" }).click();
    await expect(submissionList(page).getByRole("status")).toHaveText("Exception updated for Ava Martin.");
    await expect(ava).toContainText("Resubmission allowed");

    await avaPage.reload();
    await expect(avaPage.getByText(/^You have an extension\. Your due date is /)).toBeVisible();
    await avaPage.locator("#assignment-file").setInputFiles({
      name: "Martin_Homework2_v2.pdf",
      mimeType: "application/pdf",
      buffer: makePdf("Ava Martin: Homework 2 version 2"),
    });
    await avaPage.getByRole("button", { name: "Replace submission" }).click();
    await expect(avaPage.getByText("Assignment submitted successfully!")).toBeVisible();
    await expect(ownSubmission(avaPage)).toContainText("Martin_Homework2_v2.pdf");

    // Cara has no exception and stays locked out
    const caraPage = await pageAs(students.cara);
    await caraPage.goto(open.path);
    await expect(caraPage.getByText("Your professor has closed submissions.")).toBeVisible();
    await expect(caraPage.getByRole("button", { name: "Submit assignment" })).toBeDisabled();
  });

  test("tells the student their own due date and how long late work is accepted", async ({
    page,
    scenario,
    pageAs,
  }) => {
    const { closed, professor, students } = scenario;
    const dueDate = dateFromToday(2);
    const lateUntil = dateFromToday(6);

    await signIn(page, professor);
    await page.goto(closed.path);
    const dev = studentCard(page, "Dev Patel");
    await dev.getByRole("button", { name: "Grant exception" }).click();
    await dev.getByLabel("Due date").fill(dueDate);
    await dev.getByLabel("Late until (optional)").fill(lateUntil);
    await dev.getByRole("button", { name: "Save exception" }).click();
    await expect(submissionList(page).getByRole("status")).toHaveText("Exception granted for Dev Patel.");

    const devPage = await pageAs(students.dev);
    await devPage.goto(closed.path);
    await expect(
      devPage.getByText(
        `You have an extension. Your due date is ${cutoff(dueDate)}. Late submissions are accepted until ${cutoff(lateUntil)}.`,
        { exact: true }
      )
    ).toBeVisible();
  });
});
