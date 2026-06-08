/**
 * test_07_end_to_end_chain.spec.ts
 *
 * ГРУПА 7 — Целосен Крај-до-Крај Синџир (End-to-End Chain)
 * ═════════════════════════════════════════════════════════
 * Го симулираме комплетниот животен циклус на еден корисник
 * и сите негови ресурси, по ред, каде секој чекор зависи
 * од претходниот. Аналогно на GoRest Chained Testing.
 *
 * ЖИВОТЕН ЦИКЛУС:
 *
 *   Чекор 1  — Регистрирање на нов корисник
 *   Чекор 2  — Создавање на рецепт за корисникот
 *   Чекор 3  — Создавање на листа за купување
 *   Чекор 4  — Додавање на ставка во листата
 *   Чекор 5  — Создавање на коментар на рецептот
 *   Чекор 6  — Верификација дека сите ресурси постојат
 *   Чекор 7  — Бришење на рецептот
 *   Чекор 8  — Верификација дека коментарот е сè уште достапен (или 404)
 *   Чекор 9  — Бришење на листата за купување
 *   Чекор 10 — Бришење на корисникот
 *   Чекор 11 — Верификација дека корисникот е избришан (404)
 *
 * Овој тест ја валидира интегритетот на системот при каскадно бришење
 * и орфан ресурси — исто ка GoRest Chained Testing секцијата.
 */

import { test, expect } from '@playwright/test';
import {
  BACKEND_URL,
  randomString,
  authHeader,
  registerAndLogin,
  createRecipe,
  getAdminToken,
} from './api_helpers';


// Споделена состојба — зачувана помеѓу чекорите
let userToken    = '';
let userId       = '';
let recipeSlug   = '';
let recipeId     = '';
let listId       = '';
let itemId       = '';
let commentId    = '';


test.describe.serial('Крај-до-Крај Синџир — Full End-to-End Chain', () => {

  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 1: Регистрирање на нов корисник
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 1 — Регистрирање на корисник', async ({ request }) => {
    // Почетна точка: нов изолиран корисник без никакви ресурси
    const user = await registerAndLogin(request);

    userToken = user.token;
    userId    = user.userId;

    expect(userId).toBeTruthy();

    // Верификуваме дека корисникот е достапен
    const self = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(userToken),
    });
    expect(self.status()).toBe(200);
    expect((await self.json()).id).toBe(userId);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 2: Создавање на рецепт
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 2 — Создавање рецепт за корисникот', async ({ request }) => {
    // Создаваме рецепт со основни полиња
    recipeSlug = await createRecipe(request, userToken, `e2e_recipe_${randomString(8)}`);
    expect(recipeSlug).toBeTruthy();

    // Добиваме UUID на рецептот (потребен за коментар)
    const res = await request.get(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
    });
    expect(res.status()).toBe(200);

    const recipe = await res.json();
    recipeId = recipe.id;
    expect(recipeId).toBeTruthy();
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 3: Создавање на листа за купување
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 3 — Создавање листа за купување', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/households/shopping/lists`, {
      headers: authHeader(userToken),
      data:    { name: `E2E Листа ${randomString(6)}` },
    });

    expect(res.status()).toBe(201);

    const list = await res.json();
    listId = list.id;
    expect(listId).toBeTruthy();
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 4: Додавање ставка во листата
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 4 — Додавање ставка во листата', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/households/shopping/items`, {
      headers: authHeader(userToken),
      data:    {
        shoppingListId: listId,
        note:           'E2E тест ставка',
        checked:        false,
      },
    });

    expect(res.status()).toBe(201);

    // POST /shopping/items враќа { createdItems: [...] } (batch API)
    const body = await res.json();
    itemId = body.createdItems[0].id;
    expect(itemId).toBeTruthy();
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 5: Создавање на коментар на рецептот
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 5 — Создавање коментар на рецептот', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/comments`, {
      headers: authHeader(userToken),
      data:    {
        recipeId: recipeId,
        text:     'E2E тест коментар — создаден пред бришење на рецептот',
      },
    });

    expect(res.status()).toBe(201);

    const comment = await res.json();
    commentId = comment.id;
    expect(commentId).toBeTruthy();
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 6: Верификација дека сите ресурси постојат
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 6 — Сите создадени ресурси постојат', async ({ request }) => {
    // Овде паралелно ги верифицираме сите ресурси:
    // рецептот, листата за купување и коментарот.
    // Аналогно на GoRest "Chained Testing" — state verification пред бришење.

    const [recipeRes, listRes, commentRes] = await Promise.all([
      request.get(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
        headers: authHeader(userToken),
      }),
      request.get(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
        headers: authHeader(userToken),
      }),
      request.get(`${BACKEND_URL}/api/comments/${commentId}`, {
        headers: authHeader(userToken),
      }),
    ]);

    expect(recipeRes.status()).toBe(200);
    expect(listRes.status()).toBe(200);
    expect(commentRes.status()).toBe(200);

    // Верификуваме ID-вите
    expect((await recipeRes.json()).id).toBe(recipeId);
    expect((await listRes.json()).id).toBe(listId);
    expect((await commentRes.json()).id).toBe(commentId);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 7: Бришење на рецептот (со активен коментар)
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 7 — Бришење на рецептот', async ({ request }) => {
    // Бришеме рецепт кој има поврзан коментар.
    // Ова е клучниот момент за проверка на каскадното однесување.
    const res = await request.delete(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 8: Рецептот е 404; коментарот е 404 (каскадно бришење)
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 8 — Рецептот е 404; коментарот исто → каскадно бришење', async ({ request }) => {
    // Рецептот е избришан — треба 404
    const recipeRes = await request.get(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
    });
    expect(recipeRes.status()).toBe(404);

    // Коментарот на избришан рецепт — Mealie го брише каскадно
    const commentRes = await request.get(`${BACKEND_URL}/api/comments/${commentId}`, {
      headers: authHeader(userToken),
    });
    // Очекуваме 404 по каскадно бришење
    expect(commentRes.status()).toBe(404);

    // Ресетираме за да не се обидуваме да бришеме во afterAll
    recipeSlug = '';
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 9: Бришење на листата за купување
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 9 — Бришење листата за купување', async ({ request }) => {
    // Листата за купување е независна од рецептите — не се брише каскадно.
    // Мора рачно да ја избришеме.
    const res = await request.delete(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);

    // Верифицираме дека е избришана
    const getRes = await request.get(`${BACKEND_URL}/api/households/shopping/lists/${listId}`, {
      headers: authHeader(userToken),
    });
    expect(getRes.status()).toBe(404);

    listId = '';
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 10: Бришење на корисникот
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 10 — Бришење на корисникот', async ({ request }) => {
    // Само admin може да брише корисници
    const adminToken = await getAdminToken(request);

    const res = await request.delete(`${BACKEND_URL}/api/admin/users/${userId}`, {
      headers: authHeader(adminToken),
    });

    expect(res.status()).toBe(200);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // ЧЕКОР 11: Корисникот е избришан — 404
  // ───────────────────────────────────────────────────────────────────────────
  test('Чекор 11 — Избришаниот корисник враќа 404', async ({ request }) => {
    // По бришење, нема ни да може да се логира ни да му се пристапи профилот
    const adminToken = await getAdminToken(request);

    const res = await request.get(`${BACKEND_URL}/api/admin/users/${userId}`, {
      headers: authHeader(adminToken),
    });

    expect(res.status()).toBe(404);

    // Исто така, старата сесија (токенот) мора да биде неважечка
    const selfRes = await request.get(`${BACKEND_URL}/api/users/self`, {
      headers: authHeader(userToken),
    });
    // Откако корисникот е избришан, неговиот токен не смее да работи

    console.log(selfRes);
    expect([401, 403, 404]).toContain(selfRes.status());

    userId = '';
  });
});
