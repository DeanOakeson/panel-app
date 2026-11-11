import { expect, type Locator, type Page } from "@playwright/test";
import { signIn, test } from "./support/fixtures";

/**
 * The widths a phone gets. The overlap was a constant of the two components'
 * Tailwind classes rather than a percentage, so it did not shrink at any of them.
 */
const PHONE_WIDTHS = [390, 320];

type Box = { x: number; y: number; width: number; height: number };

/**
 * How deep one box reaches into the other on each axis; a negative value is
 * clear of it. `x < 0` or `y < 0` on its own means the boxes do not intersect.
 */
function intersect(a: Box, b: Box) {
  return {
    x: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    y: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

const describe = (box: Box) => `${box.x}..${box.x + box.width}`;

/** Reads a box once the element has one, so a remount cannot yield a null read. */
function boxOf(locator: Locator) {
  return async () => {
    const box = await locator.boundingBox();

    if (!box) throw new Error("no bounding box yet");

    return box;
  };
}

/** The left edge of an element; a negative value proves it is off-canvas. */
function leftEdge(locator: Locator) {
  return async () => (await boxOf(locator)()).x;
}

/** The phone top bar's "Panel" wordmark, scoped to the bar and not to page copy. */
function wordmark(page: Page) {
  return page.getByRole("banner").getByText("Panel", { exact: true });
}

for (const width of PHONE_WIDTHS) {
  test(`keeps the course toggle clear of the wordmark at ${width}px`, async ({
    page,
    scenario,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}`);

    const courseToggle = page.getByRole("button", {
      name: "Open course navigation",
    });

    await expect(courseToggle).toBeVisible();
    await expect(wordmark(page)).toBeVisible();

    const toggleBox = await boxOf(courseToggle)();
    const wordmarkBox = await boxOf(wordmark(page))();
    const overlap = intersect(toggleBox, wordmarkBox);

    // The geometry assertion this suite never had, at the widths the bug ships
    // at. A sub-pixel counts as overlapping: the toggle's box is a tap target,
    // so any part of it over the letters steals taps meant for the wordmark
    // (END-179 measured 36.00px of it).
    expect(
      overlap.x,
      `the course toggle ${describe(toggleBox)} overlaps the "Panel" wordmark ` +
        `${describe(wordmarkBox)} by ${overlap.x.toFixed(2)}px horizontally and ` +
        `${overlap.y.toFixed(2)}px vertically at ${width}px`
    ).toBeLessThan(1);

    // The mechanism, not just the symptom: the bar's own row must be what holds
    // the toggle, so re-floating it anywhere else fails too.
    const barBox = await boxOf(page.getByRole("banner"))();
    expect(
      toggleBox.x >= barBox.x &&
        toggleBox.x + toggleBox.width <= barBox.x + barBox.width,
      `the course toggle ${describe(toggleBox)} is not inside the top bar ` +
        `${describe(barBox)} at ${width}px`
    ).toBe(true);
    await expect(
      page.getByRole("banner").getByRole("button", {
        name: "Open course navigation",
      })
    ).toHaveCount(1);

    // Nor may the two phone toggles cover each other.
    const mainToggleBox = await boxOf(
      page.getByRole("button", { name: "Open main navigation" })
    )();
    expect(intersect(toggleBox, mainToggleBox).x).toBeLessThan(1);

    // A tap on the middle of the wordmark must land on the wordmark itself, not
    // on an invisible button parked over it.
    const hitTheWordmark = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.textContent?.trim() === "Panel",
      [wordmarkBox.x + wordmarkBox.width / 2, wordmarkBox.y + wordmarkBox.height / 2]
    );
    expect(hitTheWordmark).toBe(true);

    // And the toggle still opens the course drawer from wherever it now sits.
    await courseToggle.click();
    const courseSidebar = page.locator("aside", {
      hasText: "Course Navigation",
    });
    await expect.poll(leftEdge(courseSidebar)).toBeGreaterThanOrEqual(0);
  });
}
