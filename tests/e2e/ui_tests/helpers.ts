/**
 * helpers.ts
 *
 * Shared utilities for the Mealie e2e test suite.
 * Imported by auth.spec.ts (and any future spec files that test auth flows).
 *
 * Contains:
 *   - Backend URL and admin credential constants
 *   - API helpers: getToken, getSelf, restoreAdmin
 *   - Browser helpers: mockSeeders, navigateToStep
 */

import { expect, APIRequestContext, Page } from '@playwright/test';

// ─── Server address ───────────────────────────────────────────────────────────
// The Nuxt frontend (port 3000) does NOT proxy /api/ — the browser fetches the
// backend directly at port 9000. API helpers in this file use BACKEND_URL for
// direct Node.js calls; browser-based requests use the baseURL from playwright.config.ts.
export const BACKEND_URL = 'http://localhost:9000';

// ─── Default admin credentials (fresh-DB state) ───────────────────────────────
// After `docker compose up`, the backend seeds these defaults.
// Every test that modifies the admin account must restore it to these values
// in afterEach so Login tests always find the database in this state.
//
// IMPORTANT — ADMIN_PASSWORD must equal the value that setup.vue hardcodes as
// currentPassword when calling PUT /api/users/password (see setup.vue line ~454).
// That file sends currentPassword: "MyPassword" unconditionally. If the admin's
// real password differs, the wizard Submit returns 401 mid-test.
export const ADMIN_EMAIL    = 'changeme@example.com';
export const ADMIN_PASSWORD = 'MyPassword'; // must equal setup.vue's hardcoded currentPassword

// ─── Credentials the wizard Submit test types into the Account Details form ───
// Fixed (not random) so afterEach always knows which credentials to authenticate
// with when restoring. After Submit the admin has these values; afterEach then
// resets the admin back to ADMIN_*.
export const WIZARD_NEW_USERNAME = 'setuptest';
export const WIZARD_NEW_EMAIL    = 'setuptest@example.com';
export const WIZARD_NEW_PASSWORD = 'Tiger@42Blue!';


// ═══════════════════════════════════════════════════════════════════════════════
// API HELPERS
//
// These run at the Node.js level, not inside the browser. Playwright's `request`
// fixture (type APIRequestContext) is a raw HTTP client that operates
// independently of the page — it sends requests directly from Node.js to the
// backend, bypassing the Nuxt frontend entirely.
// ═══════════════════════════════════════════════════════════════════════════════

// Get a Bearer token via the OAuth2 password-grant endpoint.
// Sends the email + password to the backend and receives a short-lived token
// string in return. All subsequent API calls attach this token to the
// Authorization header so the server knows who is making the request.
export async function getToken(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/api/auth/token`, {
    form: { username: email, password, grant_type: 'password' },
  });
  if (!res.ok()) throw new Error(`getToken: "${email}" → HTTP ${res.status()}`);
  return (await res.json()).access_token;
}

// Fetch the full user object for whoever owns the token.
// We call this in beforeEach to snapshot the admin's state (id, username, email,
// fullName, groupId, householdId, admin flag, …) before the test touches anything.
// afterEach spreads that snapshot into the restore PUT so every field is returned
// to its original value.
export async function getSelf(
  request: APIRequestContext,
  token: string,
): Promise<Record<string, any>> {
  const res = await request.get(`${BACKEND_URL}/api/users/self`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

// Reverse the admin-account writes that the wizard Submit makes.
// Called by afterEach in the Submit describe block.
//
// The wizard changes two things on the admin account:
//   1. password  via PUT /api/users/password
//   2. username, email, fullName  via PUT /api/users/{id}
//
// We cannot use ADMIN_EMAIL/ADMIN_PASSWORD to authenticate here because the
// wizard already changed them. The restore order is:
//   Step 1 — authenticate with WIZARD_NEW_* (the credentials the wizard just set)
//   Step 2 — restore the password (admin email is still WIZARD_NEW_EMAIL here)
//   Step 3 — get a fresh token (password is now ADMIN_PASSWORD, email unchanged)
//   Step 4 — restore username, email, and all other user fields
//
// If step 1 fails (WIZARD_NEW_* are not valid), the test never reached Submit so
// the database was not changed — we return early without touching anything.
export async function restoreAdmin(
  request: APIRequestContext,
  originalUser: Record<string, any>,
): Promise<void> {
  // Step 1: authenticate with what the wizard set.
  // If this fails the wizard never submitted — nothing to restore.
  let token: string;
  try {
    token = await getToken(request, WIZARD_NEW_EMAIL, WIZARD_NEW_PASSWORD);
  } catch {
    return;
  }

  // Step 2: restore password.
  // currentPassword is what the wizard set; newPassword is the original.
  const pwRes = await request.put(`${BACKEND_URL}/api/users/password`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { currentPassword: WIZARD_NEW_PASSWORD, newPassword: ADMIN_PASSWORD },
  });
  if (!pwRes.ok()) throw new Error(`restoreAdmin: password restore failed — HTTP ${pwRes.status()}`);

  // Step 3: fresh token. Password is now ADMIN_PASSWORD; email is still WIZARD_NEW_EMAIL.
  token = await getToken(request, WIZARD_NEW_EMAIL, ADMIN_PASSWORD);

  // Step 4: restore all other user fields (username, email, fullName, …).
  // Spreading originalUser preserves every field snapshotted in beforeEach —
  // groupId, householdId, admin flag, etc. — so we don't accidentally wipe them.
  const userRes = await request.put(`${BACKEND_URL}/api/users/${originalUser.id}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...originalUser },
  });
  if (!userRes.ok()) throw new Error(`restoreAdmin: user restore failed — HTTP ${userRes.status()}`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// BROWSER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// Mock ONLY the three seeder POST calls.
// These are the sole exception to the "no mocks" rule. There is no API to delete
// seeded records, so we cannot reverse the write. We return a fake 200 OK so the
// wizard can complete without inserting data we can't clean up.
export async function mockSeeders(page: Page): Promise<void> {
  await page.route('**/api/groups/seeders/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
}

// The values filled into Account Details by navigateToStep.
// Returned so the caller can assert the Summary step displays them correctly.
export interface WizardAccountDetails {
  username: string;
  email: string;
  fullName: string;
}

// Navigate from /admin/setup through Account Details to a later wizard step.
// Uses a timestamp-based unique username/email so the real GET /api/validators/*
// calls return { valid: true } without any mocking — those values have never
// been in the database. No user is created: the wizard only writes to the DB
// when Submit is clicked on step 5.
//
// Returns the account details that were filled in, so callers (e.g. the Summary
// test) can assert those values appear on subsequent steps.
export async function navigateToStep(
  page: Page,
  target: 'siteSettings' | 'aiProviders' | 'summary',
): Promise<WizardAccountDetails> {
  // Unique per call — guaranteed not to exist in the database.
  const run = Date.now();
  const username = `testuser_${run}`;
  const email    = `testuser_${run}@example.com`;
  const fullName = 'Test User';

  await page.goto('/admin/setup');
  await page.getByRole('button', { name: 'Next' }).last().click();

  await page.getByLabel('Username').first().fill(username);
  await page.getByLabel('Full Name').first().fill(fullName);
  await page.getByLabel('Email').first().fill(email);
  await page.getByLabel('Password').first().fill('Tiger@42Blue!');
  await page.getByLabel('Confirm Password').first().fill('Tiger@42Blue!');

  // Real GET /api/validators/user/name and /email are called here.
  // The unique credentials guarantee both return { valid: true }.
  await page.getByRole('button', { name: 'Next' }).last().click();
  await expect(
    page.getByText('Here are some common settings for new sites')
  ).toBeVisible({ timeout: 8000 });
  if (target === 'siteSettings') return { username, email, fullName };

  await page.getByRole('button', { name: 'Next' }).last().click();
  await expect(
    page.locator('.headline').filter({ hasText: 'AI Providers' })
  ).toBeVisible({ timeout: 8000 });
  if (target === 'aiProviders') return { username, email, fullName };

  await page.getByRole('button', { name: 'Next' }).last().click();
  await expect(page.getByText('How does everything look?')).toBeVisible({ timeout: 8000 });

  return { username, email, fullName };
}
