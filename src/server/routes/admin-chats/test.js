// Админка, «Чаты»: список диалогов с непрочитанными, переписка, ответ покупателю, фото из переписки
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../../test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
const BUYER_ID = 7392580261;
const SECOND_BUYER_ID = 7702;
let shop;

before(async () => {
  shop = await testHelpers.start();
  const messages = require('../../../chat/messages');
  await messages.saveMessage({
    user_id: BUYER_ID,
    name: 'Анна',
    username: 'anna',
    direction: 'in',
    text: 'Здравствуйте!',
  });
  await messages.saveMessage({ user_id: SECOND_BUYER_ID, name: 'Пётр', direction: 'in', text: 'Есть пионы?' });
  await messages.saveMessage({ user_id: BUYER_ID, direction: 'in', photo: 'buyer-photo-1', text: null });
});

test('список диалогов: свежий сверху, имя из прошлых сообщений, непрочитанные', async () => {
  const response = await shop.call(OWNER_ID, 'GET', '/api/admin/chats');
  assert.equal(response.status, 200);
  assert.equal(response.body.unread, 3);
  const [latest, older] = response.body.chats;
  assert.deepEqual(Object.keys(latest), [
    'user_id',
    'text',
    'photo',
    'direction',
    'created_at',
    'name',
    'username',
    'unread',
  ]);
  assert.equal(latest.user_id, BUYER_ID);
  assert.equal(latest.photo, 'buyer-photo-1');
  assert.equal(latest.name, 'Анна', 'имя — из предыдущего сообщения');
  assert.equal(latest.username, 'anna');
  assert.equal(latest.unread, 2);
  assert.equal(older.user_id, SECOND_BUYER_ID);
  assert.equal(older.username, null);
});

test('открыть переписку — прочитано; ответ уходит покупателю и сохраняется', async () => {
  const opened = await shop.call(OWNER_ID, 'GET', `/api/admin/chats/${BUYER_ID}`);
  assert.deepEqual(Object.keys(opened.body), ['messages', 'orders']);
  assert.deepEqual(
    opened.body.messages.map((message) => message.text),
    ['Здравствуйте!', null],
  );
  assert.equal((await shop.call(OWNER_ID, 'GET', '/api/admin/chats')).body.unread, 1);

  const replied = await shop.call(OWNER_ID, 'POST', `/api/admin/chats/${BUYER_ID}`, {
    text: 'Добрый день! <Чем помочь?>',
    orderId: 0,
  });
  assert.equal(replied.status, 200);
  assert.equal(replied.body.messages.at(-1).direction, 'out');
  assert.equal(replied.body.messages.at(-1).is_read, 1);
  assert.equal(testHelpers.lastTextTo(BUYER_ID), '💬 <b>Флорист «Флёр»</b>:\n\nДобрый день! &lt;Чем помочь?&gt;');
  assert.deepEqual((await shop.call(OWNER_ID, 'POST', `/api/admin/chats/${BUYER_ID}`, { text: '   ' })).body, {
    error: 'Пустое сообщение',
  });
});

test('Telegram не доставил ответ — понятная ошибка, в историю не попадает', async () => {
  const telegraf = require('telegraf');
  const originalCallApi = telegraf.Telegram.prototype.callApi;
  telegraf.Telegram.prototype.callApi = async () => {
    throw new Error('403: Forbidden: bot was blocked by the user');
  };
  const response = await shop.call(OWNER_ID, 'POST', `/api/admin/chats/${SECOND_BUYER_ID}`, { text: 'Есть!' });
  telegraf.Telegram.prototype.callApi = originalCallApi;
  assert.equal(response.status, 400);
  assert.match(response.body.error, /^Telegram не доставил сообщение: .*blocked/);
  assert.equal(await shop.database.message.count({ where: { user_id: SECOND_BUYER_ID, direction: 'out' } }), 0);
});

test('фото из переписки отдаётся через сервер только владелице', async () => {
  const photo = await fetch(`${shop.base}/api/admin/photo/buyer-photo-1`, {
    headers: { 'X-Init-Data': testHelpers.initData(OWNER_ID) },
  });
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await photo.arrayBuffer()).toString(), 'fake-jpeg');
  assert.equal(
    (
      await fetch(`${shop.base}/api/admin/photo/buyer-photo-1`, {
        headers: { 'X-Init-Data': testHelpers.initData(BUYER_ID) },
      })
    ).status,
    403,
  );
});
