import { test, expect, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BACKEND_URL, getToken } from './helpers';

// ─── Test data identifiers ────────────────────────────────────────────────────
const RECIPE_NAME         = 'e2e Steak Dinner';
const RECIPE_SLUG         = 'e2e-steak-dinner';
const DELETE_ENTRY_TITLE  = 'e2e Delete Me';

// ─── Shared state (set in beforeAll, used in afterAll) ────────────────────────
let token          = '';
let recipeUUID     = '';
let entryId: number | null = null;       // recipe entry — used in TEST 5
let deleteEntryId: number | null = null; // note entry  — deleted in TEST 4
let randomEntryId: number | null = null; // random entry created in TEST 3 — cleaned up in afterAll

function getTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEAL PLANNER
//
//   beforeAll:  create recipe "e2e Steak Dinner" and two meal plan entries for
//               today:
//                 • entryId       — linked to the recipe (TEST 3 dice, TEST 5)
//                 • deleteEntryId — note-only entry "e2e Delete Me" (TEST 4)
//               Clean up leftovers from any previous failed run first.
//   beforeEach: login + navigate to /household/mealplan/planner/view.
//   afterAll:   delete both entries (if still present) and the recipe.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Meal Planner', () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ request }) => {
    test.setTimeout(60_000);
    token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const h = { Authorization: `Bearer ${token}` };

    // Clean up stale data from any previous failed run.
    await request.delete(`${BACKEND_URL}/api/recipes/${RECIPE_SLUG}`, { headers: h });

    // Create the recipe and retrieve its UUID.
    const recipeSlug: string = await (await request.post(`${BACKEND_URL}/api/recipes`, {
      headers: h,
      data: { name: RECIPE_NAME },
    })).json();

    const fullRecipe = await (await request.get(
      `${BACKEND_URL}/api/recipes/${recipeSlug}`,
      { headers: h },
    )).json();
    recipeUUID = fullRecipe.id;

    const today = getTodayISO();

    // Entry 1: recipe-linked entry — kept alive for TEST 3 (dice) and TEST 5.
    const entry1 = await (await request.post(`${BACKEND_URL}/api/households/mealplans`, {
      headers: h,
      data: { date: today, entryType: 'dinner', recipeId: recipeUUID, title: '', text: '' },
    })).json();
    entryId = entry1.id;

    // Entry 2: note-only entry — TEST 4 will delete this.
    const entry2 = await (await request.post(`${BACKEND_URL}/api/households/mealplans`, {
      headers: h,
      data: { date: today, entryType: 'dinner', title: DELETE_ENTRY_TITLE, text: '' },
    })).json();
    deleteEntryId = entry2.id;
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/household/mealplan/planner/view');
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(async ({ request }) => {
    const h = { Authorization: `Bearer ${token}` };
    // Ignore 404s: TEST 4 already deletes deleteEntryId.
    if (entryId != null)
      await request.delete(`${BACKEND_URL}/api/households/mealplans/${entryId}`, { headers: h });
    if (deleteEntryId != null)
      await request.delete(`${BACKEND_URL}/api/households/mealplans/${deleteEntryId}`, { headers: h });
    if (randomEntryId != null)
      await request.delete(`${BACKEND_URL}/api/households/mealplans/${randomEntryId}`, { headers: h });
    await request.delete(`${BACKEND_URL}/api/recipes/${RECIPE_SLUG}`, { headers: h });
  });

  // ─── TEST 1 — Page structure ──────────────────────────────────────────────────
  test('TEST 1 — page shows tabs, 7 day columns, and action buttons', async ({ page }) => {
    // Both navigation tabs must be present.
    await expect(page.getByRole('tab', { name: 'Meal Planner' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Edit' })).toBeVisible();

    // Action buttons in the top bar.
    await expect(page.getByRole('button', { name: /Add All to List/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Settings/i })).toBeVisible();

    // Default numberOfDays = 7 → 7 day columns rendered with class col-borders.
    await expect(page.locator('.col-borders')).toHaveCount(7);
  });

  // ─── TEST 2 — Tab toggle ──────────────────────────────────────────────────────
  test('TEST 2 — Edit tab shows edit mode; Meal Planner tab restores view mode', async ({ page }) => {
    // In view mode the "Add All to List" button is present (v-if="route.name === TABS.view").
    await expect(page.getByRole('button', { name: /Add All to List/i })).toBeVisible();

    // Switch to edit mode.
    await page.getByRole('tab', { name: 'Edit' }).click();
    await page.waitForURL('**/planner/edit**', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // In edit mode the "Add All to List" button is removed from the DOM.
    await expect(page.getByRole('button', { name: /Add All to List/i })).not.toBeVisible();
    // Day columns are still present in edit mode.
    await expect(page.locator('.col-borders').first()).toBeVisible();

    // Switch back to view mode.
    await page.getByRole('tab', { name: 'Meal Planner' }).click();
    await page.waitForURL('**/planner/view**', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // "Add All to List" is visible again in view mode.
    await expect(page.getByRole('button', { name: /Add All to List/i })).toBeVisible();
  });

  // ─── TEST 3 — Dice button adds a random recipe ────────────────────────────────
  test('TEST 3 — clicking the dice button adds a random recipe and it appears in the planner', async ({ page }) => {
    // Switch to edit mode where the dice button lives.
    await page.getByRole('tab', { name: 'Edit' }).click();
    await page.waitForURL('**/planner/edit**', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Identify today's column — it already contains the seeded recipe entry.
    const todayColumn = page.locator('.col-borders').filter({ hasText: RECIPE_NAME }).first();
    await expect(todayColumn).toBeVisible({ timeout: 10_000 });

    // Count entry cards before rolling.
    const entriesBefore = await todayColumn.locator('.v-card.my-1').count();

    // Intercept the /random API response so we can capture the new entry's ID for cleanup.
    const randomResponse = page.waitForResponse(
      resp => resp.url().includes('/api/households/mealplans/random') && resp.status() === 200,
    );

    // Click the dice (random-meal) button — first icon button in BaseButtonGroup.
    await todayColumn.locator('.v-item-group button').first().click();

    // The v-menu dropdown renders in an overlay; click "Breakfast".
    await page.locator('.v-overlay--active .v-list-item').filter({ hasText: 'Breakfast' }).click();

    // Capture the new entry ID for afterAll cleanup.
    const data = await (await randomResponse).json();
    randomEntryId = data.id;

    await page.waitForLoadState('networkidle');

    // One additional entry card should now be in today's column.
    await expect(todayColumn.locator('.v-card.my-1')).toHaveCount(entriesBefore + 1, { timeout: 10_000 });

    // Switch back to view mode and confirm the recipe is visible.
    await page.getByRole('tab', { name: 'Meal Planner' }).click();
    await page.waitForURL('**/planner/view**', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(RECIPE_NAME)).toBeVisible({ timeout: 10_000 });
  });

  // ─── TEST 4 — Delete entry in edit mode ──────────────────────────────────────
  test('TEST 4 — deleting a meal plan entry in edit mode removes it', async ({ page }) => {
    await page.getByRole('tab', { name: 'Edit' }).click();
    await page.waitForURL('**/planner/edit**', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Confirm the note entry is visible before deleting.
    await expect(page.getByText(DELETE_ENTRY_TITLE)).toBeVisible({ timeout: 10_000 });

    // Each entry renders as a v-card.my-1 in edit.vue.
    // The card's bottom row has: drag-handle btn · meal-type chip · delete btn (.ml-auto).
    const entryCard = page.locator('.v-card.my-1').filter({ hasText: DELETE_ENTRY_TITLE }).first();
    await expect(entryCard).toBeVisible();
    await entryCard.locator('button.ml-auto').click();

    await page.waitForLoadState('networkidle');
    await expect(page.getByText(DELETE_ENTRY_TITLE)).not.toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 5 — "Add All to List" opens the shopping list dialog ────────────────
  test('TEST 5 — "Add All to List" button opens the shopping list dialog', async ({ page }) => {
    // The seeded recipe entry must be loaded before the button is enabled.
    await expect(page.getByText(RECIPE_NAME)).toBeVisible({ timeout: 10_000 });

    const addAllBtn = page.getByRole('button', { name: /Add All to List/i });
    await expect(addAllBtn).toBeEnabled({ timeout: 5_000 });
    await addAllBtn.click();

    // addAllToList() awaits getShoppingLists() before opening the dialog.
    await page.waitForLoadState('networkidle');

    // RecipeDialogAddToShoppingList mounts a v-dialog — check for active overlay.
    await expect(page.locator('.v-overlay.v-dialog.v-overlay--active')).toBeVisible({ timeout: 10_000 });
  });
});
