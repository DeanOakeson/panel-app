import type { Locator, Page } from "@playwright/test";
import { test, expect, signIn } from "./support/fixtures";
import { APP_URL } from "./support/env";
import { makePdf } from "./support/pdf";
import { dateFromToday } from "./support/scenario";

// PANEL-113: professors can turn resubmission off or limit attempts.

const OFF_MESSAGE =
  "Your professor doesn't allow resubmissions for this assignment, and you have already submitted it.";

/** The professor's card for one assignment on the course's Assignments page. */
function assignmentCard(page: Page, name: string): Locator {
  return page.locator("li").filter({ has: page.getByRole("link", { name, exact: true }) });
}

/** Uploads a one-page PDF through the student's submission form. */
async function submitThroughForm(page: Page, fileName: string) {
  await page.locator("#assignment-file").setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from(makePdf(fileName)),
  });
  await page.getByRole("button", { name: /^(Submit assignment|Replace submission)$/ }).click();
  await expect(page.getByText("Assignment submitted successfully!")).toBeVisible();
}

test.describe("Resubmission settings", () => {
  test("with resubmission off, a student submits once and can't submit again", async ({
    page,
    scenario,
    pageAs,
  }) => {
    const name = "Reflection 1";

    await signIn(page, scenario.professor);
    await page.goto(scenario.course.assignmentsPath);
    await page.getByRole("button", { name: "+ Create assignment" }).click();
    const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Create assignment" }) });
    await form.getByLabel("Assignment name").fill(name);
    await form.getByLabel("Points possible").fill("10");
    await form.getByLabel("Due date (optional)").fill(dateFromToday(7));
    await expect(form.getByLabel("Allow resubmission")).toBeChecked();
    await form.getByLabel("Allow resubmission").uncheck();
    await expect(form.getByLabel("Maximum attempts (optional)")).toBeDisabled();
    await form.getByRole("button", { name: "Create assignment", exact: true }).click();

    await expect(assignmentCard(page, name).getByText("One submission only")).toBeVisible();

    const dev = await pageAs(scenario.students.dev);
    await dev.goto(scenario.course.assignmentsPath);
    await dev.getByRole("link", { name, exact: true }).click();
    await expect(dev.getByText("You can submit this assignment once.")).toBeVisible();

    await submitThroughForm(dev, "Patel_Reflection1.pdf");

    await expect(dev.getByText(OFF_MESSAGE)).toBeVisible();
    await expect(dev.getByRole("button", { name: "Replace submission" })).toBeDisabled();

    // The server refuses it too, with the same message
    const assignmentPath = new URL(dev.url()).pathname;
    const response = await dev.request.fetch(`${APP_URL}/api${assignmentPath}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${scenario.students.dev.token}` },
      multipart: {
        file: { name: "again.pdf", mimeType: "application/pdf", buffer: Buffer.from(makePdf("again")) },
      },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toBe(OFF_MESSAGE);
  });

  test("an attempt limit set on an open assignment counts the submission already made", async ({
    page,
    scenario,
    pageAs,
  }) => {
    // Ava submitted the open assignment once in the seeded scenario
    await signIn(page, scenario.professor);
    await page.goto(scenario.course.assignmentsPath);
    const card = assignmentCard(page, scenario.open.name);
    await card.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Allow resubmission")).toBeChecked();
    await page.getByLabel("Maximum attempts (optional)").fill("2");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(card.getByText("Up to 2 attempts")).toBeVisible();

    const ava = await pageAs(scenario.students.ava);
    await ava.goto(scenario.open.path);
    await expect(ava.getByText("1 of 2 attempts used.")).toBeVisible();

    await submitThroughForm(ava, "Martin_Homework2_v2.pdf");

    await expect(ava.getByText("You have used all 2 attempts for this assignment.")).toBeVisible();
    await expect(ava.getByRole("button", { name: "Replace submission" })).toBeDisabled();

    // Raising the limit lets her submit again
    await card.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Maximum attempts (optional)").fill("3");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(card.getByText("Up to 3 attempts")).toBeVisible();

    await ava.reload();
    await expect(ava.getByText("2 of 3 attempts used.")).toBeVisible();
    await expect(ava.getByRole("button", { name: "Replace submission" })).toBeDisabled(); // no file chosen yet
    await submitThroughForm(ava, "Martin_Homework2_v3.pdf");
    await expect(ava.getByText("You have used all 3 attempts for this assignment.")).toBeVisible();
  });

  test("existing assignments keep allowing resubmission", async ({ scenario, pageAs }) => {
    const ava = await pageAs(scenario.students.ava);
    await ava.goto(scenario.open.path);

    await expect(ava.getByText(/attempts used/)).toHaveCount(0);
    await submitThroughForm(ava, "Martin_Homework2_v2.pdf");
    await submitThroughForm(ava, "Martin_Homework2_v3.pdf");
    await expect(ava.getByText(/You have used all/)).toHaveCount(0);
  });
});
