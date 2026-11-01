import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD } from "./env";
import { seedScenario, type Person, type Scenario } from "./scenario";

type Fixtures = {
  /** A freshly reset and seeded course, made before each test that asks for it. */
  scenario: Scenario;
  /** Opens a separate browser session signed in as someone else, such as a student. */
  pageAs: (person: Person) => Promise<Page>;
};

/** Signs in through the real /login page and waits to land on the person's home page. */
export async function signIn(page: Page, person: Person) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

export const test = base.extend<Fixtures>({
  // The second argument is Playwright's `use`, renamed so the React hooks lint rule leaves it alone
  scenario: async ({}, provide) => {
    await provide(await seedScenario());
  },

  pageAs: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];

    await provide(async (person) => {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      await signIn(page, person);
      return page;
    });

    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };
