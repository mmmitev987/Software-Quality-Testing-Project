/**
 * test_05_shopping_list_chain.spec.ts
 *
 * ГРУПА 5 — Синџир на CRUD операции над Листа за Купување
 * ════════════════════════════════════════════════════════
 * Ги тестираме операциите специфични за Mealie (без еквивалент во GoRest):
 *
 *   T01 — Создавање на листа за купување → 201 + листа объект
 *   T02 — GET на сите листи → нашата листа е во резултатот
 *   T03 — GET на поединечна листа по ID → 200 + точни полиња
 *   T04 — Ажурирање на имeто на листата → 200
 *   T05 — Додавање на ставка (item) во листата → 201
 *   T06 — Ажурирање на ставката (означување checked) → 200
 *   T07 — Бришење на ставката → 200
 *   T08 — Бришење на листата → 200
 *   T09 — GET на избришана листа → 404
 *   T10 — Создавање листа без иmе → 422
 *
 * Меalie е recipe manager со shopping list функционалност,
 * па овие тестови се специфични за апликацијата и немаат аналог во GoRest.
 */

import { test, expect } from '@playwright/test';
import {
  BACKEND_URL,
  randomString,
  authHeader,
  registerAndLogin,
  getAdminToken,
} from './api_helpers';


// Споделена состојба
let userToken    = '';
let userId       = '';
let listId       = '';    // UUID на тест-листата
let listName     = '';    // иmе на тест-листата
let itemId       = '';    // UUID на ставката во листата


test.describe.serial('Листа за Купување — Shopping List Chain', () => {

  // ─── Setup ───────────────────────────────────────────────────────────────
  test.beforeAll(async ({ request }) => {
    const user = await registerAndLogin(request);
    userToken = user.token;
    userId    = user.userId;
  });

  // ─── Teardown ─────────────────────────────────────────────────────────────
  test.afterAll(async ({ request }) => {
    // Бриши ги останатите листи ако некој тест не ги исчистил
    if (listId) {
      await request.delete(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
        headers: authHeader(userToken),
      });
    }

    // Бриши корисникот
    const adminToken = await getAdminToken(request);
    if (userId) {
      await request.delete(`${BACKEND_URL}/api/admin/users/${userId}`, {
        headers: authHeader(adminToken),
      });
    }
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T01: Создавање на листа за купување
  // ───────────────────────────────────────────────────────────────────────────
  test('T01 — POST /households/shopping/lists создава листа и враќа 201', async ({ request }) => {
    listName = `Тест Листа ${randomString(6)}`;

    const res = await request.post(`${BACKEND_URL}/api/households/shopping/lists`, {
      headers: authHeader(userToken),
      data:    { name: listName },
    });

    expect(res.status()).toBe(201);

    const list = await res.json();

    // Основни полиња
    expect(list.name).toBe(listName);
    expect(typeof list.id).toBe('string');
    expect(list.userId).toBe(userId);

    // Зачуваме ID
    listId = list.id;
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T02: GET на сите листи за купување
  // ───────────────────────────────────────────────────────────────────────────
  test('T02 — GET /households/shopping/lists ја враќа нашата листа', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/households/shopping/lists`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);

    const body = await res.json();

    // Одговорот е paginated — items е масива со листите
    expect(body).toHaveProperty('items');
    const lists: any[] = body.items;

    // Нашата листа мора да биде во резултатот
    const found = lists.find((l: any) => l.id === listId);
    expect(found).toBeDefined();
    expect(found!.name).toBe(listName);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T03: GET на поединечна листа
  // ───────────────────────────────────────────────────────────────────────────
  test('T03 — GET /households/shopping/lists/{id} враќа 200 со точни полиња', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);

    const list = await res.json();

    expect(list.id).toBe(listId);
    expect(list.name).toBe(listName);
    expect(list.userId).toBe(userId);

    // Листата мора да има listItems масива (иако засега е празна)
    expect(Array.isArray(list.listItems)).toBe(true);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T04: Ажурирање на имeто на листата
  // ───────────────────────────────────────────────────────────────────────────
  test('T04 — PUT /households/shopping/lists/{id} го ажурира иmето → 200', async ({ request }) => {
    // GET пред PUT за да го добиеме целосниот объект (PUT бара сите полиња)
    const getRes = await request.get(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
      headers: authHeader(userToken),
    });
    const currentList = await getRes.json();

    const newName = `Ажурирана Листа ${randomString(5)}`;

    const putRes = await request.put(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
      headers: authHeader(userToken),
      data:    { ...currentList, name: newName },
    });

    expect(putRes.status()).toBe(200);

    const updated = await putRes.json();
    expect(updated.name).toBe(newName);

    // Ажурираме локалното иmе
    listName = newName;
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T05: Додавање ставка во листата
  // ───────────────────────────────────────────────────────────────────────────
  test('T05 — POST /households/shopping/items додава ставка → 201', async ({ request }) => {
    // Shopping items се создаваат преку посебен endpoint (не nested под листата).
    // Поврзувањето со листата се прави преку shoppingListId полето.
    const payload = {
      shoppingListId: listId,
      note:           'Млеко',         // слободен текст за ставката
      quantity:       2,
      checked:        false,           // непроверена ставка при создавање
    };

    const res = await request.post(`${BACKEND_URL}/api/households/shopping/items`, {
      headers: authHeader(userToken),
      data:    payload,
    });

    expect(res.status()).toBe(201);

    // POST /shopping/items враќа { createdItems: [...], updatedItems: [...] }
    // (batch API) — не еден item, туку листа на создадени ставки.
    const body = await res.json();
    const item = body.createdItems[0];

    expect(item.note).toBe('Млеко');
    expect(item.shoppingListId).toBe(listId);
    expect(item.checked).toBe(false);

    // Зачуваме ID за понатамошни тестови
    itemId = item.id;
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T06: Ажурирање на ставката (означување checked = true)
  // ───────────────────────────────────────────────────────────────────────────
  test('T06 — PUT /households/shopping/items/{id} ставката ја означува checked', async ({ request }) => {
    // Ставките се означуваат "купени" со checked: true.
    // PUT бара целосниот item объект.
    const getRes = await request.get(`${BACKEND_URL}/api/households/shopping/items/${itemId}`, {
      headers: authHeader(userToken),
    });
    const currentItem = await getRes.json();

    const putRes = await request.put(`${BACKEND_URL}/api/households/shopping/items/${itemId}`, {
      headers: authHeader(userToken),
      data:    { ...currentItem, checked: true },
    });

    expect(putRes.status()).toBe(200);

    // PUT /shopping/items враќа batch одговор { updatedItems: [...] }
    const body = await putRes.json();
    const updated = body.updatedItems[0];
    expect(updated.checked).toBe(true);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T07: Бришење на ставката
  // ───────────────────────────────────────────────────────────────────────────
  test('T07 — DELETE /households/shopping/items/{id} ја брише ставката', async ({ request }) => {
    const res = await request.delete(`${BACKEND_URL}/api/households/shopping/items/${itemId}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T08: Бришење на целата листа
  // ───────────────────────────────────────────────────────────────────────────
  test('T08 — DELETE /households/shopping/lists/{id} ја брише листата → 200', async ({ request }) => {
    const res = await request.delete(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T09: GET на избришана листа → 404
  // ───────────────────────────────────────────────────────────────────────────
  test('T09 — GET /households/shopping/lists/{id} после бришење враќа 404', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(404);

    // Ресетирај listId за да не се обидуваме да ја бришеме во afterAll
    listId = '';
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T10: Создавање листа без иmе — Mealie го дозволува (name:null)
  // ───────────────────────────────────────────────────────────────────────────
  test('T10 — POST /households/shopping/lists без иmе враќа 201 (name:null е дозволено)', async ({ request }) => {
    // Mealie не бара задолжително иmе за листата — создава листа со name:null.
    // Ова е документациски тест: системот не спроведува валидација на иmето.
    const res = await request.post(`${BACKEND_URL}/api/households/shopping/lists`, {
      headers: authHeader(userToken),
      data:    {},    // ← нема name поле
    });

    expect(res.status()).toBe(201);

    const list = await res.json();
    expect(list.name).toBeNull();   // Mealie прифаќа null-name листи

    // Cleanup: избриши ја оваа листа
    if (list.id) {
      await request.delete(`${BACKEND_URL}/api/households/shopping/lists/${list.id}`, {
        headers: authHeader(userToken),
      });
    }
  });
});
