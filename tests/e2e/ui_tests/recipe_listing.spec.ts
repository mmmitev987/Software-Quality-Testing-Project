import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BACKEND_URL, getToken } from './helpers';

// ─── Test data identifiers ────────────────────────────────────────────────────
const CAT_NAME = 'e2e-cat-pasta';
const TAG_NAME = 'e2e-tag-vegan';
// Names chosen so that A < B < C alphabetically (AAA, MMM, ZZZ) — used in TEST 5.
const RECIPE_A = 'e2e AAA Pasta Carbonara'; // assigned category CAT_NAME
const RECIPE_B = 'e2e MMM Green Smoothie';  // assigned tag TAG_NAME
const RECIPE_C = 'e2e ZZZ Beef Stew';       // no category / tag — "noise" recipe

// ─── Shared state (set in beforeAll, used in afterAll) ────────────────────────
let token = '';
let catId  = '';
let tagId  = '';
let slugA  = '';
let slugB  = '';
let slugC  = '';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

// Find and delete every category whose name exactly matches `name`.
async function deleteCategoryByName(request: APIRequestContext, name: string): Promise<void> {
  const h = { Authorization: `Bearer ${token}` };
  const res = await request.get(
    `${BACKEND_URL}/api/organizers/categories?search=${encodeURIComponent(name)}&perPage=20`,
    { headers: h },
  );
  if (!res.ok()) return;
  const data = await res.json();
  for (const cat of (data.items ?? [])) {
    if (cat.name === name) {
      await request.delete(`${BACKEND_URL}/api/organizers/categories/${cat.id}`, { headers: h });
    }
  }
}

// Find and delete every tag whose name exactly matches `name`.
async function deleteTagByName(request: APIRequestContext, name: string): Promise<void> {
  const h = { Authorization: `Bearer ${token}` };
  const res = await request.get(
    `${BACKEND_URL}/api/organizers/tags?search=${encodeURIComponent(name)}&perPage=20`,
    { headers: h },
  );
  if (!res.ok()) return;
  const data = await res.json();
  for (const tag of (data.items ?? [])) {
    if (tag.name === name) {
      await request.delete(`${BACKEND_URL}/api/organizers/tags/${tag.id}`, { headers: h });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECIPE LISTING — search, filter, sort, random
//
//   beforeAll:  seed three recipes + one category + one tag via API.
//               Clean up any leftovers from a previous failed run first.
//   beforeEach: login and navigate to the recipes listing page /g/home.
//   afterAll:   delete all seeded data.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Recipe listing — search, filter, sort and random', () => {
  test.setTimeout(60_000);

  test.beforeAll(async ({ request }) => {
    test.setTimeout(60_000);

    token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const h = { Authorization: `Bearer ${token}` };

    // Clean up any leftover data from a previous failed run.
    await deleteCategoryByName(request, CAT_NAME);
    await deleteTagByName(request, TAG_NAME);
    for (const slug of ['e2e-aaa-pasta-carbonara', 'e2e-mmm-green-smoothie', 'e2e-zzz-beef-stew']) {
      await request.delete(`${BACKEND_URL}/api/recipes/${slug}`, { headers: h });
    }

    // Create the category and tag.
    const catRes  = await request.post(`${BACKEND_URL}/api/organizers/categories`, { headers: h, data: { name: CAT_NAME } });
    const catData = await catRes.json();
    catId = catData.id;

    const tagRes  = await request.post(`${BACKEND_URL}/api/organizers/tags`, { headers: h, data: { name: TAG_NAME } });
    const tagData = await tagRes.json();
    tagId = tagData.id;

    // Create recipe A and assign the category.
    slugA = await (await request.post(`${BACKEND_URL}/api/recipes`, { headers: h, data: { name: RECIPE_A } })).json();
    const fullA = await (await request.get(`${BACKEND_URL}/api/recipes/${slugA}`, { headers: h })).json();
    await request.put(`${BACKEND_URL}/api/recipes/${slugA}`, {
      headers: h,
      data: { ...fullA, recipeCategory: [{ id: catId, name: catData.name, slug: catData.slug }] },
    });

    // Create recipe B and assign the tag.
    slugB = await (await request.post(`${BACKEND_URL}/api/recipes`, { headers: h, data: { name: RECIPE_B } })).json();
    const fullB = await (await request.get(`${BACKEND_URL}/api/recipes/${slugB}`, { headers: h })).json();
    await request.put(`${BACKEND_URL}/api/recipes/${slugB}`, {
      headers: h,
      data: { ...fullB, tags: [{ id: tagId, name: tagData.name, slug: tagData.slug }] },
    });

    // Create recipe C — no category, no tag.
    slugC = await (await request.post(`${BACKEND_URL}/api/recipes`, { headers: h, data: { name: RECIPE_C } })).json();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto('/g/home');
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(async ({ request }) => {
    const h = { Authorization: `Bearer ${token}` };
    for (const slug of [slugA, slugB, slugC].filter(Boolean)) {
      await request.delete(`${BACKEND_URL}/api/recipes/${slug}`, { headers: h });
    }
    if (catId) await request.delete(`${BACKEND_URL}/api/organizers/categories/${catId}`, { headers: h });
    if (tagId) await request.delete(`${BACKEND_URL}/api/organizers/tags/${tagId}`, { headers: h });
  });

  // ─── TEST 1 — Search bar ─────────────────────────────────────────────────────
  test('TEST 1 — search box shows only recipes whose name matches the query', async ({ page }) => {
    // Mealie's recipe search does full-text token matching (OR logic), so
    // searching the full RECIPE_A name would also match RECIPE_C via the
    // shared "e2e" prefix.  "Carbonara" is a token that exists only in
    // RECIPE_A's name, making it a reliable discriminating search term.
    //
    // Navigate with ?search= in the URL — this is the canonical way to
    // pre-set search state (hydrateSearch() reads it on mount) and is
    // equivalent to what the search box writes after a user types.
    await page.goto('/g/home?search=Carbonara');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(RECIPE_A).first()).toBeVisible({ timeout: 10_000 });
    // RECIPE_C ("e2e ZZZ Beef Stew") has no overlap with "Carbonara" — it
    // must not appear in the filtered results.
    await expect(page.getByText(RECIPE_C)).not.toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 2 — Category filter ────────────────────────────────────────────────
  test('TEST 2 — Categories filter shows only recipes in the selected category', async ({ page }) => {
    // Open the Categories dropdown.  close-on-content-click is false so it
    // stays open after clicking a checkbox.
    await page.getByRole('button', { name: 'Categories' }).click();
    // The v-checkbox-btn inside the v-list-item must be clicked directly —
    // clicking only the title text does NOT toggle the Vuetify checkbox.
    const catItem = page.locator('.v-list-item').filter({ hasText: CAT_NAME });
    await expect(catItem).toBeVisible({ timeout: 5_000 });
    await catItem.getByRole('checkbox').click();
    await page.keyboard.press('Escape');
    // The filter triggers a debounced (500 ms) search — wait for debounce + fetch.
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // RECIPE_A has the category → must be visible.
    await expect(page.getByText(RECIPE_A).first()).toBeVisible({ timeout: 10_000 });
    // RECIPE_C has no category at all → must not appear.
    await expect(page.getByText(RECIPE_C)).not.toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 3 — Tag filter ─────────────────────────────────────────────────────
  test('TEST 3 — Tags filter shows only recipes with the selected tag', async ({ page }) => {
    // Same checkbox-click pattern as TEST 2.
    await page.getByRole('button', { name: 'Tags' }).click();
    const tagItem = page.locator('.v-list-item').filter({ hasText: TAG_NAME });
    await expect(tagItem).toBeVisible({ timeout: 5_000 });
    await tagItem.getByRole('checkbox').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // RECIPE_B has the tag → must be visible.
    await expect(page.getByText(RECIPE_B).first()).toBeVisible({ timeout: 10_000 });
    // RECIPE_C has no tag → must not appear.
    await expect(page.getByText(RECIPE_C)).not.toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 4 — Random button ──────────────────────────────────────────────────
  test('TEST 4 — Random button navigates to a recipe page', async ({ page }) => {
    // The "Random" button (dice icon) lives in the "Recipes" section header.
    // Clicking it picks a random recipe and pushes /g/{group}/r/{slug}.
    await page.getByRole('button', { name: 'Random' }).click();
    await page.waitForURL(/\/g\/[\w-]+\/r\/[\w-]+/, { timeout: 10_000 });

    // We should now be on a recipe detail page, not the listing.
    await expect(page).not.toHaveURL(/\/g\/home$/);
  });

  // ─── TEST 5 — Alphabetical sort ──────────────────────────────────────────────
  test('TEST 5 — Alphabetical sort orders recipe cards A → Z', async ({ page }) => {
    // Step 1: Switch sort field to Alphabetical (still in default DESC direction).
    // The button label changes to "Alphabetical" confirming the field change.
    await page.getByRole('button', { name: 'Created' }).click();
    await page.locator('.v-overlay--active').getByText('Alphabetical').click();
    await expect(page.getByRole('button', { name: 'Alphabetical' })).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Step 2: Toggle direction to ascending (A→Z).  The dropdown now shows
    // "Sort Ascending" because current direction is desc.
    await page.getByRole('button', { name: 'Alphabetical' }).click();
    await page.locator('.v-overlay--active').getByText('Sort Ascending').click();
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Step 3: Narrow to just the three test recipes so the order check is
    // not affected by unrelated recipes or pagination.
    const searchBox = page.getByPlaceholder('Search...');
    await searchBox.click();
    await searchBox.pressSequentially('e2e', { delay: 50 });
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    // Both boundary recipes must be visible.
    await expect(page.getByText(RECIPE_A).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(RECIPE_C).first()).toBeVisible({ timeout: 10_000 });

    // The grid layout may place all three e2e cards in the same row (same Y),
    // so compare DOM order instead of bounding-box Y coordinates.
    // In A→Z order RECIPE_A must appear earlier in the DOM than RECIPE_C.
    const allTitles = await page.locator('.v-card-title').allTextContents();
    const indexA = allTitles.findIndex(t => t.includes(RECIPE_A));
    const indexC = allTitles.findIndex(t => t.includes(RECIPE_C));
    expect(indexA).not.toBe(-1);
    expect(indexC).not.toBe(-1);
    expect(indexA).toBeLessThan(indexC);
  });
});
