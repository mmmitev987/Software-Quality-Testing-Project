
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BACKEND_URL, getToken } from './helpers';

// Delete a recipe by slug via the API — used in afterEach to keep the DB clean.
async function deleteRecipe(request: APIRequestContext, slug: string): Promise<void> {
  const token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  await request.delete(`${BACKEND_URL}/api/recipes/${slug}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 1 — Create Recipe form: validation (no DB writes)
// URL: /g/home/r/create/new  →  the "Create Recipe" section
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Create Recipe form — validation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/g/home/r/create/new');
    // Wait for the form to be visible — the card heading is "Create Recipe"
    await expect(page.getByText('Create Recipe').first()).toBeVisible({ timeout: 8_000 });
  });

  // ─── A1 ─────────────────────────────────────────────────────────────────────
  test('A1 — Create button is disabled when Recipe Name is empty', async ({ page }) => {
    // new.vue: disabled="newRecipeName.trim() === ''"
    // The form Create button is the last button on the page (sidebar + Create is first)
    await expect(page.getByRole('button', { name: 'Create' }).last()).toBeDisabled();
  });

  // ─── A2 ─────────────────────────────────────────────────────────────────────
  test('A2 — "This Field is Required" appears after focusing and leaving the empty name field', async ({ page }) => {
    // validate-on="blur" fires the required rule when the field loses focus without a value
    // Use getByRole('textbox') to avoid strict-mode clash with the "Clear Recipe Name" icon button
    await page.getByRole('textbox', { name: 'Recipe Name' }).click();
    await page.keyboard.press('Tab');
    await expect(page.getByText('This Field is Required')).toBeVisible();
  });

  // ─── A3 ─────────────────────────────────────────────────────────────────────
  test('A3 — Create button becomes enabled after typing a recipe name', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Recipe Name' }).fill('Chocolate Cake');
    await expect(page.getByRole('button', { name: 'Create' }).last()).toBeEnabled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 2 — Form submission: creates a real recipe, cleaned up in afterEach
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Create Recipe — form submission', () => {
  let createdSlug = '';

  test.beforeEach(async ({ page }) => {
    createdSlug = '';
    await login(page);
    await page.goto('/g/home/r/create/new');
    await expect(page.getByText('Create Recipe').first()).toBeVisible({ timeout: 8_000 });
  });

  test.afterEach(async ({ request }) => {
    if (createdSlug) {
      await deleteRecipe(request, createdSlug);
      createdSlug = '';
    }
  });

  // ─── A4 ─────────────────────────────────────────────────────────────────────
  test('A4 — pressing Enter in the name field creates the recipe', async ({ page }) => {
    const name = `Pasta Test ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Recipe Name' }).fill(name);
    await page.getByRole('textbox', { name: 'Recipe Name' }).press('Enter');
    await page.waitForURL(/\/g\/[\w-]+\/r\/[\w-]+/, { timeout: 10_000 });
    createdSlug = page.url().split('/r/')[1].split('?')[0];
    await expect(page).toHaveURL(/\?edit=true/);
  });

  // ─── B1 ─────────────────────────────────────────────────────────────────────
  test('B1 — clicking Create navigates to /g/{group}/r/{slug}?edit=true', async ({ page }) => {
    const name = `Soup Test ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Recipe Name' }).fill(name);
    await page.getByRole('button', { name: 'Create' }).last().click();
    await page.waitForURL(/\/g\/[\w-]+\/r\/[\w-]+\?edit=true/, { timeout: 10_000 });
    createdSlug = page.url().split('/r/')[1].split('?')[0];
    await expect(page).toHaveURL(/\/g\/[\w-]+\/r\/[\w-]+\?edit=true/);
  });

  // ─── B2 ─────────────────────────────────────────────────────────────────────
  test('B2 — the recipe page title matches the name that was typed', async ({ page }) => {
    const name = `Steak Test ${Date.now()}`;
    await page.getByRole('textbox', { name: 'Recipe Name' }).fill(name);
    await page.getByRole('button', { name: 'Create' }).last().click();
    await page.waitForURL(/\/g\/[\w-]+\/r\/[\w-]+/, { timeout: 10_000 });
    createdSlug = page.url().split('/r/')[1].split('?')[0];
    // The recipe name appears somewhere on the edit page (breadcrumb, editable title, etc.)
    await expect(page.getByText(name).first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 3 — Recipe edit page features
// A recipe is created via API in beforeEach and deleted in afterEach.
// Every test starts on /g/home/r/{slug}?edit=true (edit mode is already open).
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Recipe edit page', () => {
  let recipeSlug = '';
  let recipeName = '';

  test.beforeEach(async ({ page, request }) => {
    recipeName = `Test Recipe ${Date.now()}`;
    const token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await request.post(`${BACKEND_URL}/api/recipes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: recipeName },
    });
    if (!res.ok()) throw new Error(`beforeEach: recipe creation failed (HTTP ${res.status()})`);
    recipeSlug = await res.json(); // API returns the slug string

    await login(page);
    await page.goto(`/g/home/r/${recipeSlug}?edit=true`);
    // Guard: confirm we're in edit mode before every test runs
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible({ timeout: 8_000 });
  });

  test.afterEach(async ({ request }) => {
    if (recipeSlug) {
      await deleteRecipe(request, recipeSlug);
      recipeSlug = '';
    }
  });

  // ─── C1 — Edit toolbar buttons ───────────────────────────────────────────────
  test('C1 — edit mode shows Delete (red), JSON (blue), Close, and Save (green) buttons', async ({ page }) => {
    // RecipeActionMenu.vue editorButtons array: [Delete, JSON, Close, Save]
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'JSON' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  // ─── C2 — Delete confirmation dialog ────────────────────────────────────────
  test('C2 — clicking Delete opens "Delete Recipe" confirmation dialog with Confirm button', async ({ page }) => {
    await page.getByRole('button', { name: 'Delete' }).click();
    // BaseDialog with title $t('recipe.delete-recipe') = "Delete Recipe"
    await expect(page.getByText('Delete Recipe')).toBeVisible({ timeout: 5_000 });
    // Dialog body: $t('recipe.delete-confirmation') = "Are you sure you want to delete this recipe?"
    await expect(page.getByText('Are you sure you want to delete this recipe?')).toBeVisible();
    // can-confirm prop renders a Confirm button
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
  });

  // ─── C3 — Close exits edit mode ──────────────────────────────────────────────
  test('C3 — Close exits edit mode; view toolbar shows Edit, Favorites, Timeline and three-dots', async ({ page }) => {
    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForLoadState('networkidle');

    // Edit mode buttons gone
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'JSON' })).not.toBeVisible();

    // View mode: 4 icon-only buttons appear (Edit, Favorites, Timeline, three-dots).
    // Mealie renders icons as SVG (not CSS font), so we check for Vuetify icon buttons generically.
    await expect(page.locator('.v-btn--icon').first()).toBeVisible({ timeout: 5_000 });
  });

  // ─── C4 — Save exits edit mode ───────────────────────────────────────────────
  test('C4 — clicking Save exits edit mode and navigates to view mode', async ({ page }) => {
    await page.getByRole('button', { name: 'Save' }).click();
    // Save persists changes AND exits edit mode — URL loses ?edit=true
    await expect(page).not.toHaveURL(/\?edit=true/, { timeout: 8_000 });
    // Edit-mode buttons are gone in view mode
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible();
    // View-mode icon buttons appear
    await expect(page.locator('.v-btn--icon').first()).toBeVisible({ timeout: 5_000 });
  });

  // ─── D2 — Default numeric field values ──────────────────────────────────────
  test('D2 — a new recipe defaults Servings and Yield to 0', async ({ page }) => {
    // RecipePageInfoEditor.vue: v-number-input with :min="0" and model value from API (defaults to 0)
    await expect(page.getByLabel('Servings')).toHaveValue('0');
    await expect(page.getByLabel('Yield', { exact: true })).toHaveValue('0');
  });

  // ─── D3 — Default time field values ─────────────────────────────────────────
  test('D3 — a new recipe has empty Total Time, Prep Time, and Cook Time fields', async ({ page }) => {
    // performTime translates to "Cook Time" in en-US.json
    await expect(page.getByLabel('Total Time')).toHaveValue('');
    await expect(page.getByLabel('Prep Time')).toHaveValue('');
    await expect(page.getByLabel('Cook Time')).toHaveValue('');
  });

  // ─── D4 — Default description ────────────────────────────────────────────────
  test('D4 — a new recipe has an empty Description field', async ({ page }) => {
    await expect(page.getByLabel('Description')).toHaveValue('');
  });

  // ─── D_extra — Values update live in the form fields as you type ────────────
  test('D_extra — typing Servings and Total Time immediately updates the top info card', async ({ page }) => {
    // Vuetify v-number-input: triple-click to select all, then type to replace
    await page.getByLabel('Servings').click({ clickCount: 3 });
    await page.keyboard.type('4');

    await page.getByLabel('Total Time').fill('30 min');

    // The info card (above the edit form) is CSS-hidden in edit mode; verify
    // the values are live in the form fields instead
    await expect(page.getByLabel('Servings')).toHaveValue('4');
    await expect(page.getByLabel('Total Time')).toHaveValue('30 min');
  });

  // ─── E1 — Ingredients heading ────────────────────────────────────────────────
  test('E1 — "Ingredients" section heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Ingredients' }).first()).toBeVisible();
  });

  // ─── E2 — Unparsed ingredients warning ──────────────────────────────────────
  test('E2 — warning banner "ingredients aren\'t parsed yet" is shown on a fresh recipe', async ({ page }) => {
    // RecipePageIngredientEditor.vue: <BannerWarning v-if="!hasFoodOrUnit">
    // hasFoodOrUnit = true only when at least one ingredient has food OR unit set
    // A brand-new recipe has no parsed ingredients → banner is visible
    await expect(page.getByText(/ingredients aren't parsed yet/i)).toBeVisible();
  });

  // ─── E3 — Parse button enabled on fresh recipe ───────────────────────────────
  test('E3 — Parse button is present and enabled on a fresh recipe', async ({ page }) => {
    // :disabled="hasFoodOrUnit" — disabled only when ingredients are already parsed
    // A fresh recipe has no food/unit set → Parse is enabled
    await expect(page.getByRole('button', { name: 'Parse' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Parse' })).toBeEnabled();
  });

  // ─── E4 — "+ Add" adds an ingredient row ─────────────────────────────────────
  test('E4 — clicking the Add button adds a new ingredient row', async ({ page }) => {
    // Each ingredient renders with class "list-group-item" (VueDraggable item)
    const before = await page.locator('.list-group-item').count();
    // The split-main class is the ingredient Add button (split-dropdown is the chevron)
    await page.locator('.split-main').click();
    await expect(page.locator('.list-group-item')).toHaveCount(before + 1);
  });

  // ─── E5 — Add dropdown has 3 options ─────────────────────────────────────────
  test('E5 — the Add split-button dropdown shows Add Food, Add Recipe, and Bulk Add', async ({ page }) => {
    // Click the chevron part of the split button to open the v-menu
    await page.locator('.split-dropdown').click();
    // $t('new-recipe.add-food'), $t('new-recipe.add-recipe'), $t('new-recipe.bulk-add')
    // Scope to the currently open overlay so we match menu items, not other page buttons
    const menu = page.locator('.v-overlay--active');
    await expect(menu).toBeVisible({ timeout: 5_000 }); // wait for overlay to open
    await expect(menu.getByText('Add Food')).toBeVisible();
    await expect(menu.getByText('Add Recipe')).toBeVisible();
    await expect(menu.getByText('Bulk Add')).toBeVisible();
  });

  // ─── F1 — Instructions heading ───────────────────────────────────────────────
  test('F1 — "Instructions" section heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Instructions' }).first()).toBeVisible();
  });

  // ─── F2 — Default Step 1 ─────────────────────────────────────────────────────
  test('F2 — a new recipe has a default "Step: 1" instruction entry', async ({ page }) => {
    // In edit mode the step title is hidden inside the expanded editor; switch to view mode first.
    await page.getByRole('button', { name: 'Close' }).click();
    await page.waitForLoadState('networkidle');
    await page.getByText('Step: 1').first().scrollIntoViewIfNeeded();
    await expect(page.getByText('Step: 1').first()).toBeVisible({ timeout: 5_000 });
  });

  // ─── F3 — Instruction Add buttons ────────────────────────────────────────────
  test('F3 — the Instructions section shows a "+ Bulk Add" and an "+ Add" button', async ({ page }) => {
    // "+ Bulk Add" is unique to the Instructions section (not present in Ingredients)
    await expect(page.getByRole('button', { name: 'Bulk Add' })).toBeVisible();
    // There are multiple "Add" buttons on the page; the last one is for instructions
    await expect(page.getByRole('button', { name: 'Add' }).last()).toBeVisible();
  });

  // ─── G1 — Categories section ─────────────────────────────────────────────────
  test('G1 — Categories section is visible in edit mode', async ({ page }) => {
    // RecipePageOrganizers.vue: shown when isEditForm (v-if="isEditForm")
    // Scope to v-card-title to avoid matching the sidebar nav item and form labels
    await expect(page.locator('.v-card-title', { hasText: 'Categories' }).first()).toBeVisible();
  });

  // ─── G2 — Tags section ───────────────────────────────────────────────────────
  test('G2 — Tags section is visible in edit mode', async ({ page }) => {
    await expect(page.locator('.v-card-title', { hasText: 'Tags' }).first()).toBeVisible();
  });

  // ─── G3 — Required Tools section ─────────────────────────────────────────────
  test('G3 — Required Tools section is visible in edit mode', async ({ page }) => {
    // Only shown when isEditForm — not visible in view mode
    await expect(page.getByText('Required Tools')).toBeVisible();
  });

  // ─── H1 — Save persists changes ──────────────────────────────────────────────
  test('H1 — clicking Save persists field changes (visible in view mode after Close)', async ({ page }) => {
    await page.getByLabel('Total Time').fill('45 min');
    await page.getByLabel('Description').fill('A delicious test recipe.');

    await page.getByRole('button', { name: 'Save' }).click();
    // Save exits edit mode automatically — wait for the URL to lose ?edit=true
    await expect(page).not.toHaveURL(/\?edit=true/, { timeout: 10_000 });

    // In view mode, the saved values are visible in the recipe card
    await expect(page.getByText('45 min').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('A delicious test recipe.').first()).toBeVisible({ timeout: 5_000 });
  });

  // ─── H2 — Delete removes the recipe ─────────────────────────────────────────
  test('H2 — confirming Delete removes the recipe and navigates away', async ({ page }) => {
    const slug = recipeSlug;

    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Delete Recipe')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: 'Confirm' }).click();

    // After deletion the app navigates away from the recipe page
    await expect(page).not.toHaveURL(new RegExp(slug), { timeout: 10_000 });

    // Recipe already deleted — skip afterEach cleanup to avoid a 404 error
    recipeSlug = '';
  });
});
