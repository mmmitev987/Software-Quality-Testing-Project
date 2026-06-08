import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BACKEND_URL, getToken } from './helpers';

// ─── Test data identifiers ────────────────────────────────────────────────────
const FOOD_A      = 'e2e-tomato';
const FOOD_B      = 'e2e-basil';
const RECIPE_NAME = 'e2e Tomato Basil Pasta';

// ─── Shared state (set in beforeAll, used in afterAll) ────────────────────────
let token      = '';
let foodAId    = '';
let foodBId    = '';
let recipeSlug = '';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

// Find and delete every food whose name exactly matches `name`.
async function deleteFoodByName(request: APIRequestContext, name: string): Promise<void> {
  const h = { Authorization: `Bearer ${token}` };
  const res = await request.get(
    `${BACKEND_URL}/api/foods?search=${encodeURIComponent(name)}&perPage=20`,
    { headers: h },
  );
  if (!res.ok()) return;
  const data = await res.json();
  for (const food of (data.items ?? [])) {
    if (food.name === name) {
      await request.delete(`${BACKEND_URL}/api/foods/${food.id}`, { headers: h });
    }
  }
}

// Navigate to the Recipe Finder page with FOOD_A pre-selected via localStorage.
// Used by TEST 4 and TEST 5 which need a guaranteed pre-selected state before
// testing other features (missing ingredient chip, adding missing food).
async function navigateWithFoodASelected(page: Page): Promise<void> {
  await page.evaluate((foodId) => {
    localStorage.setItem('recipe-finder-preferences', JSON.stringify({
      foodIds: [foodId],
      toolIds: [],
      queryFilter: '',
      queryFilterJSON: { parts: [] },
      maxMissingFoods: 20,
      maxMissingTools: 20,
      includeFoodsOnHand: true,
      includeToolsOnHand: true,
    }));
  }, foodAId);
  await page.goto('/g/home/recipes/finder');
  await page.waitForLoadState('networkidle');
  await expect(
    page.locator('.v-chip').filter({ hasText: FOOD_A, has: page.locator('.v-chip__close') }),
  ).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.waitForLoadState('networkidle');
}

// Navigate to the Recipe Finder page and select FOOD_A via the Foods filter UI.
//
// WHY SPA NAVIGATION INSTEAD OF page.goto():
//   In index.vue, `const foods = foodStore.store.value` runs at setup() time.
//   The food store's refresh() is async — it fires AFTER setup() captures an
//   empty []. So on any full-page load (page.goto()), foods = [] always.
//
//   page.goto() is a full page reload: it resets all JS module-level state
//   (store.value=[], initialized=false). Triple goto() does nothing useful.
//
//   The fix: load the finder once via goto() so the store refresh fires and
//   initialized=true. Then SPA-navigate via Vue Router (no page reload →
//   module state survives). On the SPA return, setup() reads initialized=true
//   → skips refresh() → foods = store.value = the already-populated array.
async function selectFoodAViaMenu(page: Page): Promise<void> {
  await page.evaluate(() => { localStorage.removeItem('recipe-finder-preferences'); });

  // Full page load: triggers the food store's initial refresh().
  await page.goto('/g/home/recipes/finder');
  await page.waitForLoadState('networkidle'); // /api/foods completes → initialized=true

  // SPA navigate away — module-level store state is preserved (no page reload).
  await page.evaluate(() => {
    const el = document.querySelector('#__nuxt');
    const router = (el as any)?.__vue_app__?.config?.globalProperties?.$router;
    if (router) router.push('/g/home');
  });
  await page.waitForURL('**/home', { timeout: 10_000 });

  // SPA navigate back — initialized=true → setup() skips refresh()
  // → foods = store.value = the populated array.
  await page.evaluate(() => {
    const el = document.querySelector('#__nuxt');
    const router = (el as any)?.__vue_app__?.config?.globalProperties?.$router;
    if (router) router.push('/g/home/recipes/finder');
  });
  await page.waitForURL('**/recipes/finder', { timeout: 10_000 });
  await page.waitForLoadState('networkidle');

  // Open the Foods filter menu.
  await page.getByRole('button', { name: 'Foods' }).click();
  await page.waitForTimeout(200);

  // Type in the search field (label "Search", i18n key search.search).
  // Scoped to the active overlay so we don't match a Tools menu if also rendered.
  await page.locator('.v-overlay--active').getByRole('textbox', { name: 'Search' }).fill(FOOD_A);

  // Wait for the "No results" alert to disappear — confirms filtered list has items.
  await expect(page.locator('.v-overlay--active').getByRole('alert')).not.toBeVisible({ timeout: 5_000 });

  // Click the v-checkbox-btn for the food item. After typing FOOD_A there is
  // exactly one .v-checkbox-btn visible in the overlay.
  await page.locator('.v-overlay--active').locator('.v-checkbox-btn').first().click();

  // Close the menu — SearchFilter uses :close-on-content-click="false".
  await page.keyboard.press('Escape');

  // Wait for watchDebounced (500 ms) + suggestion API response.
  await page.waitForTimeout(700);
  await page.waitForLoadState('networkidle');

  // Confirm the FOOD_A chip appeared in Selected Ingredients.
  await expect(
    page.locator('.v-chip').filter({ hasText: FOOD_A, has: page.locator('.v-chip__close') }),
  ).toBeVisible({ timeout: 10_000 });
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECIPE FINDER — ingredient-based recipe suggestions
//
//   beforeAll:  seed two foods (FOOD_A = e2e-tomato, FOOD_B = e2e-basil) and
//               one recipe that lists both as linked ingredients.
//               Clean up leftovers from any previous failed run first.
//   beforeEach: login; each test then navigates to the finder page itself
//               (with or without localStorage setup) to control the initial state.
//   afterAll:   delete the recipe and both foods.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Recipe Finder — ingredient-based recipe suggestions', () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ request }) => {
    test.setTimeout(60_000);

    token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const h = { Authorization: `Bearer ${token}` };

    // Clean up any leftover data from a previous failed run.
    await deleteFoodByName(request, FOOD_A);
    await deleteFoodByName(request, FOOD_B);
    await request.delete(`${BACKEND_URL}/api/recipes/e2e-tomato-basil-pasta`, { headers: h });

    // Create FOOD_A (e2e-tomato).
    const foodARes  = await request.post(`${BACKEND_URL}/api/foods`, { headers: h, data: { name: FOOD_A } });
    const foodAData = await foodARes.json();
    foodAId = foodAData.id;

    // Create FOOD_B (e2e-basil).
    const foodBRes  = await request.post(`${BACKEND_URL}/api/foods`, { headers: h, data: { name: FOOD_B } });
    const foodBData = await foodBRes.json();
    foodBId = foodBData.id;

    // Create the recipe, then link both foods as ingredients via PUT.
    // POST /api/recipes returns the slug string directly.
    recipeSlug = await (await request.post(`${BACKEND_URL}/api/recipes`, {
      headers: h,
      data: { name: RECIPE_NAME },
    })).json();

    const fullRecipe = await (await request.get(
      `${BACKEND_URL}/api/recipes/${recipeSlug}`,
      { headers: h },
    )).json();

    await request.put(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: h,
      data: {
        ...fullRecipe,
        recipeIngredient: [
          { note: '', quantity: 1, unit: null, food: { id: foodAId, name: FOOD_A }, isFood: true, display: `1 ${FOOD_A}` },
          { note: '', quantity: 1, unit: null, food: { id: foodBId, name: FOOD_B }, isFood: true, display: `1 ${FOOD_B}` },
        ],
      },
    });
  });

  // Login after each test reuse.  Each test handles its own navigation so it
  // can control whether localStorage preferences are set first.
  test.beforeEach(async ({ page }) => {
    await login(page);
    // After login the browser is on /g/home — same origin as the finder page.
    // Tests that need food pre-selection use page.evaluate() here to set
    // localStorage before navigating to /g/home/recipes/finder.
  });

  test.afterAll(async ({ request }) => {
    const h = { Authorization: `Bearer ${token}` };
    if (recipeSlug) await request.delete(`${BACKEND_URL}/api/recipes/${recipeSlug}`, { headers: h });
    if (foodAId)    await request.delete(`${BACKEND_URL}/api/foods/${foodAId}`, { headers: h });
    if (foodBId)    await request.delete(`${BACKEND_URL}/api/foods/${foodBId}`, { headers: h });
  });

  // ─── TEST 1 — Empty state ─────────────────────────────────────────────────────
  test('TEST 1 — initial page shows empty state with all controls', async ({ page }) => {
    // Ensure no food preferences are saved so the page starts in the empty state.
    await page.evaluate(() => { localStorage.removeItem('recipe-finder-preferences'); });
    await page.goto('/g/home/recipes/finder');
    await page.waitForLoadState('networkidle');

    // Use the heading role to disambiguate from the sidebar nav link.
    await expect(page.getByRole('heading', { name: 'Recipe Finder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Foods' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tools' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Other Filters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
    // Before any food is selected the page shows both empty-state messages.
    await expect(page.getByText('No ingredients selected')).toBeVisible();
    await expect(page.getByText('No recipes found')).toBeVisible();
  });

  // ─── TEST 2 — Select food from the Foods menu ────────────────────────────────
  test('TEST 2 — selecting a food from the Foods menu adds it to Selected Ingredients and shows recipes', async ({ page }) => {
    await selectFoodAViaMenu(page);

    await expect(page.getByText('Selected Ingredients')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('.v-chip').filter({ hasText: FOOD_A, has: page.locator('.v-chip__close') }),
    ).toBeVisible();
    await expect(page.getByText('No recipes found')).not.toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 3 — Remove the chip via the × button ───────────────────────────────
  test('TEST 3 — clicking the × on the Selected Ingredients chip restores the empty state', async ({ page }) => {
    await selectFoodAViaMenu(page);

    const selectedChip = page.locator('.v-chip').filter({
      hasText: FOOD_A,
      has: page.locator('.v-chip__close'),
    });
    await expect(selectedChip).toBeVisible({ timeout: 5_000 });
    await selectedChip.locator('.v-chip__close').click();
    await page.waitForTimeout(300);

    await expect(page.getByText('No ingredients selected')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('No recipes found')).toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 4 — Missing ingredient chip ────────────────────────────────────────
  test('TEST 4 — a recipe with a missing ingredient appears in "Almost Ready to Make" with a Missing chip', async ({ page }) => {
    // Only FOOD_A (e2e-tomato) is pre-selected.  The seeded recipe requires both
    // FOOD_A and FOOD_B (e2e-basil), so FOOD_B will be listed as a missing
    // ingredient.  maxMissingFoods defaults to 20, so 1 missing food is within
    // the threshold and the recipe appears in the "Almost Ready to Make" section.
    await navigateWithFoodASelected(page);

    await expect(page.getByText('Almost Ready to Make')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(RECIPE_NAME).first()).toBeVisible();

    // The "Missing" label and the FOOD_B chip must be visible on the recipe card.
    // Missing chips contain a v-checkbox (native input[type=checkbox]) — they do
    // NOT have a .v-chip__close button.
    await expect(page.getByText('Missing').first()).toBeVisible();
    await expect(
      page.locator('.v-chip').filter({
        hasText: FOOD_B,
        has: page.locator('input[type="checkbox"]'),
      }),
    ).toBeVisible();
  });

  // ─── TEST 5 — Click missing chip → food added to selection ───────────────────
  test('TEST 5 — clicking a missing ingredient chip adds it to Selected Ingredients', async ({ page }) => {
    // Reproduce the same state as TEST 4: only FOOD_A selected, FOOD_B missing.
    await navigateWithFoodASelected(page);

    await expect(page.getByText('Almost Ready to Make')).toBeVisible({ timeout: 10_000 });

    // Locate the missing FOOD_B chip (has a checkbox, no close button).
    const missingChip = page.locator('.v-chip').filter({
      hasText: FOOD_B,
      has: page.locator('input[type="checkbox"]'),
    });
    await expect(missingChip).toBeVisible();

    // Clicking the checkbox inside the chip calls handleCheckbox → addFood,
    // which pushes FOOD_B into selectedFoods.
    await missingChip.getByRole('checkbox').click();
    await page.waitForTimeout(300);

    // FOOD_B must now appear as a closable chip in the Selected Ingredients panel.
    await expect(
      page.locator('.v-chip').filter({
        hasText: FOOD_B,
        has: page.locator('.v-chip__close'),
      }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
