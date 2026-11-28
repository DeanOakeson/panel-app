import type { Locator, Page } from "@playwright/test";
import { test, expect, signIn } from "./support/fixtures";
import { studentCard } from "./support/grading";
import { api, dateFromToday, submit, type Scenario } from "./support/scenario";

// PANEL-115: a professor can excuse lateness, and a resubmission after a
// description fix carries no late penalty.

/** Makes the open homework past due with a late window open, and has Ben turn it in late. */
async function benSubmitsLate(scenario: Scenario) {
  const { professor, course, open, students } = scenario;
  await api("PATCH", `/api/classes/${course.id}/assignments/${open.id}`, professor.token, {
    dueDate: dateFromToday(-2),
    lateUntil: dateFromToday(5),
  });
  await submit(students.ben, course.id, open.id, "Carter_Homework2.pdf");
}

/** The badge that names a card's lateness. */
function lateBadge(card: Locator, label: string) {
  return card.getByText(label, { exact: true });
}

/** The professor's card for one assignment on the course's Assignments page. */
function assignmentCard(page: Page, name: string): Locator {
  return page.locator("li").filter({ has: page.getByRole("link", { name, exact: true }) });
}

test.describe("Excused lateness and instruction changes", () => {
  test("the professor excuses late work with a reason, and can remove the excuse", async ({ page, scenario }) => {
    await benSubmitsLate(scenario);
    await signIn(page, scenario.professor);
    await page.goto(scenario.open.path);

    const ben = studentCard(page, "Ben Carter");
    await expect(lateBadge(ben, "Late")).toBeVisible();
    // On-time work has nothing to excuse
    await expect(studentCard(page, "Ava Martin").getByRole("button", { name: "Excuse lateness" })).toHaveCount(0);

    await ben.getByRole("button", { name: "Excuse lateness" }).click();
    // A reason is required
    await ben.getByRole("button", { name: "Save excuse" }).click();
    await expect(ben.getByText("Give a reason for excusing the lateness.")).toBeVisible();

    await ben.getByLabel("Reason for excusing").fill("Doctor's note for Nov 26");
    await ben.getByRole("button", { name: "Save excuse" }).click();

    await expect(lateBadge(ben, "Late (excused)")).toBeVisible();
    await expect(ben.getByText(/^Lateness excused .*: Doctor's note for Nov 26$/)).toBeVisible();

    // It is saved, not only shown
    await page.reload();
    const reloaded = studentCard(page, "Ben Carter");
    await expect(lateBadge(reloaded, "Late (excused)")).toBeVisible();

    await reloaded.getByRole("button", { name: "Remove excuse" }).click();
    await expect(lateBadge(reloaded, "Late")).toBeVisible();
    await expect(reloaded.getByText(/^Lateness excused/)).toHaveCount(0);
    await page.reload();
    await expect(lateBadge(studentCard(page, "Ben Carter"), "Late")).toBeVisible();
  });

  test("a resubmission after the professor fixes the description has no late penalty", async ({
    page,
    scenario,
    pageAs,
  }) => {
    await benSubmitsLate(scenario);
    await signIn(page, scenario.professor);

    // The professor fixes the instructions from the Assignments page
    await page.goto(scenario.course.assignmentsPath);
    const card = assignmentCard(page, scenario.open.name);
    await expect(card.getByText(/^Instructions updated/)).toHaveCount(0);
    await card.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Description (optional)").fill("Draw a use case diagram. (Fixed: three actors, not two.)");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(card.getByText(/^Instructions updated/)).toBeVisible();

    // A deadline change alone isn't an instruction change
    const other = assignmentCard(page, scenario.closed.name);
    await other.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Due date (optional)").fill(dateFromToday(-3));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(other.getByText(/^Instructions updated/)).toHaveCount(0);

    // The student sees the instructions were updated, and resubmits
    const benPage = await pageAs(scenario.students.ben);
    await benPage.goto(scenario.open.path);
    await expect(benPage.getByText(/^Instructions updated/)).toBeVisible();
    await submit(scenario.students.ben, scenario.course.id, scenario.open.id, "Carter_Homework2_fixed.pdf");

    await page.goto(scenario.open.path);
    const ben = studentCard(page, "Ben Carter");
    await expect(lateBadge(ben, "Late (updated instructions)")).toBeVisible();
    await expect(ben.getByText("This version answered updated instructions, so no late penalty applies.")).toBeVisible();
  });
});
