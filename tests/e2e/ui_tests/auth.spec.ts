/**
 * auth.spec.ts
 *
 * UI tests for authentication and onboarding flows in Mealie.
 * Covers: Login, Forgot Password, and the 6-step Setup Wizard.
 *
 * ─── Testing philosophy: real backend, no mocks (one narrow exception) ────────
 * Every browser network request reaches the real backend and database.
 * Test isolation is achieved through API calls, not route interception:
 *
 *   beforeEach — API calls that put the database in the exact state the test
 *                needs before the browser does anything.
 *
 *   afterEach  — API calls that reverse whatever writes the test made, so the
 *                next test starts from the same known database state.
 *
 * Validator tests (steps that call GET /api/validators/user/*):
 *   Instead of intercepting those calls and faking { valid: true }, we generate
 *   a timestamp-based username/email per run (e.g. testuser_1717000000000).
 *   Because those values have never been in the database, the real validator
 *   returns { valid: true } naturally. No cleanup is needed — navigating past
 *   Account Details does NOT create a user. The wizard only writes to the
 *   database when Submit is clicked on step 5.
 *
 * The one exception — seeder POST calls:
 *   POST /api/groups/seeders/{foods,units,labels} insert hundreds of bulk
 *   records and there is no API to delete them ("no unseed endpoint"). Because
 *   we cannot reverse these writes, we intercept only these three calls and
 *   return a fake 200 OK. Every other write in the wizard reaches the real backend.
 */

import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  WIZARD_NEW_USERNAME,
  WIZARD_NEW_EMAIL,
  WIZARD_NEW_PASSWORD,
  getToken,
  getSelf,
  restoreAdmin,
  mockSeeders,
  navigateToStep,
} from './helpers';


// ═══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Login', () => {

  // ─── Pre-condition guard ─────────────────────────────────────────────────────
  // Before every Login test we call the backend directly (not via the browser)
  // to confirm that ADMIN_EMAIL / ADMIN_PASSWORD match the current database.
  //
  // WHY: if any previous test changed the admin credentials without restoring
  // them, every Login test would fail mid-test with "Invalid Credentials" — a
  // confusing error that hides the real cause. This guard surfaces the problem
  // immediately, before the browser opens, with a clear recovery message.
  test.beforeEach(async ({ request }) => {
    try {
      await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    } catch {
      throw new Error(
        `\n\nPre-condition failed: cannot authenticate as "${ADMIN_EMAIL}".\n` +
        `ADMIN_EMAIL / ADMIN_PASSWORD do not match the current database state.\n\n` +
        `Most likely cause: the wizard Submit test ran and its afterEach (restoreAdmin)\n` +
        `did not complete — the admin credentials were changed but not restored.\n\n` +
        `To recover:\n` +
        `  1. Delete dev/data/mealie.db and dev/data/users/\n` +
        `  2. Restart the backend — it will reseed the default admin\n`,
      );
    }
  });

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email or Username', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
    // "Remember Me" extends session lifetime (48 h vs default short-lived token)
    await expect(page.getByLabel('Remember Me')).toBeVisible();
  });

  test('shows "Invalid Credentials" for wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill('wrongpassword');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page.getByText('Invalid Credentials')).toBeVisible({ timeout: 8000 });
  });

  test('shows "Invalid Credentials" for non-existent user', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or Username', { exact: true }).fill('nobody@example.com');
    await page.getByLabel('Password', { exact: true }).fill('SomePassword123');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    // Same message whether the email doesn't exist or the password is wrong.
    // Identical errors prevent user enumeration: an attacker can't tell which failed.
    await expect(page.getByText('Invalid Credentials')).toBeVisible({ timeout: 8000 });
  });

  test('stays on login page when submitting empty form', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    // Frontend validates locally before sending any request — URL stays at /login.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible();
  });

  test('valid credentials redirect away from login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('"Reset Password" button is visible and navigates to forgot password page', async ({ page }) => {
    await page.goto('/login');
    const resetBtn = page.getByRole('link', { name: 'Reset Password' });
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test('password field hides input by default', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  });

  test('password visibility toggle reveals the password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Password', { exact: true }).fill('testpass');
    // Walk up the DOM from the <input id="password"> to its v-field wrapper,
    // then find the toggle button inside that wrapper.
    await page.locator('[id="password"]')
      .locator('xpath=ancestor::div[contains(@class,"v-field")]')
      .getByRole('button')
      .click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// FORGOT PASSWORD
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Forgot Password', () => {

  test('page renders with email field and submit button', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send|reset|submit/i })).toBeVisible();
  });

  test('"Login" link navigates back to login page', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByRole('link', { name: /login/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// SETUP WIZARD
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Setup Wizard', () => {

  // ─── Step 1: Start page ───────────────────────────────────────────────────────
  // No backend calls happen on this step — pure static rendering.

  test('start page shows all stepper steps', async ({ page }) => { // test 11
    await page.goto('/admin/setup');
    await expect(page.getByText("Welcome to Mealie! Let's get started")).toBeVisible();
    await expect(page.getByText('Start').first()).toBeVisible();
    await expect(page.getByText('Account Details').first()).toBeVisible();
    await expect(page.getByText('Site Settings')).toBeVisible();
    await expect(page.getByText('AI Providers')).toBeVisible();
    await expect(page.getByText('Summary')).toBeVisible();
    await expect(page.getByText('Setup Complete!')).toBeVisible();
  });

  test('"already set up" link navigates away from setup', async ({ page }) => {
    await page.goto('/admin/setup');
    await page.getByRole('link', { name: "I'm already set up, just bring me to the homepage" }).click();
    await expect(page).not.toHaveURL(/\/admin\/setup/);
  });

  test('"Choose Language" button is visible on start page', async ({ page }) => {
    await page.goto('/admin/setup');
    await expect(page.getByRole('button', { name: 'Choose Language' })).toBeVisible();
  });

  test('"Choose Language" button opens a dialog; selecting German changes the page text to German', async ({ page }) => {
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Choose Language' }).click();
    await expect(page.getByText('Choose the language for the Mealie UI.')).toBeVisible({ timeout: 5000 });

    const combobox = page.locator('input[role="combobox"]');
    await combobox.click();
    // fill() replaces the current value ("American English"); type() would APPEND
    // to it, producing "American EnglishGerman" which matches nothing.
    await combobox.fill('German');

    // LanguageDialog.vue uses a custom #item slot with a native `title` attribute.
    // role="option" is not present on custom slot items, so we use the title selector.
    await page.waitForSelector('[title="Deutsch (German)"]', { timeout: 5000 });
    await page.locator('[title="Deutsch (German)"]').click();

    // LanguageDialog.vue watches locale and closes the dialog automatically on change.
    await expect(page.getByText('Choose the language for the Mealie UI.')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Willkommen bei Mealie! Lass uns loslegen')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Sprache wählen' })).toBeVisible();
  });

  // ─── Step 2: Account Details — frontend-only validation ──────────────────────
  // These tests click Next without valid data, so the frontend validation fires
  // before any network call is made. No backend state is needed or changed.

  test('"Next" navigates from Start to Account Details', async ({ page }) => { //test 15
    await page.goto('/admin/setup');
    // The v-stepper renders two "Next" buttons simultaneously (one per step window,
    // kept in DOM for CSS transitions). .last() targets the currently active one.
    await page.getByRole('button', { name: 'Next' }).last().click();
    await expect(page.locator('span.headline').filter({ hasText: 'Account Details' })).toBeVisible();
    await expect(page.getByLabel('Username').first()).toBeVisible();
  });

  test('Account Details shows required validation when Username is empty', async ({ page }) => {
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    // Click Next without filling anything — frontend validates locally, no network call.
    await page.getByRole('button', { name: 'Next' }).last().click();
    await expect(page.getByText('This Field is Required')).toBeVisible();
  });

  test('Account Details shows "Password is Weak" for weak password', async ({ page }) => {
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await page.getByLabel('Password').first().fill('weak');
    // The strength indicator reacts in real time — no need to click Next.
    await expect(page.getByText('Password is Weak')).toBeVisible();
  });

  test('Account Details shows "Password is Strong" for strong password', async ({ page }) => {
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    // Flagged words that score 0: "password", "mealie", "admin", "qwerty", "login".
    // "Tiger@42Blue!" avoids all of them.
    await page.getByLabel('Password').first().fill('Tiger@42Blue!');
    await expect(page.getByText(/Password is (Strong|Very Strong|Good)/)).toBeVisible();
  });

  test('Account Details shows all required fields', async ({ page }) => {
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await expect(page.getByLabel('Username').first()).toBeVisible();
    await expect(page.getByLabel('Full Name').first()).toBeVisible();
    await expect(page.getByLabel('Email').first()).toBeVisible();
    await expect(page.getByLabel('Password').first()).toBeVisible();
    await expect(page.getByLabel('Confirm Password').first()).toBeVisible();
    await expect(page.getByLabel('Enable Advanced Content')).toBeVisible();
  });

  test('"Back" button on Account Details returns to Start page', async ({ page }) => { //test 20
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText("Welcome to Mealie! Let's get started")).toBeVisible();
  });

  test('Account Details shows "Email Must Be Valid" when email format is invalid', async ({ page }) => {
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await page.getByLabel('Username').first().fill('testuser');
    await page.getByLabel('Full Name').first().fill('Test User');
    // "notanemail" has no @ or domain — the frontend email rule rejects it before
    // making any backend call, so no database state is needed.
    await page.getByLabel('Email').first().fill('notanemail');
    await page.getByLabel('Password').first().fill('Tiger@42Blue!');
    await page.getByLabel('Confirm Password').first().fill('Tiger@42Blue!');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await expect(page.getByText('Email Must Be Valid')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('span.headline').filter({ hasText: 'Account Details' })).toBeVisible();
  });

  test('Account Details shows "Password must match" when passwords differ and blocks Next', async ({ page }) => { //тест 22
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await page.getByLabel('Username').first().fill('testuser');
    await page.getByLabel('Full Name').first().fill('Test User');
    await page.getByLabel('Email').first().fill('testuser@example.com');
    await page.getByLabel('Password').first().fill('Tiger@42Blue!');
    // Deliberately different — the frontend passwordMatch rule fires before any backend call.
    await page.getByLabel('Confirm Password').first().fill('DifferentPass!99');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await expect(page.getByText('Password must match')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('span.headline').filter({ hasText: 'Account Details' })).toBeVisible();
  });

  // ─── Tests that navigate past Account Details ─────────────────────────────────
  // Clicking Next on a fully valid step 2 triggers real calls to:
  //   GET /api/validators/user/name?name=<value>
  //   GET /api/validators/user/email?email=<value>
  //
  // Instead of intercepting those calls we generate a timestamp-based username
  // and email per test (inside navigateToStep in helpers.ts). Because those values
  // have never been registered in the database, the real validator returns
  // { valid: true } without any mocking.
  //
  // No cleanup is needed after any of these tests: filling the form and clicking
  // Next does NOT persist anything. The wizard writes to the database ONLY when
  // Submit is clicked on step 5 (handled separately below).

  test('valid Account Details allows Next to advance to Site Settings', async ({ page }) => { //23
    // Unique per run — guaranteed not to be in the database.
    const run = Date.now();
    await page.goto('/admin/setup');
    await page.getByRole('button', { name: 'Next' }).last().click();
    await page.getByLabel('Username').first().fill(`testuser_${run}`);
    await page.getByLabel('Full Name').first().fill('Valid User');
    await page.getByLabel('Email').first().fill(`testuser_${run}@example.com`);
    await page.getByLabel('Password').first().fill('Tiger@42Blue!');
    await page.getByLabel('Confirm Password').first().fill('Tiger@42Blue!');
    // Real GET /api/validators/user/* is called here — both return { valid: true }.
    await page.getByRole('button', { name: 'Next' }).last().click();
    await expect(
      page.getByText('Here are some common settings for new sites')
    ).toBeVisible({ timeout: 8000 });
  });

  test('Site Settings step renders correctly with toggle fields', async ({ page }) => {
    await navigateToStep(page, 'siteSettings');
    await expect(page.getByText('Enable Public Access')).toBeVisible();
    await expect(page.getByText('Use Seed Data')).toBeVisible();
  });

  test('AI Providers step renders correctly with its section heading', async ({ page }) => {
    await navigateToStep(page, 'aiProviders');
    await expect(
      page.locator('.headline').filter({ hasText: 'AI Providers' })
    ).toBeVisible({ timeout: 8000 });
  });

  test('Summary step renders user data and a Submit button', async ({ page }) => {//26
    const { username, email, fullName } = await navigateToStep(page, 'summary');

    // Check the labels in the confirmation list.
    // .v-list-item-title only appears on the confirmation list rows in the Summary step.
    // The same text ("Email", "Username", "Full Name") also appears as floating labels
    // on the Account Details form — which is kept in the DOM with eager rendering but
    // marked hidden. Using this class avoids matching those hidden duplicates.
    await expect(page.locator('.v-list-item-title').filter({ hasText: 'Email' })).toBeVisible();
    await expect(page.locator('.v-list-item-title').filter({ hasText: 'Username' })).toBeVisible();
    await expect(page.locator('.v-list-item-title').filter({ hasText: 'Full Name' })).toBeVisible();

    // Check that the actual values entered in Account Details appear in the summary.
    // This verifies the wizard carries the data through to the confirmation step,
    // not just that the labels exist.
    // exact: true on username — otherwise it also matches the email element (which
    // contains the username as a substring, e.g. "testuser_123@example.com").
    await expect(page.getByText(username, { exact: true })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByText(fullName, { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
  });


  // ─── Submit: the only wizard test that makes real write calls ─────────────────
  //
  // Grouped in its own nested describe so its beforeEach/afterEach hooks run only
  // for this one test and not for every wizard test above.
  //
  // What wizard Submit actually does (all real except seeders):
  //   PUT /api/users/password              — changes admin password to WIZARD_NEW_PASSWORD
  //   PUT /api/users/{id}                  — changes admin username, email, fullName
  //   PUT /api/admin/groups/{id}           — updates group privacy setting
  //   PUT /api/admin/households/{id}       — updates household privacy setting
  //   PUT /api/groups/ai-providers/settings — saves AI provider config
  //   POST /api/groups/seeders/*           — intercepted by mockSeeders() (see helpers.ts)
  //
  // Seeder exception:
  //   The three POST /api/groups/seeders/* calls are the ONLY intercepted requests.
  //   They insert bulk records with no delete API — there is no way to reverse them.
  //   Everything else (password, user fields, group, household, AI settings) hits the
  //   real backend.
  //
  // Group / household / AI settings:
  //   These writes reach the real backend but are NOT restored by afterEach. The auth
  //   tests in this file do not depend on those settings, so leaving them changed does
  //   not break any test here. If another test file cares about those settings it
  //   should manage its own setup/teardown.
  //
  // beforeEach:
  //   1. Verifies the admin has ADMIN_PASSWORD. setup.vue hardcodes that string as
  //      currentPassword — if the admin has a different password the PUT returns 401.
  //   2. Saves the full admin user object (id, username, email, fullName, …) so
  //      afterEach can spread it back into the restore PUT and return every field
  //      to its exact original value.
  //
  // afterEach:
  //   Calls restoreAdmin() (from helpers.ts), which authenticates with WIZARD_NEW_*
  //   and walks back:
  //     1. Restore password   (while still authenticated as WIZARD_NEW_EMAIL)
  //     2. Restore all user fields  (username, email, fullName, etc.)
  //   After afterEach, the database is in the same state as before the test ran.
  //   The next Login test's beforeEach guard will verify this.

  test.describe('Submit (real writes + afterEach teardown)', () => {

    // Null until beforeEach sets it. afterEach checks for null before restoring
    // so that a beforeEach failure (admin in wrong state) doesn't cause a
    // double-failure in afterEach when restoreAdmin tries to use an undefined id.
    let originalAdminUser: Record<string, any> | null = null;

    test.beforeEach(async ({ request }) => {
      originalAdminUser = null; // reset in case a previous run left stale state

      // Verify the admin is in the expected pre-test state and snapshot the user object.
      // setup.vue hardcodes currentPassword: "MyPassword" — if the admin's actual
      // password is different, the wizard's PUT /api/users/password will return 401
      // and the test fails mid-way with a confusing error. We catch it here first.
      let token: string;
      try {
        token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      } catch {
        throw new Error(
          `\n\nPre-condition failed: admin is not in the expected state.\n` +
          `Expected email="${ADMIN_EMAIL}", password="${ADMIN_PASSWORD}".\n\n` +
          `Likely cause: a previous run's afterEach (restoreAdmin) did not complete.\n` +
          `The admin credentials were changed by the wizard but not fully restored.\n\n` +
          `To recover:\n` +
          `  1. Delete dev/data/mealie.db and dev/data/users/\n` +
          `  2. Restart the backend to reseed the default admin\n`,
        );
      }

      // Snapshot the full admin user object BEFORE the test changes anything.
      // afterEach spreads this back into the PUT so every field is restored exactly.
      originalAdminUser = await getSelf(request, token);
    });

    test.afterEach(async ({ request }) => {
      // If beforeEach threw before setting originalAdminUser, the test did not run
      // and nothing was written to the database. Skip the restore.
      if (originalAdminUser === null) return;

      // Reverse the admin-account changes the wizard Submit made.
      // restoreAdmin() handles the case where Submit was never reached (test failed
      // at an earlier step) by trying WIZARD_NEW_* first and returning early if those
      // credentials don't authenticate.
      await restoreAdmin(request, originalAdminUser);
    });

    test('completing the wizard shows "Setup Complete!" and a Home button that navigates away', async ({ page }) => {
      // Register the seeder mock before navigating anywhere. Route intercepts are
      // active for the entire lifetime of the page object, so registering early
      // ensures the mock is in place before Submit fires any seeder POST.
      await mockSeeders(page);

      // Log in so auth.user.value is populated with a real session.
      // setup.vue reads auth.user.value!.id, .groupId, and .householdId directly
      // in JavaScript before making any API call. A JavaScript null-dereference
      // happens synchronously — Playwright's route intercepts fire on network
      // requests, not on JS execution. We must be logged in so those fields are
      // non-null before the Submit handler runs.
      await page.goto('/login');
      await page.getByLabel('Email or Username', { exact: true }).fill(ADMIN_EMAIL);
      await page.getByLabel('Password', { exact: true }).fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

      await page.goto('/admin/setup');

      // Step 1 → Step 2 (Account Details)
      await page.getByRole('button', { name: 'Next' }).last().click();

      // Fill with WIZARD_NEW_* — fixed values so afterEach always knows which
      // credentials to authenticate with when calling restoreAdmin().
      // The real GET /api/validators/user/* is called when Next is clicked below.
      // If WIZARD_NEW_USERNAME or WIZARD_NEW_EMAIL is already in the DB (a failed
      // teardown from a previous run left them there), the validator will return
      // { valid: false } and Next will be blocked. Fix by resetting the database.
      await page.getByLabel('Username').first().fill(WIZARD_NEW_USERNAME);
      await page.getByLabel('Full Name').first().fill('Setup Test');
      await page.getByLabel('Email').first().fill(WIZARD_NEW_EMAIL);
      await page.getByLabel('Password').first().fill(WIZARD_NEW_PASSWORD);
      await page.getByLabel('Confirm Password').first().fill(WIZARD_NEW_PASSWORD);

      // Step 2 → Step 3 (Site Settings). Real validator called here.
      await page.getByRole('button', { name: 'Next' }).last().click();
      await expect(
        page.getByText('Here are some common settings for new sites')
      ).toBeVisible({ timeout: 8000 });

      // Step 3 → Step 4 (AI Providers)
      await page.getByRole('button', { name: 'Next' }).last().click();
      await expect(
        page.locator('.headline').filter({ hasText: 'AI Providers' })
      ).toBeVisible({ timeout: 8000 });

      // Step 4 → Step 5 (Summary)
      await page.getByRole('button', { name: 'Next' }).last().click();
      await expect(page.getByText('How does everything look?')).toBeVisible({ timeout: 8000 });

      // Click Submit — submitAll() fires:
      //   PUT /api/users/password             → real backend  (changes password)
      //   PUT /api/users/{id}                 → real backend  (changes username/email)
      //   PUT /api/admin/groups/{id}          → real backend  (changes group settings)
      //   PUT /api/admin/households/{id}      → real backend  (changes household settings)
      //   PUT /api/groups/ai-providers/settings → real backend
      //   POST /api/groups/seeders/*          → intercepted by mockSeeders()
      //
      // After all promises resolve, setup.vue increments the stepper to step 6.
      // afterEach (restoreAdmin) will reverse the admin credential changes.
      await page.getByRole('button', { name: 'Submit' }).click();

      // "Here are a few things to help you get started" is ONLY in EndPageContent.vue
      // (the step 6 window). The stepper header always shows "Setup Complete!" from
      // step 1 onwards, so that text alone would pass even if the wizard was stuck
      // on step 4. We use this body-text to confirm the wizard genuinely reached step 6.
      await expect(
        page.getByText('Here are a few things to help you get started')
      ).toBeVisible({ timeout: 20000 });

      const homeBtn = page.getByRole('button', { name: 'Home' });
      await expect(homeBtn).toBeVisible({ timeout: 5000 });
      await homeBtn.click();
      await expect(page).not.toHaveURL(/\/admin\/setup/, { timeout: 10000 });

      // afterEach runs next — restoreAdmin() resets the admin back to ADMIN_* defaults.
    });
  });
});
