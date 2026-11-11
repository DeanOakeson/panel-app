import { test, expect, signIn } from "./support/fixtures";
import { addQuiz, gradeCell, gradesPath, unenroll } from "./support/gradebook";
import { createAssignment, dateFromToday, type Scenario } from "./support/scenario";
import type { Page } from "@playwright/test";

// Classic scrollbars take room from the grid, as they do in a desktop browser
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

/**
 * Gives the seeded course six assignments: the seeded two, Quiz 1 and three
 * more with long names like a real course's.
 */
async function addSixAssignments(scenario: Scenario) {
  await addQuiz(scenario);

  for (const [name, points, days] of [
    ["Project 2: Architecture and Design Review", 100, 20],
    ["Homework 3: Process Models", 10, 25],
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

/** Returns the column headers whose names are cut short, and whether the page itself scrolls sideways. */
function measureFit(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main")!;
    const root = document.documentElement;

    return {
      truncated: Array.from(document.querySelectorAll<HTMLElement>("thead a"))
        .filter((link) => link.scrollHeight > link.clientHeight + 1)
        .map((link) => link.textContent),
      pageSideways: root.scrollWidth > root.clientWidth || main.scrollWidth > main.clientWidth,
    };
  });
}

/** Returns the scrolling grid's shaded edges that show. */
function shades(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-shade]")).map((shade) => shade.dataset.shade)
  );
}

test.describe("Gradebook layout", () => {
  test("fits six whole assignment names at 1280 pixels with the navigation collapsed", async ({ page, scenario }) => {
    await addSixAssignments(scenario);
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", "Reading Reflection")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show course navigation" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );

    await expect.poll(() => measureColumns(page)).toEqual({ sideways: false, whole: 6, underFrozen: 0 });
    expect(await measureFit(page)).toEqual({ truncated: [], pageSideways: false });
    expect(await shades(page)).toEqual([]);
    await expect(page.getByRole("button", { name: "Show later assignments" })).toHaveCount(0);

    // The columns share the spare room rather than leaving it empty
    const width = await page.getByRole("columnheader", { name: /Reading Reflection/ }).evaluate(
      (header) => header.getBoundingClientRect().width
    );
    expect(width).toBeGreaterThan(130);
    expect(width).toBeLessThanOrEqual(177);
  });

  test("shows which assignments are in view and moves between them at 1024 pixels", async ({ page, scenario }) => {
    await addSixAssignments(scenario);
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", "Project 1: Requirements")).toBeVisible();
    await expect.poll(() => measureColumns(page)).toMatchObject({ sideways: true, underFrozen: 0 });
    expect((await measureFit(page)).pageSideways).toBe(false);

    const earlier = page.getByRole("button", { name: "Show earlier assignments" });
    const later = page.getByRole("button", { name: "Show later assignments" });
    const range = page.getByText(/^Assignments 1–\d of 6$/);
    const { whole } = await measureColumns(page);

    await expect(range).toHaveText(`Assignments 1–${whole} of 6`);
    await expect(earlier).toBeDisabled();
    await expect(later).toBeEnabled();
    expect(await shades(page)).toEqual(["end"]);
    for (const button of [earlier, later]) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(32);
      expect(box!.height).toBeGreaterThanOrEqual(32);
    }

    for (let step = 0; step < 6 && (await later.isEnabled()); step++) {
      await later.click();
      await expect.poll(() => measureColumns(page)).toMatchObject({ underFrozen: 0 });
    }

    await expect(page.getByText(`Assignments ${7 - whole}–6 of 6`, { exact: true })).toBeVisible();
    await expect(later).toBeDisabled();
    await expect(earlier).toBeEnabled();
    expect(await shades(page)).toEqual(["start"]);
    const lastHeader = await page.getByRole("columnheader", { name: /Reading Reflection/ }).boundingBox();
    const scroller = await page.locator(`#gradebook-grid`).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { right: rect.left + element.clientLeft + element.clientWidth };
    });
    expect(lastHeader!.x + lastHeader!.width).toBeLessThanOrEqual(scroller.right + 1);

    // The range follows any scroll, not just the buttons
    await page.locator("#gradebook-grid").evaluate((element) => element.scrollTo({ left: 0 }));
    await expect(page.getByText(`Assignments 1–${whole} of 6`, { exact: true })).toBeVisible();
    await expect(earlier).toBeDisabled();
    expect((await measureFit(page)).pageSideways).toBe(false);
  });

  test("rests vertical scrolling on whole rows and shades the bottom while more lie below", async ({ page, scenario }) => {
    await addSixAssignments(scenario);
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", "Project 1: Requirements")).toBeVisible();

    const scroller = page.locator("#gradebook-grid");
    await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await expect.poll(() => shades(page)).toContain("bottom");

    /** Returns how far the first row below the header starts from the header's bottom edge. */
    const rowOffset = () =>
      page.evaluate(() => {
        const headerBottom = document.querySelector("thead")!.getBoundingClientRect().bottom;
        const rows = Array.from(document.querySelectorAll("tbody tr")).map((row) => row.getBoundingClientRect());
        const first = rows.find((rect) => rect.bottom > headerBottom + 1)!;
        return Math.round(first.top - headerBottom);
      });

    // A short wheel turn springs back to the first row, and a longer one rests on a later row
    await scroller.hover();
    await page.mouse.wheel(0, 15);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(rowOffset).toBe(0);

    await scroller.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect.poll(() => shades(page)).not.toContain("bottom");

    // Moving down by keyboard keeps each focused cell whole between the header and the bottom edge
    await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
    await gradeCell(page, "Ava Martin", "Project 1: Requirements").focus();
    for (const name of ["Ben Carter", "Cara Diaz", "Dev Patel"]) {
      await page.keyboard.press("ArrowDown");
      const cell = gradeCell(page, name, "Project 1: Requirements");
      await expect(cell).toBeFocused();
      await expect
        .poll(() =>
          cell.evaluate((button) => {
            const grid = button.closest("#gradebook-grid")!;
            const box = button.getBoundingClientRect();
            const headerBottom = grid.querySelector("thead")!.getBoundingClientRect().bottom;
            const visibleBottom = grid.getBoundingClientRect().top + grid.clientTop + grid.clientHeight;
            return box.top >= headerBottom - 1 && box.bottom <= visibleBottom + 1;
          })
        )
        .toBe(true);
    }
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
    await expect
      .poll(() =>
        page.locator("#gradebook-grid").evaluate(
          (element) => element.scrollHeight > element.clientHeight
        )
      )
      .toBe(true);
  });

  test("lines up the progress bars and keeps the page whole at every width", async ({ page, scenario }) => {
    await addSixAssignments(scenario);
    await unenroll(scenario, scenario.students.ben);
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", "Reading Reflection")).toBeAttached();

    for (const [width, colorScheme] of [
      [1600, "light"],
      [1440, "dark"],
      [1280, "light"],
      [1024, "dark"],
      [820, "light"],
      [390, "dark"],
    ] as const) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 800 });
      await expect.poll(() => measureColumns(page)).toMatchObject({ underFrozen: 0 });

      const layout = await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll("thead th")).slice(1);
        const bars = headers.map((header) => header.querySelector("button span")!.getBoundingClientRect());
        const meta = headers.map((header) => header.querySelector("p")!.getBoundingClientRect());
        const counts = headers.map((header) => header.querySelector("button span:nth-child(2) span")! as HTMLElement);
        const toolbar = Array.from(document.querySelectorAll<HTMLElement>("main button, main p")).filter(
          (element) => element.closest("table") === null && element.offsetParent !== null
        );
        const root = document.documentElement;

        return {
          barTops: new Set(bars.map((bar) => Math.round(bar.top))).size,
          barsClearOfMeta: bars.every((bar, index) => bar.top >= meta[index].bottom + 4),
          countsWhole: counts.every((count) => count.scrollWidth <= count.clientWidth),
          pageSideways: root.scrollWidth > root.clientWidth,
          clipped: toolbar
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.left < 0 || box.right > root.clientWidth;
            })
            .map((element) => element.textContent),
        };
      });

      expect(layout, `at ${width} pixels`).toEqual({
        barTops: 1,
        barsClearOfMeta: true,
        countsWhole: true,
        pageSideways: false,
        clipped: [],
      });

      // The key opens inside the window
      const key = page.getByRole("region", { name: "Key" });
      await page.getByRole("button", { name: "Key", exact: true }).click();
      await expect(key).toBeVisible();
      const box = (await key.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
      await page.keyboard.press("Escape");
      await expect(key).toBeHidden();
    }
  });

  test("puts the feedback mark beside its score and divides the columns", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(gradesPath(scenario));

    const cell = gradeCell(page, "Cara Diaz", "Quiz 1");
    await expect(cell).toBeVisible();

    const { score, icon, cellBox } = await cell.evaluate((button) => {
      const svg = button.querySelector("svg")!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button.querySelector("span span span")!);
      const text = range.getBoundingClientRect();

      return {
        score: { right: text.right, middle: text.top + text.height / 2 },
        icon: { left: svg.left, middle: svg.top + svg.height / 2, size: svg.width },
        cellBox: button.getBoundingClientRect(),
      };
    });

    expect(icon.size).toBe(16);
    expect(icon.left).toBeGreaterThan(score.right);
    expect(icon.left - score.right).toBeLessThan(8);
    expect(Math.abs(icon.middle - score.middle)).toBeLessThan(3);
    expect(icon.middle).toBeGreaterThan(cellBox.top + 8);

    const borders = await page.evaluate(() =>
      Array.from(document.querySelectorAll("thead th, tbody tr:first-child td")).map(
        (element) => getComputedStyle(element).borderLeftWidth
      )
    );
    expect(borders.slice(1).every((width) => width === "1px")).toBe(true);
  });
});
