// Сервер целиком: подпись Telegram, доступ владелицы, ошибки без стека, статика витрины
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('./test-helpers');

let shop;
before(async () => {
  shop = await testHelpers.start();
});

test('поддельная и просроченная подпись Telegram отклоняются', async () => {
  const forgedInitData = testHelpers.initData(7001).replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64));
  const forged = await shop.call(null, 'GET', '/api/my-orders', undefined, { 'X-Init-Data': forgedInitData });
  assert.equal(forged.status, 401);
  assert.deepEqual(forged.body, { error: 'Откройте магазин через Telegram' });
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
  const expired = await shop.call(null, 'GET', '/api/my-orders', undefined, {
    'X-Init-Data': testHelpers.initData(7001, twoDaysAgo),
  });
  assert.equal(expired.status, 401);
  assert.equal((await shop.call(7001, 'GET', '/api/my-orders')).status, 200);
});

test('админка — только владелице', async () => {
  const buyerAttempt = await shop.call(7002, 'GET', '/api/admin/orders');
  assert.equal(buyerAttempt.status, 403);
  assert.deepEqual(buyerAttempt.body, { error: 'Только для владелицы' });
  assert.equal((await shop.call(null, 'GET', '/api/admin/orders')).status, 401);
  // большие тела (фото) не принимаются даже на разбор, пока не проверена владелица
  assert.equal((await shop.call(7002, 'POST', '/api/admin/upload', { full: 'x'.repeat(200000) })).status, 403);
  assert.equal((await shop.call(testHelpers.OWNER_ID, 'GET', '/api/admin/orders')).status, 200);
});

test('кривой JSON — короткая ошибка без стека; витрина и админка отдаются как статика', async () => {
  const response = await fetch(shop.base + '/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': testHelpers.initData(7003) },
    body: '{"items":',
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.doesNotMatch(body.error, /at .*\.js/);
  const storefront = await fetch(shop.base + '/');
  assert.equal(storefront.status, 200);
  assert.match(await storefront.text(), /<html/i);
  assert.equal((await fetch(shop.base + '/admin.html')).status, 200);
  assert.equal(storefront.headers.get('cache-control'), 'no-cache');
  const mainModule = await fetch(shop.base + '/scripts/shop/main.js');
  assert.equal(mainModule.status, 200);
  assert.match(mainModule.headers.get('content-type'), /javascript/);
  assert.equal(mainModule.headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(shop.base + '/styles/admin/base.css')).status, 200);
  assert.equal((await fetch(shop.base + '/photos/1-utro-v-provanse.jpg')).status, 200);
});
