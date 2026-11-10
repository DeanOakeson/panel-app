import { expect, type Locator, type Page } from "@playwright/test";

/** Returns the professor's "Student submissions" section of an assignment page. */
export function submissionList(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Student submissions" }) });
}

/** Returns the card for one student on the professor's submission list. */
export function studentCard(page: Page, name: string): Locator {
  return submissionList(page).getByRole("article").filter({ hasText: name });
}

/** Returns the filter button whose label starts with `label`, like "Needs grading (2)". */
export function filterButton(page: Page, label: string): Locator {
  return page
    .getByRole("group", { name: "Show students" })
    .getByRole("button", { name: new RegExp(`^${label} \\(\\d+\\)$`) });
}

/** Expects a student's card to carry a status badge with exactly this label. */
export async function expectStatus(card: Locator, label: string) {
  await expect(card.getByText(label, { exact: true })).toBeVisible();
}

/** Expects the cards on screen to belong to exactly these students, in this order. */
export async function expectCards(page: Page, names: string[]) {
  const cards = submissionList(page).getByRole("article");

  await expect(cards).toHaveCount(names.length);
  for (const [index, name] of names.entries()) {
    await expect(cards.nth(index)).toContainText(name);
  }
}

/** Returns the student's "Your submission" section of an assignment page. */
export function ownSubmission(page: Page): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Your submission" }) });
}

/** Fills a card's grade form and presses its save button, "Save grade" or "Save changes". */
export async function saveGrade(card: Locator, score: string, feedback: string, button = "Save grade") {
  await card.getByLabel("Score").fill(score);
  await card.getByLabel("Feedback").fill(feedback);
  await card.getByRole("button", { name: button }).click();
}

/** Matches a professor-side timestamp line such as "Graded Nov 1, 3:05 PM MT". */
export function timestampLine(label: string): RegExp {
  return new RegExp(`^${label} [A-Z][a-z]{2} \\d{1,2}, \\d{1,2}:\\d{2} [AP]M MT$`);
}

/** Fills a card's missing-work feedback and presses its save button, "Mark missing" or "Save feedback". */
export async function markMissing(card: Locator, feedback: string, button = "Mark missing") {
  await card.getByLabel("Feedback").fill(feedback);
  await card.getByRole("button", { name: button }).click();
}

/** Expects a score such as "0 / 100" with a Missing tag beside it. */
export async function expectMissingScore(container: Locator, score: string) {
  const scoreText = container.getByText(score, { exact: true });

  await expect(scoreText).toBeVisible();
  await expect(scoreText.locator("xpath=..").getByText("Missing", { exact: true })).toBeVisible();
}
