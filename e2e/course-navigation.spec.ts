import { test, expect, signIn } from "./support/fixtures";

test.describe("Course navigation", () => {
  test("collapses, stays collapsed across a reload and another course page, and expands again", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}/grades`);

    const hide = page.getByRole("button", { name: "Hide course navigation" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await hide.click();

    const show = page.getByRole("button", { name: "Show course navigation" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: "Assignments", exact: true })).toBeHidden();

    await page.reload();
    await expect(page.getByRole("button", { name: "Show course navigation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Assignments", exact: true })).toBeHidden();

    await page.goto(scenario.course.assignmentsPath);
    await expect(page.getByRole("heading", { name: "Assignments" })).toBeVisible();
    await page.getByRole("button", { name: "Show course navigation" }).click();

    await page.getByRole("link", { name: "Grades", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Grades", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hide course navigation" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });
});
