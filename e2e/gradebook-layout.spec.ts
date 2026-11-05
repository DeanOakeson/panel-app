import { test, expect, signIn } from "./support/fixtures";
import { addQuiz, gradeCell, gradesPath } from "./support/gradebook";
import { createAssignment, dateFromToday, type Scenario } from "./support/scenario";
import type { Page } from "@playwright/test";

// Classic scrollbars take room from the grid, as they do in a desktop browser
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

/** Gives the seeded course six assignments: the seeded two, Quiz 1 and three more. */
async function addSixAssignments(scenario: Scenario) {
  await addQuiz(scenario);

  for (const [name, points, days] of [
    ["Project 2: Architecture", 100, 20],
    ["Homework 3: Testing", 10, 25],
    ["Reading Reflection", 5, 30],
  ] as const) {
    await createAssignment(scenario.professor, scenario.course.id, name, points, dateFromToday(days));
  }
}

/** Returns how the column headers sit against the frozen student column and the visible area. */
function measureColumns(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector("table")!.parentElement!;
    const visibleRight = scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
    const frozenRight = document.querySelector("thead th")!.getBoundingClientRect().right;
    const headers = Array.from(document.querySelectorAll("thead th"))
      .slice(1)
      .map((header) => header.getBoundingClientRect());

    return {
      sideways: scroller.scrollWidth > scroller.clientWidth,
      whole: headers.filter((rect) => rect.left >= frozenRight - 1 && rect.right <= visibleRight + 1).length,
      underFrozen: headers.filter((rect) => rect.left < frozenRight - 1 && rect.right > frozenRight + 1).length,
    };
  });
}

test.describe("Gradebook layout", () => {
  test("fits six assignments without sideways scrolling at 1280 pixels", async ({ page, scenario }) => {
    await addSixAssignments(scenario);
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", "Reading Reflection")).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide course navigation" })).toBeVisible();

    expect(await measureColumns(page)).toEqual({ sideways: false, whole: 6, underFrozen: 0 });
  });

  test("shows the last columns whole at the right end", async ({ page, scenario }) => {
    await addSixAssignments(scenario);
    await signIn(page, scenario.professor);
    // Short enough that the grid also scrolls down, so it shows a vertical scrollbar
    await page.setViewportSize({ width: 1024, height: 480 });
    await page.goto(gradesPath(scenario));
    // Keep the course navigation open, the narrowest grid at this size
    await page.getByRole("button", { name: "Show course navigation" }).click();

    await gradeCell(page, "Ava Martin", "Project 1: Requirements").focus();
    await page.keyboard.press("End");
    await expect(gradeCell(page, "Ava Martin", "Reading Reflection")).toBeFocused();

    await expect.poll(() => measureColumns(page)).toMatchObject({ sideways: true, underFrozen: 0 });
    await page
      .getByRole("table")
      .locator("xpath=..")
      .evaluate((scroller) => scroller.scrollTo({ left: scroller.scrollWidth }));
    await expect.poll(() => measureColumns(page)).toMatchObject({ underFrozen: 0 });
    expect((await measureColumns(page)).whole).toBeGreaterThanOrEqual(2);
    expect(
      await page.getByRole("table").locator("xpath=..").evaluate((scroller) => (scroller as HTMLElement).offsetWidth - scroller.clientWidth)
    ).toBeGreaterThan(2);
  });

  test("collapses the course navigation by default in a narrow window until someone chooses", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(gradesPath(scenario));

    const show = page.getByRole("button", { name: "Show course navigation" });
    await expect(show).toHaveAttribute("aria-expanded", "false");

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("button", { name: "Hide course navigation" })).toBeVisible();

    // An explicit choice outlasts the window's width and a reload
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole("button", { name: "Show course navigation" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Hide course navigation" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    await page.goto(scenario.course.assignmentsPath);
    await expect(page.getByRole("link", { name: "Grades", exact: true })).toBeVisible();
  });
});
