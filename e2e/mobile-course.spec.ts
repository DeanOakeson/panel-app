import { expect, type Locator, type Page } from "@playwright/test";
import { signIn, test } from "./support/fixtures";

const PHONE = { width: 390, height: 844 };

/** Left edge of an element; a negative value proves a drawer is off-canvas. */
function leftEdge(locator: Locator) {
  return async () => (await locator.boundingBox())?.x ?? Number.NaN;
}

const courseSidebar = (page: Page) =>
  page.locator("aside", { hasText: "Course Navigation" });

const railSidebar = (page: Page) => page.locator("aside", { hasText: "Logout" });

test.describe("Course pages on a phone", () => {
  test("keeps both sidebars off the page until they are opened", async ({ page, scenario }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}`);

    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();

    // Neither sidebar may eat the phone's width while closed.
    await expect.poll(leftEdge(courseSidebar(page))).toBeLessThan(0);
    await expect.poll(leftEdge(railSidebar(page))).toBeLessThan(0);

    // The course content spans the viewport instead.
    const content = await page.locator("main").last().boundingBox();
    expect(content?.width).toBeGreaterThanOrEqual(370);

    await expect(
      page.getByRole("button", { name: "Open course navigation" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open main navigation" })
    ).toBeVisible();
  });

  test("opens the course drawer, navigates, and puts it away again", async ({ page, scenario }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}`);

    await page.getByRole("button", { name: "Open course navigation" }).click();
    await expect.poll(leftEdge(courseSidebar(page))).toBeGreaterThanOrEqual(0);

    const assignments = page.getByRole("link", { name: "Assignments", exact: true });
    await expect(assignments).toBeVisible();
    await assignments.click();

    await page.waitForURL((url) => url.pathname === scenario.course.assignmentsPath);
    // The drawer must not stay on top of the new page.
    await expect.poll(leftEdge(courseSidebar(page))).toBeLessThan(0);
  });

  test("opens the main drawer and closes it from the backdrop", async ({ page, scenario }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}`);

    await page.getByRole("button", { name: "Open main navigation" }).click();
    await expect.poll(leftEdge(railSidebar(page))).toBeGreaterThanOrEqual(0);

    await page.getByRole("button", { name: "Close main navigation" }).click();
    await expect.poll(leftEdge(railSidebar(page))).toBeLessThan(0);
  });

  test("still shows both sidebars inline on a desktop width", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}`);

    // 96px icon rail, then the 224px course sidebar, then the content.
    await expect.poll(leftEdge(railSidebar(page))).toBeLessThanOrEqual(0);
    await expect.poll(leftEdge(courseSidebar(page))).toBe(96);

    const content = await page.locator("main").last().boundingBox();
    expect(content?.x).toBe(320);
    expect(content?.width).toBe(1280 - 320);

    await expect(
      page.getByRole("button", { name: "Open course navigation" })
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Open main navigation" })
    ).toBeHidden();
  });
});
