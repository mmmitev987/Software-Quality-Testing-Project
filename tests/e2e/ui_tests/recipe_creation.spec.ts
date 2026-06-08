import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers';

test.describe('Recipe Creation via + Create dropdown', () => {

  // Log in before every test — recipe creation pages require an authenticated session.
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
    // Navigate to the group home page so the sidebar with "+ Create" is rendered
    await page.goto('/g/home');
    await page.waitForLoadState('networkidle');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1 — "Create" option loads the manual recipe form
  // ─────────────────────────────────────────────────────────────────────────────
  test('clicking "Create" in the + Create dropdown loads the Create Recipe form', async ({ page }) => {
    // The sidebar "+ Create" button opens a two-option dropdown.
    // getByRole matches substrings, so "Create" catches both "Create" and
    // "Create Recipe" — .first() targets the sidebar button, which renders first.
    await page.locator('button, [role="button"]').filter({ hasText: /^[\s+]*Create[\s+]*$/ }).first().click();
    await page.getByText('Create a recipe manually').click();

    await expect(page.getByText('Recipe Creation')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('textbox', { name: 'Recipe Name' })).toBeVisible();

    // When the Create section is active, the orange button correctly shows "Create Recipe".
    // This assertion PASSES — used as a baseline to contrast against the Import test below.
    await expect(
      page.getByRole('button', { name: /create recipe/i })
    ).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2 — "Import" option loads the scrape form
  // NOTE: this test is EXPECTED TO FAIL.
  //   The Scrape Recipe section loads correctly, but the orange button at the
  //   top-right of the page still shows "Create Recipe" instead of an
  //   import-related label. The final assertion documents that bug.
  // ─────────────────────────────────────────────────────────────────────────────
  test('clicking "Import" in the + Create dropdown loads the Scrape Recipe form', async ({ page }) => {
    await page.locator('button, [role="button"]').filter({ hasText: /^[\s+]*Create[\s+]*$/ }).first().click();
    await page.getByText('Import a recipe by URL').click();

    await expect(page.getByText('Recipe Creation')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Scrape Recipe')).toBeVisible();
    await expect(page.getByRole('textbox').first()).toBeVisible();

    // [BUG] When the Import section is active, the orange action button at the
    // top-right should change its label to reflect the current context
    // (e.g. "Import Recipe" or "Scrape Recipe"). Instead it stays as
    // "Create Recipe". This assertion FAILS until the frontend is fixed.
    await expect(
      page.getByRole('button', { name: /import with URL|scrape recipe/i })
    ).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The orange "Create Recipe" split-button on /g/home/r/create/new has its own
// dropdown that switches between creation methods.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Recipe Creation page — "Create Recipe" dropdown', () => {

  // Navigate directly to the creation page by URL — faster than driving the
  // sidebar. The "home" segment is the default group slug.
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

    await page.goto('/g/home/r/create/new');
    await expect(page.getByText('Recipe Creation')).toBeVisible({ timeout: 8_000 });
  });

  // ─── TEST 3 — dropdown lists all 6 options ──────────────────────────────────
  test('"Create Recipe" button dropdown shows all 6 creation method options', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Recipe' }).click();

    // Scope assertions to the open overlay so we match menu list items only
    const menu = page.locator('.v-overlay--active');
    await expect(menu.getByText('Import with URL')).toBeVisible();
    await expect(menu.getByText('Bulk URL Import')).toBeVisible();
    await expect(menu.getByText('Import from HTML or JSON')).toBeVisible();
    await expect(menu.getByText('Create Recipe')).toBeVisible();
    await expect(menu.getByText('Import with .zip')).toBeVisible();
    await expect(menu.getByText('Debug Scraper')).toBeVisible();
  });

  // ─── TEST 4 — "Import with URL" ─────────────────────────────────────────────
  test('"Import with URL" option loads the Scrape Recipe section', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Recipe' }).click();
    await page.getByText('Import with URL').click();

    await expect(page.getByText('Scrape Recipe')).toBeVisible({ timeout: 5_000 });
    // Check for the URL input — placeholder text varies by build, so match by role
    await expect(page.getByRole('textbox').first()).toBeVisible();
  });

  // ─── TEST 5 — "Bulk URL Import" ──────────────────────────────────────────────
  test('"Bulk URL Import" option loads the bulk URL import section', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Recipe' }).click();
    await page.getByText('Bulk URL Import').click();

    // After the dropdown closes, the orange button reflects the selected mode.
    // Use .first() because Vuetify keeps hidden menu items in DOM (strict-mode workaround).
    await expect(page.getByText('Bulk URL Import').first()).toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 6 — "Import from HTML or JSON" ────────────────────────────────────
  test('"Import from HTML or JSON" option loads the HTML/JSON import section', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Recipe' }).click();
    await page.getByText('Import from HTML or JSON').click();

    await expect(page.getByText('Import from HTML or JSON').first()).toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 7 — "Import with .zip" ────────────────────────────────────────────
  test('"Import with .zip" option loads the zip import section', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Recipe' }).click();
    await page.getByText('Import with .zip').click();

    await expect(page.getByText('Import with .zip').first()).toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 8 — "Debug Scraper" ────────────────────────────────────────────────
  test('"Debug Scraper" option loads the scraper debug section', async ({ page }) => {
    await page.getByRole('button', { name: 'Create Recipe' }).click();
    await page.getByText('Debug Scraper').click();

    await expect(page.getByText('Debug Scraper').first()).toBeVisible({ timeout: 5_000 });
  });
});
