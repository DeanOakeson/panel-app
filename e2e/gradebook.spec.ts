import { test, expect, signIn } from "./support/fixtures";
import {
  QUIZ_CARA_FEEDBACK,
  addQuiz,
  detailsPanel,
  expectClearOfFrozenParts,
  gradeCell,
  gradesPath,
  unenroll,
} from "./support/gradebook";
import { saveGrade, studentCard } from "./support/grading";
import { BEN_SCORE, CARA_SCORE } from "./support/scenario";

const QUIZ = "Quiz 1";
const PROJECT = "Project 1: Requirements";
const HOMEWORK = "Homework 2: Use Cases";

test.describe("Professor gradebook", () => {
  test("opens from the course nav and tells every grading state apart", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    await page.goto(`/classes/${scenario.course.id}`);

    await page.getByRole("link", { name: "Grades", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${gradesPath(scenario)}$`));
    await expect(page.getByRole("heading", { name: "Grades", level: 1 })).toBeVisible();
    await expect(page.getByText("CS 3450 · Software Engineering")).toBeVisible();
    await expect(page.getByText("3 submissions to grade")).toBeVisible();

    // Columns run by due date: Project 1, then Quiz 1, then the open Homework 2
    await expect(page.getByRole("columnheader")).toHaveText([
      "Student",
      new RegExp(`^${PROJECT}`),
      new RegExp(`^${QUIZ}`),
      new RegExp(`^${HOMEWORK}`),
    ]);
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${PROJECT}`) })).toContainText(
      "1 of 3 graded"
    );
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${QUIZ}`) })).toContainText(
      "2 of 2 graded"
    );

    // A graded 0, a missing-work 0 and missing work without a grade
    const avaQuiz = gradeCell(page, "Ava Martin", QUIZ);
    await expect(avaQuiz).toHaveText("0/10");
    await expect(avaQuiz).toHaveAccessibleName("0 out of 10. Ava Martin, Quiz 1");

    const devQuiz = gradeCell(page, "Dev Patel", QUIZ);
    await expect(devQuiz).toHaveText("0/10Missing");
    await expect(devQuiz).toHaveAccessibleName(/^0 out of 10, Missing, has feedback\./);

    const benQuiz = gradeCell(page, "Ben Carter", QUIZ);
    await expect(benQuiz).toHaveText("Missing");
    await expect(benQuiz).toHaveAccessibleName(/^Missing, no grade yet\./);

    await expect(gradeCell(page, "Cara Diaz", QUIZ)).toHaveAccessibleName(
      /^10 out of 10, has feedback\./
    );

    // The closed project: to grade, resubmitted with its standing score, graded and missing
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("Needs grading");
    await expect(gradeCell(page, "Ben Carter", PROJECT)).toHaveText(`Needs gradingResubmittedearlier ${BEN_SCORE}/100`);
    await expect(gradeCell(page, "Cara Diaz", PROJECT)).toHaveText(`${CARA_SCORE}/100`);
    await expect(gradeCell(page, "Dev Patel", PROJECT)).toHaveText("Missing");

    // The open homework: not submitted yet rather than missing
    await expect(gradeCell(page, "Ava Martin", HOMEWORK)).toHaveText("Needs grading");
    await expect(gradeCell(page, "Ben Carter", HOMEWORK)).toHaveText("Not submitted");

    await page.getByRole("button", { name: "Key", exact: true }).click();
    await expect(page.getByRole("region", { name: "Key" })).toContainText("Zero given for missing work");
  });

  test("opens a cell's details with the full feedback and closes with Escape", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    const cell = gradeCell(page, "Cara Diaz", QUIZ);
    await cell.focus();
    await page.keyboard.press("Enter");

    const panel = detailsPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAccessibleName("Cara Diaz");
    await expect(panel).toContainText(QUIZ);
    await expect(panel).toContainText("Graded");
    await expect(panel).toContainText("10/ 10");
    await expect(panel).toContainText(QUIZ_CARA_FEEDBACK);
    await expect(panel.getByRole("link", { name: "Edit grade" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(cell).toBeFocused();

    // A click outside the drawer closes it too
    await gradeCell(page, "Dev Patel", QUIZ).click();
    await expect(panel).toContainText("A missing-work grade, saved because nothing was turned in.");
    await expect(panel.getByRole("link", { name: "Edit feedback" })).toBeVisible();
    await page.mouse.click(20, 400);
    await expect(panel).toBeHidden();
  });

  test("grades a submission from the gradebook and comes back to the new score", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));
    await expect(page.getByText("3 submissions to grade")).toBeVisible();

    await gradeCell(page, "Ava Martin", PROJECT).click();
    await detailsPanel(page).getByRole("link", { name: "Grade submission" }).click();

    await expect(page).toHaveURL(
      `${scenario.closed.path}?student=${scenario.students.ava.uid}&from=grades`
    );
    const card = studentCard(page, "Ava Martin");
    await expect(card).toBeFocused();
    await saveGrade(card, "88", "Solid outline.");
    await expect(card).toContainText("88 / 100");
    await expect(page.getByRole("link", { name: "← Back to grades" })).toBeInViewport();

    await page.getByRole("link", { name: "← Back to grades" }).click();
    await expect(page).toHaveURL(new RegExp(`${gradesPath(scenario)}$`));
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("88/100");
    await expect(page.getByText("2 submissions to grade")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${PROJECT}`) })).toContainText(
      "2 of 3 graded"
    );
  });

  test("updates an open gradebook when another tab saves a grade", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("Needs grading");
    await page.evaluate(() => {
      (window as unknown as { gradebookMarker: boolean }).gradebookMarker = true;
    });

    const grading = await page.context().newPage();
    await grading.goto(scenario.closed.path);
    await saveGrade(studentCard(grading, "Ava Martin"), "77", "Graded in another tab.");
    await expect(studentCard(grading, "Ava Martin")).toContainText("77 / 100");

    await expect(gradeCell(page, "Ava Martin", PROJECT)).toHaveText("77/100");
    expect(
      await page.evaluate(
        () => (window as unknown as { gradebookMarker?: boolean }).gradebookMarker
      )
    ).toBe(true);
  });

  test("moves between cells with the arrow keys from a single Tab stop", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    await expect(page.locator('table [tabindex="0"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Key", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(gradeCell(page, "Ava Martin", QUIZ)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(gradeCell(page, "Ben Carter", QUIZ)).toBeFocused();
    await page.keyboard.press("End");
    await expect(gradeCell(page, "Ben Carter", HOMEWORK)).toBeFocused();
    await page.keyboard.press("Home");
    await expect(gradeCell(page, "Ben Carter", PROJECT)).toBeFocused();
    await page.keyboard.press("Control+End");
    await expect(gradeCell(page, "Dev Patel", HOMEWORK)).toBeFocused();
    await page.keyboard.press("Control+Home");
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(
      page.getByRole("button", { name: `Filter students by ${PROJECT}, 1 of 3 graded, 2 to grade` })
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeFocused();

    // The last cell moved to stays the Tab stop, and Space opens it
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(gradeCell(page, "Ava Martin", QUIZ)).toBeFocused();
    await expect(page.locator('table [tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(detailsPanel(page)).toHaveAccessibleName("Ava Martin");
  });

  test("keeps the focused cell clear of the frozen column and header", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    // Narrow enough that the grid scrolls sideways
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto(gradesPath(scenario));

    await gradeCell(page, "Ava Martin", PROJECT).focus();
    await page.keyboard.press("End");
    const homework = gradeCell(page, "Dev Patel", HOMEWORK);
    await page.keyboard.press("Control+End");
    await expect(homework).toBeFocused();
    await expectClearOfFrozenParts(page, homework);

    await page.keyboard.press("Control+Home");
    const project = gradeCell(page, "Ava Martin", PROJECT);
    await expect(project).toBeFocused();
    await expectClearOfFrozenParts(page, project);

    // Focus that comes back from the panel is scrolled clear too
    await page.keyboard.press("Enter");
    await expect(detailsPanel(page)).toBeVisible();
    await project.evaluate((cell) => {
      const scroller = cell.closest("table")!.parentElement!;
      scroller.scrollTo({ left: scroller.scrollWidth, top: scroller.scrollHeight });
    });
    await page.keyboard.press("Escape");
    await expect(project).toBeFocused();
    await expectClearOfFrozenParts(page, project);
  });

  test("opens the key in a popover that closes with Escape or a click outside", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    const button = page.getByRole("button", { name: "Key", exact: true });
    const key = page.getByRole("region", { name: "Key" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(key).toBeHidden();

    await button.click();
    await expect(key).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(button).toHaveAttribute("aria-controls", (await key.getAttribute("id"))!);
    await expect(key.getByRole("heading")).toHaveText(["To grade", "Not turned in", "Graded"]);
    await expect(key.locator("li > span:not([aria-hidden])")).toHaveText([
      "Needs grading: Turned in, waiting for you to grade",
      "Resubmitted, with the earlier score: New version to grade. The earlier score stands until then",
      "After Missing, with the earlier score: Turned in after a missing-work grade",
      "Not submitted: Not due yet",
      "Missing: Past due, no grade yet",
      "0 out of 10 with a Missing tag: Zero given for missing work",
      "A score like 18 out of 20: Score out of the points",
      "A score with a speech bubble: Has written feedback",
    ]);

    // Every sample shares one width, so the meanings line up, and the groups sit in two columns
    const layout = await key.evaluate((element) => ({
      sampleWidths: new Set(
        Array.from(element.querySelectorAll("li > span[aria-hidden]")).map((sample) => sample.getBoundingClientRect().width)
      ).size,
      columns: new Set(Array.from(element.querySelectorAll("h2")).map((heading) => heading.getBoundingClientRect().left)).size,
    }));
    expect(layout).toEqual({ sampleWidths: 1, columns: 2 });

    await page.keyboard.press("Escape");
    await expect(key).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // Opening by keyboard leaves focus on the button, and Tab still reaches the grid's one stop
    await page.keyboard.press("Enter");
    await expect(key).toBeVisible();
    await expect(button).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeFocused();
    await expect(page.locator('table [tabindex="0"]')).toHaveCount(1);
    await expect(key).toBeVisible();

    // Opening a grade's details closes the key, which stays closed after the details
    await page.keyboard.press("Enter");
    await expect(detailsPanel(page)).toHaveAccessibleName("Ava Martin");
    await expect(key).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(detailsPanel(page)).toBeHidden();
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.click();
    await page.getByRole("heading", { name: "Grades", level: 1 }).click();
    await expect(key).toBeHidden();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // A click on a grade closes the key and opens the grade
    await button.click();
    await gradeCell(page, "Cara Diaz", PROJECT).click();
    await expect(key).toBeHidden();
    await expect(detailsPanel(page)).toHaveAccessibleName("Cara Diaz");
  });

  test("leaves Escape to an open filter menu before the key", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    const key = page.getByRole("region", { name: "Key" });
    await page.getByRole("button", { name: "Key", exact: true }).press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: `Filter students by ${PROJECT}` });
    await expect(menu).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(key).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^Filter students by ${PROJECT}`) })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(key).toBeHidden();
    await expect(page.getByRole("button", { name: "Key", exact: true })).toBeFocused();
  });

  test("fits the key inside a phone-sized window and scrolls it when it is taller", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await unenroll(scenario, scenario.students.ben);
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    const key = page.getByRole("region", { name: "Key" });
    for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 520 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "Key", exact: true }).click();
      await expect(key).toBeVisible();

      const fit = await key.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const lefts = new Set(
          Array.from(element.querySelectorAll("h2")).map((heading) => Math.round(heading.getBoundingClientRect().left))
        );

        return {
          inside:
            box.left >= 0 &&
            box.top >= 0 &&
            box.right <= document.documentElement.clientWidth &&
            box.bottom <= document.documentElement.clientHeight,
          columns: lefts.size,
          pageSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      expect(fit).toEqual({ inside: true, columns: 1, pageSideways: false });

      // The last entry scrolls into view inside the key
      const last = key.getByText("Not in the class for this assignment");
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      expect((await key.boundingBox())!.y).toBeGreaterThanOrEqual(0);

      await page.keyboard.press("Escape");
      await expect(key).toBeHidden();
    }
  });

  test("shows the key's dash entry only with a student who left", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    const key = page.getByRole("region", { name: "Key" });
    await page.getByRole("button", { name: "Key", exact: true }).click();
    await expect(key.getByRole("heading", { name: "Left the class" })).toHaveCount(0);

    await addQuiz(scenario);
    await unenroll(scenario, scenario.students.ben);
    await page.reload();
    await page.getByRole("button", { name: "Key", exact: true }).click();
    await expect(key.getByRole("heading")).toHaveText(["To grade", "Not turned in", "Graded", "Left the class"]);
    await expect(key).toContainText("Not in the class for this assignment");
  });

  test("scrolls only the grid, not the page, with a student who left", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await unenroll(scenario, scenario.students.ben);
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto(gradesPath(scenario));

    await expect(gradeCell(page, "Ben Carter", PROJECT)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Ben Carter" })).toContainText("Not enrolled");

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return { wide: root.scrollWidth > root.clientWidth, tall: root.scrollHeight > root.clientHeight };
    });
    expect(overflow).toEqual({ wide: false, tall: false });
  });

  test("rests sideways scrolling on whole columns", async ({ page, scenario }) => {
    await addQuiz(scenario);
    await signIn(page, scenario.professor);
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto(gradesPath(scenario));
    await expect(gradeCell(page, "Ava Martin", PROJECT)).toBeVisible();

    const scroller = page.getByRole("table").locator("xpath=..");
    for (const offset of [60, 120]) {
      await scroller.evaluate((element, left) => element.scrollTo({ left }), offset);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const frozen = document.querySelector("thead th")!.getBoundingClientRect();
            return Array.from(document.querySelectorAll("thead th"))
              .slice(1)
              .map((header) => header.getBoundingClientRect())
              .filter((rect) => rect.left < frozen.right - 1 && rect.right > frozen.right + 1).length;
          })
        )
        .toBe(0);
    }
  });

  test("shows names only, with the email in the hover text, and the hint under the grid at every width", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(gradesPath(scenario));

    const ava = page.getByRole("rowheader").filter({ hasText: "Ava Martin" });
    const hints = ["Select a grade for details", "Select a column's status to filter", "Arrow keys move"];
    for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await expect(ava).not.toContainText(scenario.students.ava.email);
      await expect(ava.getByText("Ava Martin")).toHaveAttribute(
        "title",
        `Ava Martin (${scenario.students.ava.email})`
      );

      const gridBottom = (await page.locator("#gradebook-grid").boundingBox())!;
      for (const hint of hints) {
        const line = page.getByText(hint, { exact: true });
        await expect(line).toBeInViewport();
        expect((await line.boundingBox())!.y).toBeGreaterThan(gridBottom.y + gridBottom.height);
      }
    }
  });

  test("points a student to the assignments instead of a gradebook", async ({ pageAs, scenario }) => {
    const page = await pageAs(scenario.students.ava);
    await page.goto(gradesPath(scenario));

    await expect(page.getByText("Your grades and feedback are on each assignment's page.")).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);

    await page.getByRole("link", { name: "Go to assignments" }).click();
    await expect(page).toHaveURL(new RegExp(`${scenario.course.assignmentsPath}$`));
  });
});
