// PANEL-90: a professor with two courses must always see which course they
// are in — the course code and name stay in the sidebar on every page
// inside the course, and the course home names the course too.
import { test, expect, signIn } from "./support/fixtures";

const courseHome = (courseId: string) => `/classes/${courseId}`;

/** The course sidebar only — the dark account rail is an aside too. */
const courseSidebar = (page: import("@playwright/test").Page) =>
  page.locator("aside", { hasText: "Course Navigation" });

test.describe("Course identity inside a course", () => {
  test("the professor sees the course code and name on every course page", async ({
    page,
    scenario,
  }) => {
    await signIn(page, scenario.professor);
    const sidebar = courseSidebar(page);

    await page.goto(courseHome(scenario.course.id));
    await expect(sidebar).toContainText("CS 3450");
    await expect(sidebar).toContainText("Software Engineering");
    await expect(
      page.getByText("Welcome to CS 3450 Software Engineering.")
    ).toBeVisible();

    await page.goto(scenario.course.assignmentsPath);
    await expect(sidebar).toContainText("CS 3450");
    await expect(sidebar).toContainText("Software Engineering");

    await page.goto(scenario.closed.path);
    await expect(sidebar).toContainText("CS 3450");
    await expect(sidebar).toContainText("Software Engineering");
  });

  test("an enrolled student sees the same identity", async ({ page, scenario }) => {
    await signIn(page, scenario.students.ava);

    await page.goto(courseHome(scenario.course.id));
    await expect(courseSidebar(page)).toContainText("CS 3450");
    await expect(courseSidebar(page)).toContainText("Software Engineering");
  });
});
