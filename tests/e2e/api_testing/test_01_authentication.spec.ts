/**
 * test_01_authentication.spec.ts
 *
 * ГРУПА 1 — Тестови за Автентикација
 * ═══════════════════════════════════
 * Ги проверуваме сите основни случаи при кои корисникот се обидува
 * да се логира или да пристапи до заштитени ресурси:
 *
 *   T01 — Пристап без токен → 401
 *   T02 — Пристап со невалиден (лажен) токен → 401
 *   T03 — Логирање со погрешна лозинка → 401
 *   T04 — Логирање со непостоечки корисник → 401
 *   T05 — Успешно логирање → 200 + access_token во одговорот
 *   T06 — Валиден токен на заштитен ресурс → 200 + точна е-пошта
 *   T07 — Освежување на токен → 200 + нов access_token
 *   T08 — Јавен endpoint без токен → 200
 *   T09 — Обичен корисник на admin endpoint → 403
 *
 * Овие тестови НЕ менуваат трајна состојба на базата (освен T09 кој
 * создава и веднаш ги напушта привремените корисничките податоци).
 */

import { test, expect } from '@playwright/test';
import {
  BACKEND_URL, //'http://localhost:9000';
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  randomString,
  randomEmail,
  getToken,
  getSelf,
  authHeader,
  registerAndLogin,
} from './api_helpers';


test.describe('Автентикација — Authentication Tests', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // T01: Нема токен → заштитениот ресурс мора да врати 401
  // ───────────────────────────────────────────────────────────────────────────
  test('T01 — GET /users/self без токен враќа 401', async ({ request }) => {
    // Испраќаме барање без Authorization header воопшто.
    // Серверот не знае кој е корисникот, па мора да одбие со 401 Unauthorized.
    const res = await request.get(`${BACKEND_URL}/api/users/self`);


    expect(res.status()).toBe(401);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T02: Невалиден токен → серверот мора да го одбие
  // ───────────────────────────────────────────────────────────────────────────
  test('T02 — GET /users/self со лажен токен враќа 401', async ({ request }) => {
    // Генерираме 64 случајни знаци кои немаат врска со ниеден реален JWT.
    // Серверот треба да ја препознае невалидната потпис и да врати 401.
    const fakeToken = randomString(64);

    const res = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });

    expect(res.status()).toBe(401);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T03: Погрешна лозинка за постоечки корисник → 401
  // ───────────────────────────────────────────────────────────────────────────
  test('T03 — POST /auth/token со погрешна лозинка враќа 401', async ({ request }) => {
    // Е-поштата постои (тоа е admin) но лозинката е целосно погрешна.
    // Секој обид за логирање со лоши акредитиви мора да врати 401.
    const res = await request.post(`${BACKEND_URL}/api/auth/token`, {
      form: {
        username:   ADMIN_EMAIL,
        password:   'totally_wrong_password_xyz!',
        grant_type: 'password',
      },
    });

    // console.log(await res);
    expect(res.status()).toBe(401);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T04: Непостоечки корисник → 401 (истата порака за безбедност)
  // ───────────────────────────────────────────────────────────────────────────
  test('T04 — POST /auth/token со непостоечки корисник враќа 401', async ({ request }) => {
    // Серверот намерно враќа иста порака без разлика дали е-поштата не постои
    // или лозинката е погрешна — ова спречува "user enumeration" напади при кои
    // напаѓачот би можел да разбере кои е-пошти се регистрирани.
    const res = await request.post(`${BACKEND_URL}/api/auth/token`, {
      form: {
        username:   'nobody@thisdoesnotexist.com',
        password:   'any_password_123',
        grant_type: 'password',
      },
    });

    expect(res.status()).toBe(401);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T05: Успешно логирање → 200 + access_token
  // ───────────────────────────────────────────────────────────────────────────
  test('T05 — POST /auth/token со точни credentials враќа 200 и access_token', async ({ request }) => {
    // Ова е основниот "happy path" — корисникот се логира со точни податоци.
    // Очекуваме 200 OK и JSON со полето `access_token`.
    const res = await request.post(`${BACKEND_URL}/api/auth/token`, {
      form: {
        username:   ADMIN_EMAIL,
        password:   ADMIN_PASSWORD,
        grant_type: 'password',
      },
    });

    expect(res.status()).toBe(200);

    const body = await res.json();

    // Одговорот мора да содржи access_token кој е непразен стринг
    expect(body).toHaveProperty('access_token');
    expect(typeof body.access_token).toBe('string');
    expect(body.access_token.length).toBeGreaterThan(10);

    // Проверуваме и дека е вратен и token_type: bearer
    expect(body.token_type.toLowerCase()).toBe('bearer');
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T06: Валиден токен на заштитен ресурс → 200 + точни корисничките податоци
  // ───────────────────────────────────────────────────────────────────────────
  test('T06 — GET /users/self со валиден токен враќа 200 и точна е-пошта', async ({ request }) => {
    // Прво добиваме токен, потоа го испробуваме на заштитениот endpoint.
    // Ова ја верифицира целата auth flow: логирање → токен → авторизиран пристап.
    const token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(token),
    });

    expect(res.status()).toBe(200);

    const user = await res.json();

    // Е-поштата на вратениот корисник мора да одговара на онаа со која сме логирани
    expect(user.email).toBe(ADMIN_EMAIL);

    // Администраторот мора да има admin: true
    expect(user.admin).toBe(true);

    // Корисникот мора да има id (UUID стринг)
    expect(typeof user.id).toBe('string');
    expect(user.id.length).toBeGreaterThan(0);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T07: Освежување на токен → нов валиден access_token
  // ───────────────────────────────────────────────────────────────────────────
  test('T07 — GET /auth/refresh со валиден токен враќа 200 и нов токен', async ({ request }) => {
    // `/auth/refresh` ги обновува сесиите без да бара лозинка повторно.
    // Endpoint-от прима GET (не POST) со Bearer токен во Authorization header.
    // После обновата, новиот токен треба да работи за пристап до заштитени ресурси.
    const token = await getToken(request, ADMIN_EMAIL, ADMIN_PASSWORD);

    const refreshRes = await request.get(`${BACKEND_URL}/api/auth/refresh`, {
      headers: authHeader(token),
    });

    expect(refreshRes.status()).toBe(200);

    const body = await refreshRes.json();
    expect(body).toHaveProperty('access_token');
    expect(typeof body.access_token).toBe('string');

    // Верифицираме дека новиот токен навистина работи за /users/self
    const selfRes = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(body.access_token),
    });
    expect(selfRes.status()).toBe(200);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T08: Јавен endpoint без токен → 200 (информации за апликацијата)
  // ───────────────────────────────────────────────────────────────────────────
  test('T08 — GET /app/about без токен враќа 200 (јавен endpoint)', async ({ request }) => {
    // Некои endpoints се јавно достапни — ги користи frontend-от за прикажување
    // на верзијата на апликацијата уште пред логирање.
    // Очекуваме 200 со поле `version` во одговорот.
    const res = await request.get(`${BACKEND_URL}/api/app/about`);

    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('version');
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T09: Обичен корисник на admin endpoint → 403 Forbidden
  // ───────────────────────────────────────────────────────────────────────────
  test('T09 — GET /admin/about со обичен корисник враќа 403', async ({ request }) => {
    // Создаваме нов корисник (без admin права) и проверуваме дека не може
    // да пристапи до admin-only ресурси.
    // Ова ја тестира authorization логиката (не само authentication).
    const { token } = await registerAndLogin(request);

    const res = await request.get(`${BACKEND_URL}/api/admin/about`, {
      headers: authHeader(token),
    });

    // 403 Forbidden — корисникот е автентициран (знаеме кој е), но нема дозвола
    expect(res.status()).toBe(403);
  });
});
