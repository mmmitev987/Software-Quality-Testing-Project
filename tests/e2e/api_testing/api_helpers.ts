/**
 * api_helpers.ts
 *
 * Споделени помошни функции за Mealie API тестовите.
 * Овие функции се извршуваат на Node.js ниво преку Playwright-овиот
 * `request` фиксчер (APIRequestContext) — директно HTTP повици кон
 * бекендот, без никаков прелистувач (browser).
 *
 * Извезени вредности:
 *   - BACKEND_URL   : адресата на бекендот
 *   - ADMIN_EMAIL   : е-пошта на дефолт администраторот
 *   - ADMIN_PASSWORD: лозинка на дефолт администраторот
 *   - randomString  : генератор на случајни стрингови
 *   - randomEmail   : генератор на уникатни тест-мејлови
 *   - getToken      : добива Bearer токен преку OAuth2 password grant
 *   - getAdminToken : кратенка за добивање на админ токен
 *   - getSelf       : го враќа профилот на тековниот корисник
 *   - authHeader    : гради Authorization header објект
 *   - registerUser  : регистрира нов корисник и враќа неговите податоци
 */

import { APIRequestContext } from '@playwright/test';

// ─── Конфигурација на серверот ────────────────────────────────────────────────
// Nuxt frontend (порт 3000) НЕ проксира /api/ — прелистувачот зборува
// директно со бекендот на порт 9000.
export const BACKEND_URL = 'http://localhost:9000';

// ─── Дефолт администраторски акредитиви (свежа база) ─────────────────────────
// По `docker compose up`, бекендот ги посеа овие дефолтни вредности.
export const ADMIN_EMAIL    = 'changeme@example.com';
export const ADMIN_PASSWORD = 'MyPassword';


// ─── Генератори на случајни тест-податоци ─────────────────────────────────────

/**
 * Враќа случаен алфанумерички стринг со дадена должина.
 * Се користи за генерирање на имиња, slug-ови и слично.
 */
export function randomString(length = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(
    { length },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('');
}

/**
 * Враќа уникатна тест е-пошта базирана на тековното Unix timestamp.
 * Ова гарантира дека адресата никогаш не постоела во базата претходно.
 */
export function randomEmail(): string {
  return `api_test_${Date.now()}_${randomString(4)}@test.com`;
}


// ─── API Помошни функции ──────────────────────────────────────────────────────

/**
 * Добива Bearer токен преку OAuth2 password grant endpoint.
 * Праќа email + password и добива краткотраен токен стринг.
 * Сите последователни API повици го прикачуваат овој токен
 * на Authorization header-от.
 *
 * @throws Error ако одговорот не е 200 OK
 */
export async function getToken(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/api/auth/token`, {
    // `form` праќа application/x-www-form-urlencoded (OAuth2 password grant бара тоа)
    form: { username: email, password, grant_type: 'password' },
  });
  if (!res.ok()) {
    throw new Error(`getToken: не успеа за "${email}" — HTTP ${res.status()}`);
  }
  return (await res.json()).access_token;
}

/**
 * Кратенка за добивање токен на дефолт администраторот.
 */
export async function getAdminToken(request: APIRequestContext): Promise<string> {
  return getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Го враќа целосниот профил на тековниот корисник (оној кој го поседува токенот).
 * Корисно за зачувување на snapshot пред тест и враќање потоа (teardown).
 *
 * @throws Error ако одговорот не е 2xx
 */
export async function getSelf(
  request: APIRequestContext,
  token: string,
): Promise<Record<string, any>> {
  const res = await request.get(`${BACKEND_URL}/api/users/self`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) throw new Error(`getSelf: не успеа — HTTP ${res.status()}`);
  return res.json();
}

/**
 * Гради Authorization header објект подготвен за директно вметнување
 * во `headers` опцијата на секој request.
 */
export function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Создава нов тест-корисник преку /api/admin/users (бара admin токен) и
 * веднаш се логира со неговите акредитиви. Го враќа профилот заедно со
 * токенот и лозинката за да може тестот да го изврши cleanup подоцна.
 *
 * Забелешка: Го користиме admin endpoint наместо /api/users/register
 * бидејќи регистрацијата е исклучена (ALLOW_SIGNUP=false) во оваа инсталација.
 *
 * @param request   Playwright APIRequestContext
 * @param overrides Опциски полиња кои ги преземаат дефолтните вредности
 */
export async function registerAndLogin(
  request: APIRequestContext,
  overrides: Partial<{
    email: string;
    username: string;
    fullName: string;
    password: string;
  }> = {},
): Promise<{
  status: number;
  token: string;
  email: string;
  password: string;
  userId: string;
  groupId: string;
  householdId: string;
}> {
  const email    = overrides.email    ?? randomEmail();
  const password = overrides.password ?? 'TestPass123!';
  const username = overrides.username ?? randomString(10);
  const fullName = overrides.fullName ?? randomString(10);

  // Добиваме admin токен за да можеме да создадеме нов корисник
  const adminToken = await getAdminToken(request);

  // POST /api/admin/users — создава корисник без потреба од ALLOW_SIGNUP
  // Корисникот се додава во дефолтната група/household
  const createRes = await request.post(`${BACKEND_URL}/api/admin/users`, {
    headers: authHeader(adminToken),
    data: {
      email,
      username,
      fullName,
      password,
      admin:    false,
      advanced: false,
    },
  });

  if (!createRes.ok()) {
    const body = await createRes.text();
    throw new Error(`registerAndLogin: создавањето не успеа — HTTP ${createRes.status()}: ${body}`);
  }

  // Одговорот го содржи ID-от директно — нема потреба од дополнителен GET /users/self
  const created = await createRes.json();

  // Се логираме со новиот корисник за да добиеме Bearer токен
  const token = await getToken(request, email, password);

  return {
    status:      createRes.status(),
    token,
    email,
    password,
    userId:      created.id,
    groupId:     created.groupId,
    householdId: created.householdId,
  };
}

/**
 * Создава рецепт со минимален payload и го враќа slug-от.
 * Помошна функција за брзо поставување на тест-рецепти.
 */
export async function createRecipe(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/api/recipes`, {
    headers: authHeader(token),
    data: { name },
  });
  if (!res.ok()) throw new Error(`createRecipe: не успеа — HTTP ${res.status()}`);
  // Одговорот е JSON стринг (самиот slug), не JSON объект
  const slug = await res.json();
  return slug as string;
}

/**
 * Бриши рецепт со даден slug. Не фрла грешка ако рецептот веќе не постои.
 * Корисно за cleanup во afterEach / afterAll.
 */
export async function deleteRecipe(
  request: APIRequestContext,
  token: string,
  slug: string,
): Promise<void> {
  await request.delete(`${BACKEND_URL}/api/recipes/${slug}`, {
    headers: authHeader(token),
  });
}
