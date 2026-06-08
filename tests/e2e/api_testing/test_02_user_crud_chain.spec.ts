/**
 * test_02_user_crud_chain.spec.ts
 *
 * ГРУПА 2 — Синџир на CRUD операции над корисници
 * ════════════════════════════════════════════════
 * Ги тестираме сите операции над корисничкиот ресурс по ред,
 * каде секој чекор зависи од претходниот (chained tests):
 *
 *   T01 — Регистрирање на нов корисник → 201 + корисничкиот профил
 *   T02 — GET на сопствениот профил → 200 + точни податоци
 *   T03 — Ажурирање на сопствените податоци (full_name, email) → 200
 *   T04 — Обид за ажурирање на туѓ профил → 403
 *   T05 — Обид за промена на permission-и без admin права → 403
 *   T06 — Бришење на сопствениот корисник преку admin → 200
 *   T07 — GET после бришење → 404
 *
 * test.describe.serial() гарантира дека тестовите се извршуваат
 * строго по ред, бидејќи подоцните тестови зависат од резултатите
 * на претходните (зачувани во споделени `let` променливи).
 */

import { test, expect } from '@playwright/test';
import {
  BACKEND_URL,
  randomEmail,
  randomString,
  getAdminToken,
  authHeader,
  registerAndLogin,
} from './api_helpers';


// Споделена состојба помеѓу тестовите во овој describe блок.
// Секој тест ги чита/пишува овие променливи.
let userToken    = '';     // Bearer токен на тест-корисникот
let userId       = '';     // UUID на тест-корисникот
let userEmail    = '';     // е-пошта на тест-корисникот
let userPassword = '';     // лозинка на тест-корисникот

// Втор корисник за тестирање на cross-user операции
let otherToken   = '';
let otherUserId  = '';


test.describe.serial('Корисник CRUD Синџир — User CRUD Chain', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // T01: Регистрирање на нов корисник
  // ───────────────────────────────────────────────────────────────────────────
  test('T01 — Регистрирање на нов корисник враќа 201', async ({ request }) => {
    // registerAndLogin() регистрира корисник и веднаш се логира.
    // Ги зачувуваме сите вратени вредности за употреба во подоцнежните тестови.
    const result = await registerAndLogin(request);

    userToken    = result.token;
    userId       = result.userId;
    userEmail    = result.email;
    userPassword = result.password;

    // Проверка дека создавањето вратило 201 Created
    expect(result.status).toBe(201);

    // Базична проверка: корисникот мора да постои и да има валиден UUID
    expect(userId).toBeTruthy();
    expect(userId.length).toBeGreaterThan(10);
    expect(userEmail).toContain('@');
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T02: GET на сопствениот профил
  // ───────────────────────────────────────────────────────────────────────────
  test('T02 — GET /users/self враќа 200 со точни податоци', async ({ request }) => {
    // Со токенот од T01 го добиваме сопствениот профил.
    // Ова ја потврдува дека регистрацијата е зачувана коректно.
    const res = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);

    const user = await res.json();

    // Е-поштата мора да одговара на онаа со која сме регистрирани
    expect(user.email).toBe(userEmail);

    // Корисникот НЕ треба да е admin (регистрираниот корисник е обичен)
    expect(user.admin).toBe(false);

    // ID мора да одговара на зачуваниот ID
    expect(user.id).toBe(userId);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T03: Ажурирање на сопствените податоци
  // ───────────────────────────────────────────────────────────────────────────
  test('T03 — PUT /users/{id} со нова е-пошта и fullName враќа 200', async ({ request }) => {
    // Прво го земаме тековниот профил (потребни ни се сите полиња за PUT)
    const selfRes = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(userToken),
    });
    expect(selfRes.status()).toBe(200);
    const currentUser = await selfRes.json();

    // Подготвуваме ажурирани вредности
    const newFullName = `Updated_${randomString(6)}`;
    const newEmail    = randomEmail();

    // PUT бара ЦЕЛОСНИОТ корисников објект (не само измените полиња)
    // Затоа го "spread"-ираме тековниот корисник и ги преземаме новите вредности
    const payload = {
      ...currentUser,
      fullName: newFullName,
      email:    newEmail,
    };

    const updateRes = await request.put(`${BACKEND_URL}/api/users/${userId}`, {
      headers: authHeader(userToken),
      data:    payload,
    });

    expect(updateRes.status()).toBe(200);

    // PUT враќа {"message":"User updated","error":false} — не го враќа ажурираниот объект.
    // Затоа правиме GET /users/self за да ги верифицираме промените.
    const refreshRes = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(userToken),
    });
    const updatedUser = await refreshRes.json();

    // Верификуваме дека промените се зачувани
    expect(updatedUser.fullName).toBe(newFullName);
    expect(updatedUser.email).toBe(newEmail);

    // Ажурираме локалната е-пошта за понатамошна употреба
    userEmail = newEmail;
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T04: Обид за ажурирање на туѓ профил → 403
  // ───────────────────────────────────────────────────────────────────────────
  test('T04 — PUT /users/{другId} со токен на друг корисник враќа 403', async ({ request }) => {
    // Регистрираме втор корисник за да имаме два независни налога
    const other = await registerAndLogin(request);
    otherToken   = other.token;
    otherUserId  = other.userId;

    // Се обидуваме да го ажурираме профилот на ПРВИОТ корисник со токен на ВТОРИОТ.
    // Секој корисник смее да ги уредува само сопствените податоци.
    const selfRes = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(userToken),
    });
    const firstUser = await selfRes.json();

    const updateRes = await request.put(`${BACKEND_URL}/api/users/${userId}`, {
      headers: authHeader(otherToken),   // ← туѓ токен
      data:    { ...firstUser, fullName: 'hacked_name' },
    });

    // 403 Forbidden — корисникот не смее да менува туѓи профили
    expect(updateRes.status()).toBe(403);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T05: Обид за ескалација на permission-и → 403
  // ───────────────────────────────────────────────────────────────────────────
  test('T05 — PUT со admin:true за себеси враќа 403', async ({ request }) => {
    // Корисниците не смеат сами себеси да се промоцираат во admin.
    // Само постоечки admin може да додели admin права на друг корисник.
    const selfRes = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(userToken),
    });
    const currentUser = await selfRes.json();

    const escalateRes = await request.put(`${BACKEND_URL}/api/users/${userId}`, {
      headers: authHeader(userToken),
      data:    { ...currentUser, admin: true },    // ← обид за admin ескалација
    });

    expect(escalateRes.status()).toBe(403);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T06: Admin го брише тест-корисникот → 200
  // ───────────────────────────────────────────────────────────────────────────
  test('T06 — DELETE /admin/users/{id} со admin токен враќа 200', async ({ request }) => {
    // Само администраторот може да брише корисници преку admin endpoint.
    // Ги бришеме и двата тест-корисници (cleanup).
    const adminToken = await getAdminToken(request);

    // Бриши го главниот тест-корисник
    const delRes = await request.delete(`${BACKEND_URL}/api/admin/users/${userId}`, {
      headers: authHeader(adminToken),
    });
    expect(delRes.status()).toBe(200);

    // Бриши го и вториот тест-корисник
    await request.delete(`${BACKEND_URL}/api/admin/users/${otherUserId}`, {
      headers: authHeader(adminToken),
    });
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T07: GET на избришан корисник → 404
  // ───────────────────────────────────────────────────────────────────────────
  test('T07 — GET /admin/users/{id} после бришење враќа 404', async ({ request }) => {
    // Откако корисникот е избришан, секој обид за пристап треба да врати 404.
    const adminToken = await getAdminToken(request);

    const res = await request.get(`${BACKEND_URL}/api/admin/users/${userId}`, {
      headers: authHeader(adminToken),
    });

    expect(res.status()).toBe(404);
  });
});
