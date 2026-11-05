import { test, expect, signIn } from "./support/fixtures";
import { addQuiz, detailsPanel, gradeCell, gradesPath, unenroll } from "./support/gradebook";
import { saveGrade, studentCard } from "./support/grading";
import { createAssignment, dateFromToday } from "./support/scenario";
import type { Page } from "@playwright/test";

const PROJECT = "Project 1: Requirements";
const HOMEWORK = "Homework 2: Use Cases";
const QUIZ = "Quiz 1";

/** Returns a column's filter button, whose name starts "Filter students by". */
function filterButton(page: Page, assignment: string) {
  return page.getByRole("button", { name: new RegExp(`^Filter students by ${assignment}`) });
}

/** Expects the grid to show exactly these students' rows, in order. */
async function expectRows(page: Page, names: string[]) {
  await expect(page.getByRole("rowheader")).toHaveText(names);
}

/** Returns the toolbar's line that says which students a filter shows. */
function filterStatus(page: Page) {
  return page.getByText(/^Showing \d+ students? · /);
}

/** Returns how full a column's progress bar is, from 0 to 1. */
function barFill(page: Page, assignment: string) {
  return filterButton(page, assignment).evaluate((button) => {
    const track = button.querySelector("span")!;
    const fill = track.querySelector("span")!;

    return Math.round((fill.getBoundingClientRect().width / track.getBoundingClientRect().width) * 100) / 100;
  });
}

test.describe("Gradebook filter", () => {
  test("shows each column's graded work out of the work turned in", async ({ page, scenario }) => {
    await addQuiz(scenario);
    const reading = await createAssignment(scenario.professor, scenario.course.id, "Reading Reflection", 5, dateFromToday(30));
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    // Ben's resubmission and Ava's new work wait, and Dev's missing work is not turned in
    await expect(filterButton(page, PROJECT)).toHaveText("1 of 3 graded");
    await expect(filterButton(page, PROJECT)).toHaveAccessibleName(
      `Filter students by ${PROJECT}, 1 of 3 graded, 2 to grade`
    );
    expect(await barFill(page, PROJECT)).toBe(0.33);

    // Dev's missing-work zero and Ben's missing work count in neither number
    await expect(filterButton(page, QUIZ)).toHaveText("2 of 2 graded");
    await expect(filterButton(page, QUIZ)).toHaveAccessibleName(`Filter students by ${QUIZ}, 2 of 2 graded, all graded`);
    expect(await barFill(page, QUIZ)).toBe(1);

    await expect(filterButton(page, reading.name)).toHaveText("None turned in");
    await expect(filterButton(page, reading.name)).toHaveAccessibleName(
      `Filter students by ${reading.name}, none turned in`
    );
    expect(await barFill(page, reading.name)).toBe(0);

    // The header shows the due date and points under the name
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${QUIZ}`) })).toContainText(/Closed \w{3} \d{1,2} · 10 pts/);
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${reading.name}`) })).toContainText(
      /Due \w{3} \d{1,2} · 5 pts/
    );
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${QUIZ}`) })).toHaveAccessibleName(/Out of 10\./);

    // A student who left still counts for the work they turned in
    await unenroll(scenario, scenario.students.ben);
    await page.reload();
    await expect(filterButton(page, PROJECT)).toHaveText("1 of 3 graded");
  });


  test("shows who has not turned in an open assignment, and shows everyone again", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));
    await expectRows(page, ["Ava Martin", "Ben Carter", "Cara Diaz", "Dev Patel"]);

    await filterButton(page, HOMEWORK).click();
    const menu = page.getByRole("menu", { name: `Filter students by ${HOMEWORK}` });
    await expect(menu.getByRole("menuitemradio", { name: "To grade, 1 student" })).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: "Graded, 0 students" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await expect(menu.getByRole("menuitemradio", { name: "All students" })).toHaveAttribute("aria-checked", "true");

    // A click outside closes the menu without a change
    await page.getByRole("heading", { name: "Grades", level: 1 }).click();
    await expect(menu).toBeHidden();

    await filterButton(page, HOMEWORK).click();
    await menu.getByRole("menuitemradio", { name: "Not turned in, 3 students" }).click();
    await expect(menu).toBeHidden();

    await expectRows(page, ["Ben Carter", "Cara Diaz", "Dev Patel"]);
    await expect(filterStatus(page)).toHaveText(`Showing 3 students · Not turned in · ${HOMEWORK}`);
    await expect(page.getByRole("status").filter({ hasText: "Showing" })).toHaveText(
      `Showing 3 students: Not turned in on ${HOMEWORK}.`
    );
    await expect(filterButton(page, HOMEWORK)).toHaveAccessibleName(
      `Filter students by ${HOMEWORK}, 0 of 1 graded, 1 to grade, showing not turned in`
    );
    await expect(filterButton(page, HOMEWORK)).toBeFocused();

    // The filter outlasts a reload in the same tab
    await page.reload();
    await expectRows(page, ["Ben Carter", "Cara Diaz", "Dev Patel"]);

    await page.getByRole("button", { name: "Show all students" }).click();
    await expectRows(page, ["Ava Martin", "Ben Carter", "Cara Diaz", "Dev Patel"]);
    await expect(filterStatus(page)).toHaveCount(0);
    await expect(filterButton(page, HOMEWORK)).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Showing" })).toHaveText("Showing all students.");
  });

  test("keeps a To grade filter through grading, and offers to clear it when no one is left", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    await filterButton(page, HOMEWORK).click();
    await page.getByRole("menuitemradio", { name: /^To grade/ }).click();
    await expectRows(page, ["Ava Martin"]);

    await gradeCell(page, "Ava Martin", HOMEWORK).click();
    await detailsPanel(page).getByRole("link", { name: "Grade submission" }).click();
    const card = studentCard(page, "Ava Martin");
    await expect(card).toBeFocused();
    await saveGrade(card, "18", "Clear use cases.");
    await expect(card).toContainText("18 / 20");
    await page.getByRole("link", { name: "← Back to grades" }).click();

    await expect(filterStatus(page)).toHaveText(`Showing 0 students · To grade · ${HOMEWORK}`);
    await expect(page.getByRole("rowheader")).toHaveCount(0);
    await expect(page.getByRole("table").getByText("No students match")).toBeVisible();

    await page.getByRole("table").getByRole("button", { name: "Show all students" }).click();
    await expectRows(page, ["Ava Martin", "Ben Carter", "Cara Diaz", "Dev Patel"]);
    await expect(gradeCell(page, "Ava Martin", HOMEWORK)).toHaveText("18/20");
  });

  test("filters by keyboard alone", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    await page.getByRole("button", { name: "Key", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(filterButton(page, PROJECT)).toBeFocused();

    // Enter opens the menu on the chosen item, and the arrow keys wrap around it
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: `Filter students by ${PROJECT}` });
    await expect(menu.getByRole("menuitemradio", { name: "All students" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Open assignment page" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name: /^To grade/ })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(menu).toBeHidden();
    await expect(filterButton(page, PROJECT)).toBeFocused();
    await expectRows(page, ["Ava Martin", "Ben Carter"]);

    // Escape closes the menu onto its button, and plain Down still moves into the grid
    await page.keyboard.press("Alt+ArrowDown");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(filterButton(page, PROJECT)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(gradeCell(page, "Ben Carter", PROJECT)).toBeFocused();

    // Space opens the menu, and its last item opens the assignment page
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Open assignment page" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${scenario.closed.path}$`));
  });
});
