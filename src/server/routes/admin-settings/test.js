// Админка: календарь, ожидание ответа по фото, тарифы доставки, резервная копия
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../../test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
let shop;

before(async () => {
  shop = await testHelpers.start();
});

test('календарь: только настоящие даты без повторов, лимит 0–99', async () => {
  assert.deepEqual((await shop.call(OWNER_ID, 'GET', '/api/admin/calendar')).body, { closed: [], slotLimit: 0 });
  const saved = await shop.call(OWNER_ID, 'PUT', '/api/admin/calendar', {
    closed: ['2026-12-31', '31.12.2026', '2026-12-30', '2026-12-31'],
    slotLimit: '150',
  });
  assert.deepEqual(saved.body, { closed: ['2026-12-30', '2026-12-31'], slotLimit: 99 });
  assert.deepEqual((await shop.call(OWNER_ID, 'GET', '/api/admin/calendar')).body, saved.body);
});

test('ожидание ответа по фото: по умолчанию 30 минут, от 0 до 240', async () => {
  assert.deepEqual((await shop.call(OWNER_ID, 'GET', '/api/admin/photo-timeout')).body, { minutes: 30 });
  assert.deepEqual((await shop.call(OWNER_ID, 'PUT', '/api/admin/photo-timeout', { minutes: '500' })).body, {
    minutes: 240,
  });
  assert.deepEqual((await shop.call(OWNER_ID, 'PUT', '/api/admin/photo-timeout', { minutes: 'никогда' })).body, {
    minutes: 0,
  });
});

test('тарифы доставки: зоны сортируются, мусор отбрасывается, без зон — ошибка', async () => {
  assert.equal((await shop.call(OWNER_ID, 'GET', '/api/admin/delivery')).body.region.base, 990);
  const saved = await shop.call(OWNER_ID, 'PUT', '/api/admin/delivery', {
    city: [
      { km: 10, price: '450' },
      { km: 3, price: 250.4 },
      { km: 0, price: 1 },
    ],
    region: { base: 1200, perKm: '50' },
    freeFrom: -5,
  });
  assert.deepEqual(saved.body, {
    city: [
      { km: 1, price: 1 },
      { km: 3, price: 250 },
      { km: 10, price: 450 },
    ],
    region: { base: 1200, perKm: 50, fromKm: 0 },
    freeFrom: 0,
  });
  const rejected = await shop.call(OWNER_ID, 'PUT', '/api/admin/delivery', { city: [] });
  assert.equal(rejected.status, 400);
  assert.deepEqual(rejected.body, { error: 'Добавьте хотя бы одну зону по городу' });
});

test('резервная копия: ZIP владелице в чат, без служебных отметок о фото', async () => {
  const response = await shop.call(OWNER_ID, 'POST', '/api/admin/backup', {});
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.ok, true);
  const documentCall = testHelpers.telegramCalls.filter((call) => call.method === 'sendDocument').at(-1);
  assert.equal(String(documentCall.payload.chat_id), String(OWNER_ID));
  assert.match(documentCall.payload.caption, /Резервная копия «Флёра»\nФото: 14/);
  const { makeBackup } = require('../../../backup');
  const photos = require('../../photos');
  const backup = await makeBackup({ uploadsDir: photos.uploadsDir, photosDir: photos.photosDir });
  const archiveText = backup.buffer.toString('latin1');
  for (const fileName of [
    'bouquets.json',
    'bouquets.csv',
    'orders.csv',
    'messages.json',
    'reminders.json',
    'settings.json',
    'photos/1-utro-v-provanse.jpg',
  ]) {
    assert.ok(archiveText.includes(fileName), fileName);
  }
  assert.ok(!archiveText.includes('photo_applied:'), 'служебные отметки не в архиве');
  assert.equal(response.body.size, backup.buffer.length);
});
