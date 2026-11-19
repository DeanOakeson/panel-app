import type { Locator, Page } from "@playwright/test";
import { test, expect, signIn } from "./support/fixtures";
import { api, dateFromToday, type Person } from "./support/scenario";

// PANEL-104 spike, paths P3 (create, validate, lock) and P4 (edit, delete).

/** Returns "Nov 20" for "2026-11-20", the date part of the assignment card's Closes line. */
function shortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(
    new Date(`${isoDate}T12:00:00Z`)
  );
}

/** The professor's card for one assignment on the course's Assignments page. */
function assignmentCard(page: Page, name: string): Locator {
  return page.locator("li").filter({ has: page.getByRole("link", { name, exact: true }) });
}

/** Opens the Create assignment form on the Assignments page. */
async function openCreateForm(page: Page, assignmentsPath: string) {
  await page.goto(assignmentsPath);
  await page.getByRole("button", { name: "+ Create assignment" }).click();
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Create assignment" }) });
  await expect(form).toBeVisible();
  return form;
}

/** Sends a request as someone and returns only the status, for permission checks. */
async function statusOf(page: Page, method: string, route: string, person: Person, body?: unknown) {
  return page.evaluate(
    async ({ method, route, token, body }) => {
      const response = await fetch(route, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return response.status;
    },
    { method, route, token: person.token, body }
  );
}

test.describe("P3: Professor creates an assignment", () => {
  test("creates an assignment through the form, and students see it", async ({ page, scenario, pageAs }) => {
    const dueDate = dateFromToday(10);
    const name = "Project 2: Design Document";

    await signIn(page, scenario.professor);
    const form = await openCreateForm(page, scenario.course.assignmentsPath);

    await form.getByLabel("Assignment name").fill(name);
    await form.getByLabel("Description (optional)").fill("Describe the architecture.\nInclude a class diagram.");
    await form.getByLabel("Points possible").fill("50");
    await form.getByLabel("Due date (optional)").fill(dueDate);
    await form.getByRole("button", { name: "Create assignment", exact: true }).click();

    // The form closes and the list reloads with the new card
    await expect(form).toBeHidden();
    const card = assignmentCard(page, name);
    await expect(card).toContainText(`50 pts · Closes ${shortDate(dueDate)}, 11:59 PM MT`);
    await expect(card).toContainText("Include a class diagram.");
    await expect(card.getByText("Locked", { exact: true })).toHaveCount(0);
    await expect(card).toContainText("0/4 submitted");

    // A student sees it in the list and can open its instructions
    const ava = await pageAs(scenario.students.ava);
    await ava.goto(scenario.course.assignmentsPath);
    const studentRow = ava.locator("li").filter({ has: ava.getByRole("link", { name, exact: true }) });
    await expect(studentRow).toContainText("50 pts");
    await expect(studentRow).toContainText("Not graded");

    await studentRow.getByRole("link", { name }).click();
    await expect(ava.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(ava.getByText("Describe the architecture.")).toBeVisible();
    await expect(ava.getByText("Your professor has closed submissions.")).toHaveCount(0);
  });

  test("rejects a blank name and a late deadline that is not after the due date", async ({ page, scenario }) => {
    const dueDate = dateFromToday(10);

    await signIn(page, scenario.professor);
    const form = await openCreateForm(page, scenario.course.assignmentsPath);
    const create = form.getByRole("button", { name: "Create assignment", exact: true });

    // Spaces get past the browser's required check, so the form's own check answers
    await form.getByLabel("Assignment name").fill("   ");
    await form.getByLabel("Points possible").fill("10");
    await create.click();
    await expect(form.getByText("Assignment name is required.")).toBeVisible();

    // Zero points is stopped by the browser before the form submits
    await form.getByLabel("Assignment name").fill("Quiz 1");
    await form.getByLabel("Points possible").fill("0");
    await create.click();
    expect(await form.getByLabel("Points possible").evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(
      false
    );

    // The late deadline can't be picked until there is a due date
    await form.getByLabel("Points possible").fill("10");
    await expect(form.getByLabel("Late submission deadline (optional)")).toBeDisabled();

    // The same day as the due date passes the input's min, so the form's own check answers
    await form.getByLabel("Due date (optional)").fill(dueDate);
    await form.getByLabel("Late submission deadline (optional)").fill(dueDate);
    await create.click();
    await expect(form.getByText("The late submission deadline must be after the due date.")).toBeVisible();

    // Nothing was created: the course still has only its two seeded assignments
    const { assignments } = await api<{ assignments: unknown[] }>(
      "GET",
      `/api/classes/${scenario.course.id}/assignments`,
      scenario.professor.token
    );
    expect(assignments).toHaveLength(2);
  });

  test("locks submissions immediately when asked, and a student can't submit", async ({ page, scenario, pageAs }) => {
    const name = "Quiz 1: Agile Basics";

    await signIn(page, scenario.professor);
    const form = await openCreateForm(page, scenario.course.assignmentsPath);
    await form.getByLabel("Assignment name").fill(name);
    await form.getByLabel("Points possible").fill("10");
    await form.getByLabel("Due date (optional)").fill(dateFromToday(5));
    await form.getByLabel("Lock submissions immediately").check();
    await form.getByRole("button", { name: "Create assignment", exact: true }).click();

    const card = assignmentCard(page, name);
    await expect(card.getByText("Locked", { exact: true })).toBeVisible();

    const ava = await pageAs(scenario.students.ava);
    await ava.goto(scenario.course.assignmentsPath);
    await ava.getByRole("link", { name, exact: true }).click();
    await expect(ava.getByText("Your professor has closed submissions.")).toBeVisible();
  });
});

test.describe("P4: Professor edits and deletes an assignment", () => {
  test("edits the name, points and due date, and students see the change", async ({ page, scenario, pageAs }) => {
    const newName = "Homework 2: Use Case Diagrams";
    const newDue = dateFromToday(10);

    await signIn(page, scenario.professor);
    await page.goto(scenario.course.assignmentsPath);

    // Cancel leaves the assignment as it was
    let card = assignmentCard(page, scenario.open.name);
    await card.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Assignment name").fill("Should not be saved");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(card).toContainText(`${scenario.open.points} pts`);

    // The edit form opens with the saved values
    await card.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Assignment name")).toHaveValue(scenario.open.name);
    await expect(page.getByLabel("Points possible")).toHaveValue(String(scenario.open.points));

    await page.getByLabel("Assignment name").fill(newName);
    await page.getByLabel("Points possible").fill("25");
    await page.getByLabel("Due date (optional)").fill(newDue);
    await page.getByRole("button", { name: "Save changes" }).click();

    card = assignmentCard(page, newName);
    await expect(card).toContainText(`25 pts · Closes ${shortDate(newDue)}, 11:59 PM MT`);
    await expect(assignmentCard(page, scenario.open.name)).toHaveCount(0);

    // Ava's existing submission stays with the renamed assignment
    await expect(card).toContainText("1/4 submitted");

    const ava = await pageAs(scenario.students.ava);
    await ava.goto(scenario.course.assignmentsPath);
    await expect(ava.getByRole("link", { name: newName, exact: true })).toBeVisible();
    await expect(ava.getByRole("link", { name: scenario.open.name, exact: true })).toHaveCount(0);
  });

  test("locks and unlocks an existing assignment", async ({ page, scenario, pageAs }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.course.assignmentsPath);
    const card = assignmentCard(page, scenario.open.name);

    await card.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Lock submissions").check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(card.getByText("Locked", { exact: true })).toBeVisible();

    const ben = await pageAs(scenario.students.ben);
    await ben.goto(scenario.open.path);
    await expect(ben.getByText("Your professor has closed submissions.")).toBeVisible();

    await card.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Lock submissions").uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(card.getByText("Locked", { exact: true })).toHaveCount(0);

    await ben.reload();
    await expect(ben.getByText("Your professor has closed submissions.")).toHaveCount(0);
  });

  test("deletes an assignment after confirming, with its submission files", async ({ page, scenario, pageAs }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.course.assignmentsPath);
    const card = assignmentCard(page, scenario.open.name);

    // Cancel at the confirmation keeps it
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(card).toContainText(`Delete "${scenario.open.name}"? This can't be undone.`);
    await card.getByRole("button", { name: "Cancel" }).click();
    await expect(card.getByRole("button", { name: "Delete" })).toBeVisible();

    await card.getByRole("button", { name: "Delete" }).click();
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "DELETE" && r.url().endsWith(`/assignments/${scenario.open.id}`)
      ),
      card.getByRole("button", { name: "Yes, delete" }).click(),
    ]);
    expect(response.status()).toBe(200);
    // Ava's one submitted file is removed from storage too
    expect(await response.json()).toMatchObject({ deleted: true, removedSubmissionFiles: 1 });

    await expect(assignmentCard(page, scenario.open.name)).toHaveCount(0);
    await expect(assignmentCard(page, scenario.closed.name)).toBeVisible();

    const ava = await pageAs(scenario.students.ava);
    await ava.goto(scenario.course.assignmentsPath);
    await expect(ava.getByRole("link", { name: scenario.closed.name, exact: true })).toBeVisible();
    await expect(ava.getByRole("link", { name: scenario.open.name, exact: true })).toHaveCount(0);
  });

  test("a student has no Edit or Delete, and the API refuses their changes", async ({ scenario, pageAs }) => {
    const ava = await pageAs(scenario.students.ava);
    await ava.goto(scenario.course.assignmentsPath);
    await expect(ava.getByRole("link", { name: scenario.open.name, exact: true })).toBeVisible();
    await expect(ava.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(ava.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(ava.getByRole("button", { name: "+ Create assignment" })).toHaveCount(0);

    const route = `/api/classes/${scenario.course.id}/assignments`;
    const student = scenario.students.ava;
    expect(await statusOf(ava, "POST", route, student, { name: "Sneaky", points: 10 })).toBe(403);
    expect(await statusOf(ava, "PATCH", `${route}/${scenario.open.id}`, student, { points: 1 })).toBe(403);
    expect(await statusOf(ava, "DELETE", `${route}/${scenario.open.id}`, student)).toBe(403);
  });
});
