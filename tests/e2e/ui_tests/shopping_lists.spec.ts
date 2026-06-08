import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BACKEND_URL, getToken } from './helpers';

// ─── Test data identifiers ────────────────────────────────────────────────────
const LIST_NAME       = 'e2e Shopping List';
const NEW_LIST_NAME   = 'e2e New List';
const CHECK_ITEM_NOTE = 'e2e check me';
const ADD_ITEM_NOTE   = 'e2e groceries item';

// ─── Shared state (set in beforeAll, used in afterAll) ────────────────────────
let token       = '';
let listId      = '';
let checkItemId = '';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

// Delete every shopping list whose name exactly matches `name`.
async function deleteListByName(request: APIRequestContext, name: string): Promise<void> {
  const h = { Authorization: `Bearer ${token}` };
  const res = await request.get(
    `${BACKEND_URL}/api/households/shopping/lists?page=1&perPage=100`,
    { headers: h },
  );
  if (!res.ok()) return;
  const data = await res.json();
  for (const list of (data.items ?? [])) {
    if (list.name === name) {
      await request.delete(
        `${BACKEND_URL}/api/households/shopping/lists/${list.id}`,
        { headers: h },
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHOPPING LISTS
//
//   beforeAll:  seed one list ("e2e Shopping List") and one unchecked item on it
//               ("e2e check me" — used by TEST 5).
//               Clean up leftovers from any previous failed run first.
//   beforeEach: login; each test navigates to its own starting URL.
//   afterAll:   delete the item (if still present), the seeded list, and any
//               "e2e New List" created by TEST 2.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Shopping Lists', () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ request }) => {
    test.setTimeout(60_000);
    token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const h = { Authorization: `Bearer ${token}` };

    // Clean up stale data from any previous failed run.
    await deleteListByName(request, LIST_NAME);
    await deleteListByName(request, NEW_LIST_NAME);

    // Create the main shopping list.
    const listRes = await request.post(`${BACKEND_URL}/api/households/shopping/lists`, {
      headers: h,
      data: { name: LIST_NAME },
    });
    const listData = await listRes.json();
    listId = listData.id;

    // Seed an item that TEST 5 will check off.
    const itemRes = await request.post(`${BACKEND_URL}/api/households/shopping/items`, {
      headers: h,
      data: { shoppingListId: listId, note: CHECK_ITEM_NOTE, checked: false, quantity: 0 },
    });
    const itemData = await itemRes.json();
    checkItemId = itemData.id;
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    // Each test navigates to its own starting URL after login.
  });

  test.afterAll(async ({ request }) => {
    const h = { Authorization: `Bearer ${token}` };
    // Try deletes in dependency order; ignore 404s (Playwright does not throw on HTTP errors).
    if (checkItemId)
      await request.delete(`${BACKEND_URL}/api/households/shopping/items/${checkItemId}`, { headers: h });
    if (listId)
      await request.delete(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, { headers: h });
    // Clean up the list created by TEST 2 via UI.
    await deleteListByName(request, NEW_LIST_NAME);
  });

  // ─── TEST 1 — Index page structure ────────────────────────────────────────────
  test('TEST 1 — Shopping Lists index shows heading, Show All checkbox, and Create button', async ({ page }) => {
    // disableRedirect prevents auto-navigation when only 1 list exists.
    await page.goto('/shopping-lists?disableRedirect=true');
    await page.waitForLoadState('networkidle');

    // BasePageTitle renders the title in an <h2>.
    await expect(page.getByRole('heading', { name: 'Shopping Lists' })).toBeVisible();
    // "Show All" checkbox (v-checkbox with label="Show All").
    await expect(page.getByLabel('Show All')).toBeVisible();
    // BaseButton create renders with text "Create" — scope to main to exclude the sidebar nav button.
    await expect(page.getByRole('main').getByRole('button', { name: 'Create' })).toBeVisible();
  });

  // ─── TEST 2 — Create a new list via the dialog ────────────────────────────────
  test('TEST 2 — creating a new list via the dialog adds it to the index', async ({ page }) => {
    await page.goto('/shopping-lists?disableRedirect=true');
    await page.waitForLoadState('networkidle');

    // Open the create dialog — scope to main to exclude the sidebar nav button.
    await page.getByRole('main').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Create Shopping List')).toBeVisible({ timeout: 5_000 });

    // Fill the list name and submit.
    await page.getByLabel('New List').fill(NEW_LIST_NAME);
    // The dialog's "Create" submit button is inside the active overlay.
    await page.locator('.v-overlay--active').getByRole('button', { name: 'Create' }).click();

    await page.waitForLoadState('networkidle');

    // New list card must appear in the index.
    await expect(
      page.locator('.v-card.left-border').filter({ hasText: NEW_LIST_NAME }),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ─── TEST 3 — Navigate to a seeded list ──────────────────────────────────────
  test('TEST 3 — clicking a list card navigates to its detail page', async ({ page }) => {
    await page.goto('/shopping-lists?disableRedirect=true');
    await page.waitForLoadState('networkidle');

    // The seeded list card must be visible.
    const listCard = page.locator('.v-card.left-border').filter({ hasText: LIST_NAME });
    await expect(listCard).toBeVisible({ timeout: 5_000 });

    // Click the list name span (not the icon buttons which have @click.prevent).
    await listCard.locator('span.flex-grow-1').click();
    await page.waitForURL('**/shopping-lists/**', { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Detail page: list name is shown as heading, "All Lists" back button is visible.
    await expect(page.getByRole('heading', { name: LIST_NAME })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('link', { name: 'All Lists' })).toBeVisible();
  });

  // ─── TEST 4 — Add an item to a list via the form ──────────────────────────────
  test('TEST 4 — adding an item via the form makes it appear in the list', async ({ page }) => {
    await page.goto(`/shopping-lists/${listId}`);
    await page.waitForLoadState('networkidle');

    // On desktop (viewport ≥ 600 px), the "Add item" InputLabelType field is shown.
    // Use getByRole('combobox') to target the input itself, not the "Clear Add item" icon button
    // which also matches getByLabel('Add item') via aria-label.
    await page.getByRole('combobox', { name: 'Add item' }).click();
    await page.waitForTimeout(300);

    // The full editor is now visible — fill in the Note field.
    await page.getByLabel('Note').fill(ADD_ITEM_NOTE);

    // Save is the last button in the editor's v-card-actions (BaseButtonGroup: cancel, save).
    await page.locator('.v-card-actions .v-btn').last().click();

    await page.waitForLoadState('networkidle');

    // The new item must appear in the list.
    await expect(page.getByText(ADD_ITEM_NOTE)).toBeVisible({ timeout: 10_000 });
  });

  // ─── TEST 5 — Checking an item moves it to the Checked Items panel ────────────
  test('TEST 5 — checking an item moves it to the Checked Items panel', async ({ page }) => {
    await page.goto(`/shopping-lists/${listId}`);
    await page.waitForLoadState('networkidle');

    // Confirm the seeded item is visible in the unchecked section.
    await expect(page.getByText(CHECK_ITEM_NOTE)).toBeVisible({ timeout: 10_000 });

    // ShoppingListItem renders each row as a v-row.
    // Find the row containing the item and click its v-checkbox.
    const itemRow = page.locator('.v-row').filter({ hasText: CHECK_ITEM_NOTE }).first();
    await expect(itemRow).toBeVisible();
    await itemRow.locator('.v-checkbox input[type="checkbox"]').click();

    // saveListItem makes a PUT request; wait for it to complete.
    await page.waitForLoadState('networkidle');

    // The "Checked Items" expansion panel now shows (v-if="listItems.checked.length > 0").
    // For exactly 1 checked item, the i18n plural renders "One item checked".
    await expect(page.getByText('One item checked')).toBeVisible({ timeout: 10_000 });
  });
});
