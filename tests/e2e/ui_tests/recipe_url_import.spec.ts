// ═══════════════════════════════════════════════════════════════════════════════
// recipe_url_import.spec.ts
//
// End-to-end tests for the "Import recipe from URL" feature in Mealie.
// The tests are organised into two describe blocks (Block 2 and Block 3) that
// share a single scraped recipe so the real external HTTP request to the recipe
// website is made only ONCE — in Block 2's beforeAll — instead of once per test.
//
// WHAT IS BEING TESTED:
//   Block 2 — The "Ingredient Parser" dialog that opens right after a URL is
//              scraped.  It lets the user review and correct the NLP-parsed
//              ingredients before they are saved.
//   Block 3 — The recipe view page that the user lands on after the dialog is
//              dismissed.  Checks that the scraped data (title, times, serves,
//              ingredients, instructions) is visible.
//
// HOW THE SHARED RECIPE WORKS:
//   Block 2's beforeAll scrapes the URL and stores the resulting recipe slug
//   in the module-level `sharedSlug` variable.  Block 3's beforeEach reads the
//   same variable to navigate directly to the already-scraped recipe.
//   Block 3's afterAll is responsible for deleting the recipe when all tests
//   are done (Block 2 intentionally has no afterAll for this purpose).
//
// WHY A REAL EXTERNAL URL:
//   The URL scraper (Mealie's /api/recipes/create/url endpoint) fetches the
//   external page, runs HTML → recipe extraction, and then runs the NLP
//   ingredient parser.  There is no reliable way to stub all three phases
//   without significant infrastructure changes, so we hit the real URL.
//   The 90-second timeout on the scrape step absorbs slow network conditions.
// ═══════════════════════════════════════════════════════════════════════════════

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BACKEND_URL, getToken } from './helpers';

// ─── Constants ────────────────────────────────────────────────────────────────

// The external recipe URL that is submitted to Mealie's scraper.
// This page is a well-known recipe that reliably contains "bittersweet chocolate"
// as an ingredient — a food that is NOT in Mealie's default food database, which
// means the NLP parser will leave it unrecognised.  That unrecognised state is
// exactly what TEST 8, TEST 10, and TEST 11 depend on.
const SCRAPE_URL = 'https://preppykitchen.com/molten-chocolate-cake/';

// The specific ingredient we check for in the parser dialog.
// It must be absent from the database before each test so that
// the "Create missing food" button always appears (TEST 10 & 11).
// The afterEach in Block 2 deletes it after every test to restore that state.
const SCRAPED_FOOD  = 'bittersweet chocolate';

// ─── Shared state ─────────────────────────────────────────────────────────────

// The slug of the recipe that is scraped once in Block 2's beforeAll and then
// reused in every subsequent test.  A slug looks like "molten-chocolate-cake".
// It is extracted from the browser URL after scraping and passed to page.goto()
// in beforeEach hooks instead of re-triggering the full scrape each time.
// Block 3's afterAll clears it back to '' after deleting the recipe.
let sharedSlug = '';

// ─── Helper: login ────────────────────────────────────────────────────────────
// Navigates to the login page, fills in the admin credentials, clicks Login,
// and waits until the browser is no longer on /login (i.e. redirect completed).
// Reused in every beforeAll / beforeEach that needs an authenticated session.
async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
  // exact: true prevents matching "Login" inside longer strings like "Login with SSO"
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  // Verify the redirect away from /login happened within 10 seconds.
  // This also acts as an implicit wait — subsequent actions run only after login
  // is confirmed complete.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

// ─── Helper: deleteRecipe ─────────────────────────────────────────────────────
// Deletes a recipe by its URL slug via the REST API.
// Called in Block 3's afterAll to clean up the shared recipe once all tests
// have finished.  A 404 response (recipe already gone) is silently ignored
// because Playwright's request fixture does not throw on HTTP error codes.
async function deleteRecipe(request: APIRequestContext, slug: string): Promise<void> {
  const token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  await request.delete(`${BACKEND_URL}/api/recipes/${slug}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── Helper: deleteFoodByName ─────────────────────────────────────────────────
// Searches the foods API for any food whose name exactly matches `name`
// (case-insensitive) and deletes every match.
//
// WHY SEARCH FIRST INSTEAD OF DELETING BY A KNOWN ID:
//   The food is created by clicking "Create missing food" in the UI (TEST 11)
//   or as a side-effect of the NLP parser.  We never capture its ID — we only
//   know its name.  The search endpoint returns up to `perPage` results; we
//   then filter client-side to ensure exact name matches and delete each one.
//
// WHY THIS IS CALLED IN MULTIPLE PLACES:
//   • Block 2's beforeAll — removes any stale "bittersweet chocolate" left by
//     a previous failed test run (cleanup-first strategy).
//   • Block 2's beforeEach — ensures the food is absent before every test so
//     that the parser dialog always shows an unrecognised ingredient.
//   • Block 2's afterEach  — removes any food the test may have created.
//   • Block 3's afterAll   — final safety cleanup.
async function deleteFoodByName(request: APIRequestContext, name: string): Promise<void> {
  const token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
  const res = await request.get(
    `${BACKEND_URL}/api/foods?search=${encodeURIComponent(name)}&perPage=20`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // If the GET fails (e.g. network error), bail out — we don't want cleanup
  // failures to mask real test failures.
  if (!res.ok()) return;
  const data = await res.json();
  for (const food of (data.items ?? [])) {
    // Double-check with an exact case-insensitive match because the search
    // endpoint does partial matching and may return foods like
    // "dark bittersweet chocolate" alongside the exact one we want.
    if (food.name?.toLowerCase() === name.toLowerCase()) {
      await request.delete(`${BACKEND_URL}/api/foods/${food.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
}

// ─── Helper: goToUrlFormAndSubmit ─────────────────────────────────────────────
// Navigates to the URL import form, types the recipe URL, verifies the
// "Parse ingredients" checkbox is checked, and submits the form.
//
// IMPORTANT — WHY WE USE getByRole('textbox') INSTEAD OF getByLabel:
//   The URL input is a Vuetify v-text-field that renders both the input element
//   and a "Clear Recipe URL" icon button.  Both have an accessible name derived
//   from the label text "Recipe URL", so getByLabel('Recipe URL') would match
//   two elements and Playwright's strict-mode would throw an error.
//   getByRole('textbox', { name: 'Recipe URL' }) narrows the match to only the
//   actual text input (role=textbox), avoiding the strict-mode violation.
//
// IMPORTANT — WHY WE WAIT FOR /recipe_import_url=/ IN THE URL:
//   The import form uses a Vuetify v-text-field bound with v-model.  When the
//   user types in the field, the Vue component calls router.replace() to write
//   the value into the query string as ?recipe_import_url=<value>.  The form's
//   submit handler reads recipeUrl from route.query (not from v-model directly),
//   so if we press Enter before router.replace() has flushed, route.query still
//   returns null and createByUrl() exits early without ever calling the API.
//   Waiting for the URL to contain "recipe_import_url=" guarantees the query
//   string is populated before we submit.
async function goToUrlFormAndSubmit(page: Page): Promise<void> {
  await page.goto('/g/home/r/create/url');
  // Wait for the page to be ready — the heading "Scrape Recipe" confirms the
  // form component has mounted.
  await expect(page.getByText('Scrape Recipe')).toBeVisible({ timeout: 8_000 });

  const urlInput = page.getByRole('textbox', { name: 'Recipe URL' });
  await urlInput.fill(SCRAPE_URL);

  // Wait for Vue's v-model setter to flush the URL into the browser query string.
  // Without this, router.replace() is still in-flight and the form handler
  // reads an empty recipeUrl and silently does nothing on Enter.
  await page.waitForURL(/recipe_import_url=/, { timeout: 5_000 });

  // The "Parse recipe ingredients after import" checkbox enables the NLP parser.
  // It should be checked by default, but we verify and check it defensively
  // in case the user's saved preferences have it turned off.
  const parseCheckbox = page.getByLabel('Parse recipe ingredients after import');
  if (!(await parseCheckbox.isChecked())) {
    await parseCheckbox.check();
  }

  // Submit the form with Enter — equivalent to clicking the "Import" button.
  // This triggers createByUrl(), which POSTs to /api/recipes/create/url and
  // then navigates to the new recipe page with ?parse=true appended to the URL.
  await urlInput.press('Enter');
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 2 — Ingredient Parser Dialog
//
// This block tests the dialog that appears immediately after a URL is scraped.
// The dialog shows each parsed ingredient one at a time, lets the user review
// the NLP output (quantity, unit, food, confidence score), and offers controls
// to create missing foods, delete items, and navigate between ingredients.
//
// ARCHITECTURE — SCRAPE ONCE, REUSE MANY:
//   Scraping the external URL takes 10–90 seconds (network + NLP processing).
//   Repeating that for every test would make the suite prohibitively slow and
//   brittle (external network dependency per test).
//
//   Instead, beforeAll scrapes ONCE, extracts the recipe slug from the resulting
//   URL, and stores it in `sharedSlug`.  Each beforeEach then navigates directly
//   to that existing recipe with ?parse=true in the query string.  The Mealie
//   frontend reads the ?parse=true flag on mount and opens the parser dialog
//   immediately — no re-scrape needed.
//
// FOOD MANAGEMENT:
//   "bittersweet chocolate" is the test ingredient.  It must be ABSENT from
//   the database before every test so that the dialog shows it as unrecognised
//   (the alert icon appears, "Choose Food" is empty, "Create missing food"
//   button is shown).  The beforeEach deletes the food before every test and
//   afterEach deletes it again after (in case the test created it).
//
// LIFECYCLE:
//   beforeAll  → scrape URL once, extract slug into sharedSlug
//   beforeEach → delete food, login, navigate to recipe with ?parse=true
//   afterEach  → delete food (cleans up what TEST 11 creates)
//   afterAll   → (none — Block 3's afterAll owns the recipe deletion)
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Recipe import via URL — ingredient parser dialog', () => {
  // 120 seconds covers: up to 90 s for the external scrape + login overhead.
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);

    // Create a temporary browser context that is separate from the test contexts.
    // This prevents the beforeAll session cookies and localStorage from leaking
    // into the individual test pages.
    const ctx = await browser.newContext();

    // Clean up any leftover food from a previous failed run before we start.
    // This ensures the food is absent when the scrape happens, so no pre-existing
    // food accidentally satisfies the NLP match and hides the alert icon.
    await deleteFoodByName(ctx.request, SCRAPED_FOOD);

    const page = await ctx.newPage();
    await login(page);

    // Submit the URL import form.  After pressing Enter, Mealie calls
    // POST /api/recipes/create/url, which fetches and parses the external page.
    await goToUrlFormAndSubmit(page);

    // Wait for the parser dialog to open.  The scrape can take up to 90 seconds
    // on a slow network, hence the large timeout.  Once the dialog is visible
    // we know the recipe was created successfully and ?parse=true is active.
    await expect(page.getByText('Ingredient Parser')).toBeVisible({ timeout: 90_000 });

    // Extract the recipe slug from the current URL.
    // After scraping, the browser is at a URL like:
    //   /g/home/r/molten-chocolate-cake?parse=true
    // The regex captures the slug segment (e.g. "molten-chocolate-cake").
    // sharedSlug is used in beforeEach for both Block 2 and Block 3 to navigate
    // directly to this recipe without re-scraping.
    const match = page.url().match(/\/g\/[\w-]+\/r\/([^/?#]+)/);
    sharedSlug = match ? match[1] : '';

    // Close the temporary context — its session is no longer needed.
    await ctx.close();
  });

  test.beforeEach(async ({ page, request }) => {
    // Delete "bittersweet chocolate" before every test.
    // If the food exists, the NLP parser would auto-match it and the
    // "Choose Food" field would be pre-filled, hiding the alert icon and the
    // "Create missing food" button — breaking TEST 8, 10, and 11.
    await deleteFoodByName(request, SCRAPED_FOOD);

    await login(page);

    // Navigate directly to the already-scraped recipe with ?parse=true.
    // The Mealie frontend checks for this flag in its onMounted hook and
    // immediately opens the Ingredient Parser dialog, replicating the exact
    // state the user sees right after a URL import — without a new network
    // request to the external site.
    await page.goto(`/g/home/r/${sharedSlug}?parse=true`);

    // Wait for the dialog to be fully open before each test starts.
    await expect(page.getByText('Ingredient Parser')).toBeVisible({ timeout: 15_000 });
  });

  test.afterEach(async ({ request }) => {
    // TEST 11 clicks "Create missing food", which creates "bittersweet chocolate"
    // in the database.  Remove it after every test so the next beforeEach
    // always starts with the food absent.
    await deleteFoodByName(request, SCRAPED_FOOD);
  });

  // ─── TEST 6 ───────────────────────────────────────────────────────────────────
  // Verifies that the Ingredient Parser dialog opens after submitting a URL.
  // Since beforeEach already navigates to the recipe with ?parse=true and waits
  // for the dialog, this test is essentially a "smoke test" that confirms the
  // dialog and its success message are both visible together.
  test('TEST 6 — after submitting a URL the Ingredient Parser dialog opens', async ({ page }) => {
    // The dialog title is "Ingredient Parser" — confirm it is present.
    await expect(page.getByText('Ingredient Parser')).toBeVisible();

    // The subtitle confirms the NLP parse completed successfully.
    // exact: false allows the assertion to match even if the full sentence
    // includes extra punctuation or whitespace.
    await expect(
      page.getByText('Your ingredients have been successfully parsed.', { exact: false })
    ).toBeVisible();
  });

  // ─── TEST 7 ───────────────────────────────────────────────────────────────────
  // Verifies that "Natural Language Processor" is the default parser shown in
  // the dialog.  Mealie supports multiple parsers (NLP, Brute Force, etc.) and
  // the NLP one should be pre-selected when ?parse=true opens the dialog.
  test('TEST 7 — Natural Language Processor is the default selected parser', async ({ page }) => {
    await expect(page.getByText('Natural Language Processor')).toBeVisible();
  });

  // ─── TEST 8 ───────────────────────────────────────────────────────────────────
  // Verifies the visual state for an ingredient the NLP parser could NOT match
  // to an existing food in the database.
  //
  // Expected UI state for an unrecognised food:
  //   1. The raw ingredient text is visible (e.g. "2 oz bittersweet chocolate").
  //   2. The "Choose Food" autocomplete is empty — no food was auto-selected.
  //   3. An alert/warning icon (class "mr-n3 opacity-100") is shown next to the
  //      food field — the component sets food-error=true when foodId is missing.
  //
  // The food was deleted in beforeEach, so the NLP re-parse cannot find a match.
  test('TEST 8 — unrecognized food shows an alert icon and empty "Choose Food" field', async ({ page }) => {
    // The ingredient text "bittersweet chocolate" appears inside the dialog.
    // Use .first() because the text may appear more than once on the page
    // (e.g. in the ingredient list preview AND the current-ingredient form).
    await expect(page.getByText(/bittersweet chocolate/i).first()).toBeVisible();

    // The food autocomplete field is empty because no matching food exists.
    // Placeholder "Choose Food" is the unfilled state of the food selector.
    await expect(page.getByPlaceholder('Choose Food')).toHaveValue('');

    // The alert icon is rendered with class "ml-2 mr-n3 opacity-100" when
    // the food-error prop is true on the ingredient editor component.
    // .first() avoids a strict-mode violation if multiple ingredients show errors.
    await expect(page.locator('.mr-n3.opacity-100').first()).toBeVisible();
  });

  // ─── TEST 9 ───────────────────────────────────────────────────────────────────
  // Verifies that the NLP confidence score is displayed for the current ingredient.
  // The confidence score tells the user how certain the parser is about its
  // interpretation (e.g. "93.00%").  A percentage sign in the text is sufficient
  // evidence that the score is being rendered.
  test('TEST 9 — the confidence score is displayed for the current ingredient', async ({ page }) => {
    // The label "Confidence Score" (or similar text) must be visible.
    // exact: false allows for slight phrasing differences.
    await expect(page.getByText('Confidence Score', { exact: false })).toBeVisible();

    // At least one text element must contain a "%" character, confirming the
    // numeric score value is rendered alongside the label.
    await expect(page.getByText(/%/).first()).toBeVisible();
  });

  // ─── TEST 10 ──────────────────────────────────────────────────────────────────
  // Verifies that the "+ Create missing food" button is visible when the NLP
  // parser could not match the current ingredient to a known food.
  //
  // This button only appears when TWO conditions are both true:
  //   • currentMissingFood is truthy (NLP produced a food name string from the
  //     ingredient text, but no matching food record exists in the database).
  //   • currentIng.ingredient.food?.id is falsy (no food has been selected yet).
  //
  // Since we deleted "bittersweet chocolate" in beforeEach, both conditions hold.
  test('TEST 10 — "+ Create missing food" button is visible when food is unrecognized', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create missing food/i })).toBeVisible();
  });

  // ─── TEST 11 ──────────────────────────────────────────────────────────────────
  // Verifies that clicking "+ Create missing food" creates the food in the
  // database and auto-selects it in the ingredient form, which causes the button
  // to disappear (because the second condition — food?.id is falsy — is no longer
  // true once a food record is created and linked).
  //
  // afterEach cleans up the created food so the next test starts fresh.
  test('TEST 11 — clicking "+ Create missing food" creates the food and removes the button', async ({ page }) => {
    const createFoodBtn = page.getByRole('button', { name: /create missing food/i });
    await expect(createFoodBtn).toBeVisible();

    // Click the button.  This POSTs a new food to /api/foods and then sets
    // the food reference on the current ingredient inside the dialog.
    await createFoodBtn.click();

    // Once the food is created and auto-selected, the component re-evaluates
    // the v-if condition: currentMissingFood && !currentIng.ingredient.food?.id.
    // food?.id is now truthy, so the button disappears.
    // Timeout of 5 s covers the async API call to create the food.
    await expect(createFoodBtn).not.toBeVisible({ timeout: 5_000 });
  });

  // ─── TEST 12 ──────────────────────────────────────────────────────────────────
  // Verifies that the "Next" navigation button is present and clickable in the
  // dialog.  "Next" steps through the ingredients one by one.  It must be enabled
  // (not disabled) so the user can always move forward regardless of whether
  // the current ingredient has unresolved issues.
  test('TEST 12 — the "Next" button is visible and enabled in the dialog', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: 'Next', exact: true });
    await expect(nextBtn).toBeVisible();
    await expect(nextBtn).toBeEnabled();
  });

  // ─── TEST 13 ──────────────────────────────────────────────────────────────────
  // Verifies that clicking OUTSIDE the dialog dismisses it and leaves the user
  // on the recipe view page (not in edit mode).
  //
  // WHY page.mouse.click(10, 10):
  //   Vuetify's dialog listens for @click:outside events via the v-overlay
  //   component.  The event is only triggered by a genuine pointer-down event
  //   outside the dialog card.  Clicking at coordinates (10, 10) — the top-left
  //   corner of the viewport — is guaranteed to be outside the centred dialog
  //   card regardless of the dialog's size.
  //   Using page.keyboard.press('Escape') is an alternative but tests a different
  //   code path.  This test specifically exercises the outside-click handler.
  //
  // EXPECTED STATE AFTER DISMISS:
  //   • The dialog text "Ingredient Parser" is gone.
  //   • The URL matches the recipe view pattern (/g/{group}/r/{slug}).
  //   • The URL does NOT contain ?edit=true — the user lands in view mode.
  test('TEST 13 — clicking outside the dialog dismisses it and lands on the recipe page', async ({ page }) => {
    // Simulate a click at the very top-left of the viewport (outside any dialog).
    await page.mouse.click(10, 10);

    // The dialog must disappear within 8 seconds.
    await expect(page.getByText('Ingredient Parser')).not.toBeVisible({ timeout: 8_000 });

    // After dismissal, the browser should be on the recipe view URL.
    await page.waitForURL(/\/g\/[\w-]+\/r\/[\w-]+/, { timeout: 15_000 });

    // Confirm the user is NOT in edit mode — the dialog dismiss must not trigger
    // the edit flow.
    await expect(page).not.toHaveURL(/\?edit=true/);
  });

  // ─── TEST 14 ──────────────────────────────────────────────────────────────────
  // Verifies that the "Delete Item" checkbox is present in the dialog.
  // This checkbox lets the user mark the current ingredient for deletion so it
  // will not be included when the dialog is confirmed.  Its presence confirms
  // the per-ingredient controls are fully rendered.
  test('TEST 14 — the "Delete Item" checkbox is present in the dialog', async ({ page }) => {
    await expect(page.getByLabel('Delete Item')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCK 3 — Recipe View Mode After URL Import
//
// This block tests the recipe page that the user sees after dismissing the
// Ingredient Parser dialog.  It verifies that the scraped data was correctly
// persisted and is displayed in the standard recipe view layout.
//
// ARCHITECTURE:
//   beforeEach navigates directly to the recipe (same `sharedSlug` used in
//   Block 2) WITHOUT ?parse=true, so the parser dialog does NOT open.
//   We are testing the view mode of the recipe page, not the import flow.
//
// LIFECYCLE:
//   beforeEach → login, navigate to recipe in view mode (no ?parse=true)
//   afterAll   → delete the shared recipe and clean up any remaining food.
//                This is the ONLY afterAll that deletes the recipe — Block 2
//                intentionally has no afterAll to avoid a race condition where
//                the recipe is deleted before Block 3's tests run.
// ═══════════════════════════════════════════════════════════════════════════════
test.describe('Recipe import via URL — view mode result', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await login(page);

    // Navigate to the scraped recipe in plain view mode.
    // No ?parse=true → the parser dialog does not open.
    await page.goto(`/g/home/r/${sharedSlug}`);

    // Wait for the URL to match the recipe view pattern before each test starts.
    // This confirms the page loaded successfully and did not redirect elsewhere.
    await page.waitForURL(/\/g\/[\w-]+\/r\/[\w-]+/, { timeout: 15_000 });
  });

  test.afterAll(async ({ browser }) => {
    // Use a temporary browser context (same pattern as Block 2's beforeAll)
    // so cleanup does not interfere with any still-open test page contexts.
    const ctx = await browser.newContext();

    // Delete the shared recipe that was created in Block 2's beforeAll.
    // Guard with an if-check so afterAll is safe to call even if beforeAll
    // never succeeded (e.g. if the test run was aborted early).
    if (sharedSlug) {
      await deleteRecipe(ctx.request, sharedSlug);
      // Reset to empty string so any accidental afterAll re-runs are safe.
      sharedSlug = '';
    }

    // Final safety cleanup — remove the food in case TEST 11 ran last and
    // Block 2's afterEach did not execute (e.g. due to test runner abort).
    await deleteFoodByName(ctx.request, SCRAPED_FOOD);

    await ctx.close();
  });

  // ─── TEST 17 ──────────────────────────────────────────────────────────────────
  // Verifies that the recipe info card shows timing fields and a servings badge.
  // These values are scraped from the source page's structured metadata
  // (schema.org/Recipe: prepTime, cookTime, totalTime, recipeYield).
  //
  // WHY .first():
  //   Mealie renders the same info card at two different layout breakpoints
  //   (mobile and desktop) using CSS visibility, so each label appears TWICE in
  //   the DOM simultaneously.  getByText() without .first() would match two
  //   elements and trigger Playwright's strict-mode error.  Using .first()
  //   asserts that at least one of the duplicates is visible.
  test('TEST 17 — recipe info card shows Total Time, Prep Time, Cook Time and Serves X', async ({ page }) => {
    await expect(page.getByText('Total Time').first()).toBeVisible();
    await expect(page.getByText('Prep Time').first()).toBeVisible();
    await expect(page.getByText('Cook Time').first()).toBeVisible();
    // "Serves X" renders as "Serves 4" or "Serves 12" depending on the recipe.
    // The regex /serves \d+/i matches any servings count case-insensitively.
    await expect(page.getByText(/serves \d+/i).first()).toBeVisible();
  });

  // ─── TEST 20 ──────────────────────────────────────────────────────────────────
  // Verifies that the Ingredients section heading is present and at least one
  // ingredient is listed.  Checking for multiple common baking ingredient names
  // with a single regex avoids the test failing if the scraped recipe's exact
  // wording changes slightly between scrapes (e.g. "unsalted butter" vs "butter").
  test('TEST 20 — Ingredients section has a heading and at least one listed ingredient', async ({ page }) => {
    // The section heading "Ingredients" is rendered as an <h2> element.
    await expect(page.getByRole('heading', { name: 'Ingredients' })).toBeVisible();

    // At least one common baking ingredient should be visible.
    // The regex matches any of: butter, chocolate, egg, sugar, flour.
    // .first() avoids strict-mode errors if the same word appears multiple times
    // (e.g. "chocolate" in the title AND the ingredient list).
    await expect(page.getByText(/butter|chocolate|egg|sugar|flour/i).first()).toBeVisible();
  });

  // ─── TEST 23 ──────────────────────────────────────────────────────────────────
  // Verifies that the Instructions section exists and at least 3 steps were
  // scraped from the source page.  A multi-step recipe confirms the scraper
  // correctly parsed the instructions array (not just a single blob of text).
  //
  // WHY "Step: 1", "Step: 2", "Step: 3":
  //   Mealie renders instruction steps with the format "Step: N" as a
  //   step-number label before each instruction block.  Checking three separate
  //   step labels confirms the first three steps were scraped and persisted.
  //
  // WHY .first():
  //   Same reason as TEST 17 — dual-layout rendering duplicates elements in DOM.
  test('TEST 23 — at least 3 instruction steps are visible', async ({ page }) => {
    // The "Instructions" heading confirms the section exists.
    await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible();

    // Confirm steps 1, 2, and 3 are all rendered.
    await expect(page.getByText('Step: 1').first()).toBeVisible();
    await expect(page.getByText('Step: 2').first()).toBeVisible();
    await expect(page.getByText('Step: 3').first()).toBeVisible();
  });
});
