/**
 * test_03_recipe_lifecycle.spec.ts
 *
 * ГРУПА 3 — Животен циклус на Рецепт
 * ════════════════════════════════════
 * Ги тестираме сите операции над рецепт ресурсот по ред:
 *
 *   T01 — Создавање на нов рецепт → 201 + slug во одговорот
 *   T02 — GET на рецептот по slug → 200 + точни податоци
 *   T03 — Ажурирање (додавање белешки, промена на опис) → 200
 *   T04 — Дуплирање на рецептот → 201 + нов независен рецепт
 *   T05 — GET на оригиналниот рецепт по slug потоа по ID → 200
 *   T06 — Бришење на рецептот → 200
 *   T07 — GET после бришење → 404
 *   T08 — Создавање со невалидно/празно ime → 400 (валидациска грешка)
 *   T09 — Создавање на рецепт со исто ime → го добива суфикс "-1"
 *   T10 — PUT на непостоечки рецепт → 404
 *
 * Структурата е сериска — секој тест зависи од претходниот.
 * Тест-корисникот и рецептите се чистат во afterAll.
 */

import { test, expect } from '@playwright/test';
import {
  BACKEND_URL,
  randomString,
  authHeader,
  registerAndLogin,
  createRecipe,
  deleteRecipe,
} from './api_helpers';


// Споделена состојба меѓу тестовите
let userToken    = '';
let recipeSlug   = '';   // slug на главниот тест-рецепт
let recipeId     = '';   // UUID на главниот тест-рецепт
let dupSlug      = '';   // slug на дуплицираниот рецепт
const recipeName = `test_recipe_${randomString(8)}`;


test.describe.serial('Рецепт Животен Циклус — Recipe Lifecycle', () => {

  // Поставување: регистрираме тест-корисник пред сите тестови
  test.beforeAll(async ({ request }) => {
    const user = await registerAndLogin(request);
    userToken = user.token;
  });

  // Чистење: бришење на сите тест-рецепти и корисникот по завршување
  test.afterAll(async ({ request }) => {
    if (dupSlug) await deleteRecipe(request, userToken, dupSlug);
    // recipeSlug е избришан во T06, но ако тестот не поминал, чистиме тука
    if (recipeSlug) await deleteRecipe(request, userToken, recipeSlug);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T01: Создавање на нов рецепт
  // ───────────────────────────────────────────────────────────────────────────
  test('T01 — POST /recipes со валидно ime враќа 201 и slug', async ({ request }) => {
    // Mealie ги конвертира имињата во slug-ови (url-friendly стрингови).
    // POST-от враќа директно JSON стринг (slug), а не JSON обjект.
    const res = await request.post(`${BACKEND_URL}/api/recipes`, {
      headers: authHeader(userToken),
      data:    { name: recipeName },
    });

    expect(res.status()).toBe(201);

    // Одговорот е сам JSON стринг (slug), не объект
    recipeSlug = await res.json();

    expect(typeof recipeSlug).toBe('string');
    expect(recipeSlug.length).toBeGreaterThan(0);
    // Slug-от мора да е мали букви и без празни места
    expect(recipeSlug).toMatch(/^[a-z0-9-_]+$/);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T02: GET на рецептот по slug
  // ───────────────────────────────────────────────────────────────────────────
  test('T02 — GET /recipes/{slug} враќа 200 со точни податоци', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);

    const recipe = await res.json();

    // Основни полиња кои секој рецепт мора да ги има
    expect(recipe.slug).toBe(recipeSlug);
    expect(recipe.name).toBe(recipeName);
    expect(typeof recipe.id).toBe('string');

    // Зачуваме ID за подоцнежните тестови
    recipeId = recipe.id;
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T03: Ажурирање на рецептот
  // ───────────────────────────────────────────────────────────────────────────
  test('T03 — PUT /recipes/{slug} ги зачувува измените → 200', async ({ request }) => {
    // Прво го земаме целосниот рецепт (PUT бара целосен payload)
    const getRes = await request.get(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
    });
    const recipe = await getRes.json();

    // Додаваме опис и белешка
    const newDescription = `Ажуриран опис — ${randomString(10)}`;
    const updatedPayload = {
      ...recipe,
      description: newDescription,
      notes: [
        { title: 'Тест белешка', text: 'Ова е белешка додадена преку API тест' },
      ],
    };

    const putRes = await request.put(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
      data:    updatedPayload,
    });

    expect(putRes.status()).toBe(200);

    const updated = await putRes.json();

    // Верификуваме дека промените се зачувани
    expect(updated.description).toBe(newDescription);
    expect(updated.notes).toHaveLength(1);
    expect(updated.notes[0].title).toBe('Тест белешка');
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T04: Дуплирање на рецептот
  // ───────────────────────────────────────────────────────────────────────────
  test('T04 — POST /recipes/{slug}/duplicate создава нов независен рецепт', async ({ request }) => {
    // Дуплирањето создава нов рецепт со различен ID и slug.
    // Промените на дубликатот не смеат да го афектираат оригиналот.
    const dupName = `Дупликат_${randomString(6)}`;

    const res = await request.post(`${BACKEND_URL}/api/recipes/${recipeSlug}/duplicate`, {
      headers: authHeader(userToken),
      data:    { name: dupName },
    });

    expect(res.status()).toBe(201);

    const dup = await res.json();

    // Дубликатот мора да има различен ID и slug од оригиналот
    expect(dup.id).not.toBe(recipeId);
    expect(dup.slug).not.toBe(recipeSlug);

    // Зачуваме slug за чистење
    dupSlug = dup.slug;
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T05: GET на рецептот по ID (не само по slug)
  // ───────────────────────────────────────────────────────────────────────────
  test('T05 — GET /recipes/{id} враќа 200 (поддршка за lookup по UUID)', async ({ request }) => {
    // Mealie поддржува lookup и по slug и по UUID — и двата треба да работат
    const res = await request.get(`${BACKEND_URL}/api/recipes/${recipeId}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);

    const recipe = await res.json();
    expect(recipe.id).toBe(recipeId);
    expect(recipe.slug).toBe(recipeSlug);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T06: Бришење на рецептот
  // ───────────────────────────────────────────────────────────────────────────
  test('T06 — DELETE /recipes/{slug} враќа 200', async ({ request }) => {
    const res = await request.delete(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(200);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T07: GET после бришење → 404
  // ───────────────────────────────────────────────────────────────────────────
  test('T07 — GET /recipes/{slug} после бришење враќа 404', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/recipes/${recipeSlug}`, {
      headers: authHeader(userToken),
    });

    expect(res.status()).toBe(404);

    // Ресетирај slug за да не се обидуваме да го бришеме во afterAll
    recipeSlug = '';
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T08: Создавање со невалидно (само цртички) иmе → 400
  // ───────────────────────────────────────────────────────────────────────────
  test('T08 — POST /recipes со "---" (празен slug) враќа 400', async ({ request }) => {
    // Рецептот "---" резултира во празен slug по slugify(),
    // а Mealie одбива рецепти со празен slug.
    const res = await request.post(`${BACKEND_URL}/api/recipes`, {
      headers: authHeader(userToken),
      data:    { name: '---' },
    });

    expect(res.status()).toBe(400);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T09: Рецепт со исто иmе → автоматски добива суфикс "-1"
  // ───────────────────────────────────────────────────────────────────────────
  test('T09 — Два рецепти со исто иmе → вториот добива "-1" суфикс', async ({ request }) => {
    // Mealie автоматски резолвира конфликти во slug-ови со суфикс.
    // Важно: Mealie ги slugify-ира имињата (underscores → hyphens, мали букви).
    // Затоа проверуваме дека вториот slug = прв slug + "-1", не дека slug = name.
    const name = `duplicatetest${randomString(8)}`;  // само alphanumeric — slug = name

    // Прв рецепт со ова иmе
    const first = await createRecipe(request, userToken, name);
    expect(first).toBeTruthy();

    // Втор рецепт со исто иmе — треба да добие суфикс "-1"
    const second = await createRecipe(request, userToken, name);
    expect(second).toBe(`${first}-1`);

    // Чистење на двата рецепти
    await deleteRecipe(request, userToken, first);
    await deleteRecipe(request, userToken, second);
  });


  // ───────────────────────────────────────────────────────────────────────────
  // T10: PUT на непостоечки рецепт → 404
  // ───────────────────────────────────────────────────────────────────────────
  test('T10 — PUT /recipes/nepостоечки враќа 404', async ({ request }) => {
    // Обидуваме се да ажурираме рецепт кој не постои.
    const res = await request.put(`${BACKEND_URL}/api/recipes/this-recipe-does-not-exist-xyz`, {
      headers: authHeader(userToken),
      data:    { name: 'test' },
    });

    expect(res.status()).toBe(404);
  });
});
