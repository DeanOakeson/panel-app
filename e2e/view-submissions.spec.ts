import { test, expect, signIn } from "./support/fixtures";
import { expectCards, expectStatus, filterButton, studentCard } from "./support/grading";
import { BEN_SCORE, CARA_FEEDBACK, CARA_SCORE } from "./support/scenario";
import { STUB_URL } from "./support/env";

test.describe("Professor views student submissions", () => {
  test("lists every enrolled student with a status badge and a summary", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    await expect(page.getByRole("heading", { name: "Student submissions" })).toBeVisible();
    await expect(page.getByText("3 of 4 submitted · 2 need grading (1 resubmitted) · 1 missing")).toBeVisible();

    // Work to grade comes first, then graded work, then missing work
    await expectCards(page, ["Ava Martin", "Ben Carter", "Cara Diaz", "Dev Patel"]);

    const ava = studentCard(page, "Ava Martin");
    await expectStatus(ava, "Needs grading");
    await expect(ava).toContainText(scenario.students.ava.email);
    await expect(ava).toContainText("Martin_Project1.pdf");
    await expect(ava).toContainText("Not graded");
    await expect(ava.getByRole("button", { name: "Save grade" })).toBeVisible();

    const ben = studentCard(page, "Ben Carter");
    await expectStatus(ben, "Resubmitted");
    await expect(ben).toContainText("Carter_Project1_v2.pdf");
    await expect(ben).toContainText(`${BEN_SCORE} / 100`);
    await expect(ben.getByText("Resubmitted after grading")).toBeVisible();

    const cara = studentCard(page, "Cara Diaz");
    await expectStatus(cara, "Graded");
    await expect(cara).toContainText(`${CARA_SCORE} / 100`);
    await expect(cara).toContainText(CARA_FEEDBACK);
    await expect(cara.getByRole("button", { name: "Edit grade" })).toBeVisible();

    const dev = studentCard(page, "Dev Patel");
    await expectStatus(dev, "Missing");
    await expect(dev.getByText("No submission")).toBeVisible();
  });

  test("shows a student without a submission as Missing once closed and Not submitted while open", async ({
    page,
    scenario,
  }) => {
    await signIn(page, scenario.professor);

    await page.goto(scenario.closed.path);
    await expectStatus(studentCard(page, "Dev Patel"), "Missing");
    await expect(filterButton(page, "Missing")).toHaveText("Missing (1)");

    await page.goto(scenario.open.path);
    await expect(page.getByText("1 of 4 submitted · 1 needs grading · 3 not submitted")).toBeVisible();
    for (const name of ["Ben Carter", "Cara Diaz", "Dev Patel"]) {
      await expectStatus(studentCard(page, name), "Not submitted");
    }
    await expectStatus(studentCard(page, "Ava Martin"), "Needs grading");
    await expect(filterButton(page, "Not submitted")).toHaveText("Not submitted (3)");
  });

  test("filters the list by grading status, with a count on each filter", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const filters = [
      { label: "Needs grading", count: 2, names: ["Ava Martin", "Ben Carter"] },
      { label: "Graded", count: 1, names: ["Cara Diaz"] },
      { label: "Missing", count: 1, names: ["Dev Patel"] },
      { label: "All", count: 4, names: ["Ava Martin", "Ben Carter", "Cara Diaz", "Dev Patel"] },
    ];

    await expect(filterButton(page, "All")).toHaveAttribute("aria-pressed", "true");

    for (const { label, count, names } of filters) {
      const button = filterButton(page, label);

      await expect(button).toHaveText(`${label} (${count})`);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("group", { name: "Show students" }).getByRole("button", { pressed: true })).toHaveCount(1);
      await expectCards(page, names);
    }
  });

  test("opens a submitted PDF in a new tab", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.closed.path);

    const link = studentCard(page, "Ava Martin").getByRole("link", { name: "View / Download file" });
    await expect(link).toHaveAttribute("target", "_blank");

    const href = await link.getAttribute("href");
    expect(href).toContain(`${STUB_URL}/storage/v1/object/sign/`);

    const fileResponse = page.context().waitForEvent("response", (response) => response.url() === href);
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    const response = await fileResponse;

    await expect(popup).toHaveURL(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect(response.headers()["content-disposition"]).toMatch(/^inline; filename="\d+-Martin_Project1\.pdf"$/);

    // The tab's PDF viewer takes over the response, so the bytes are fetched again
    const file = await page.request.get(href!);
    expect((await file.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("shows submitted and to-grade counts on the assignment list", async ({ page, scenario }) => {
    await signIn(page, scenario.professor);
    await page.goto(scenario.course.assignmentsPath);

    const closedItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: scenario.closed.name }) });
    const openItem = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: scenario.open.name }) });

    await expect(closedItem).toContainText("3/4 submitted · 2 to grade (1 resubmitted)");
    await expect(openItem).toContainText("1/4 submitted · 1 to grade");

    await closedItem.getByRole("link", { name: scenario.closed.name }).click();
    await expect(page).toHaveURL(scenario.closed.path);
    await expect(page.getByText("3 of 4 submitted · 2 need grading (1 resubmitted) · 1 missing")).toBeVisible();
  });
});
