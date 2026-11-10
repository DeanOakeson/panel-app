import { test, expect, signIn } from "./support/fixtures";
import type { Page } from "@playwright/test";

/** Returns the course navigation's toggle, whichever way it points. */
function toggle(page: Page) {
  return page.getByRole("button", { name: /^(Show|Hide) course navigation$/ });
}

test.describe("Course navigation", () => {
  test("starts expanded on the course pages and collapsed on Grades in a wide window", async ({ page, scenario }) => {
    const homePath = `/classes/${scenario.course.id}`;

    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(homePath);
    await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");

    await page.goto(scenario.course.assignmentsPath);
    await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");

    // A move within the app applies each page's own default
    await page.getByRole("link", { name: "Grades", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Grades", level: 1 })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

    await page.getByRole("table").getByRole("link", { name: "Project 1: Requirements" }).click();
    await expect(page).toHaveURL(/\/assignments\/[^/]+$/);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");

    await page.goto(homePath);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("keeps an explicit choice on every page, Grades included", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Expanded on Grades stays expanded across a reload and on the other pages
    await page.goto(`/classes/${scenario.course.id}/grades`);
    await expect(page.getByRole("heading", { name: "Grades", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Show course navigation" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Hide course navigation" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    // Collapsed stays collapsed across a reload and another course page
    await page.goto(scenario.course.assignmentsPath);
    await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
    await page.getByRole("button", { name: "Hide course navigation" }).click();
    await expect(page.getByRole("link", { name: "Grades", exact: true })).toBeHidden();

    await page.reload();
    await expect(page.getByRole("button", { name: "Show course navigation" })).toBeVisible();
    await page.goto(`/classes/${scenario.course.id}`);
    await expect(page.getByRole("button", { name: "Show course navigation" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    await page.getByRole("button", { name: "Show course navigation" }).click();
    await page.getByRole("link", { name: "Grades", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Grades", level: 1 })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("starts collapsed in a narrow window until someone chooses", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(scenario.course.assignmentsPath);
    await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");

    // An explicit choice outlasts the window's width and a reload
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.getByRole("button", { name: "Show course navigation" }).click();
    await page.reload();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  });
});
