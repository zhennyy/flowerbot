// Бот в чате: прогоняем настоящие обработчики через подставной Telegram (без сети)
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const testHelpers = require('../server/test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
const BUYER_ID = 7392580262; // настоящие id Telegram бывают длиннее 32 бит
let shop;
let bot;
let updateCounter = 0;
let messageCounter = 100;
let orderId;

const lastText = (chatId) => testHelpers.lastTextTo(chatId);
const buttonsOf = (call) => (call.payload.reply_markup?.inline_keyboard || []).flat();
const lastButtons = (chatId) => buttonsOf(testHelpers.sentTo(chatId).at(-1));
const sender = (chatId) => ({
  id: chatId,
  is_bot: false,
  first_name: chatId === OWNER_ID ? 'Флорист' : 'Анна',
  username: chatId === OWNER_ID ? undefined : 'anna',
});

function sendText(chatId, text) {
  const commandMatch = text.match(/^\/\w+/);
  return bot.handleUpdate({
    update_id: ++updateCounter,
    message: {
      message_id: ++messageCounter,
      date: Math.floor(Date.now() / 1000),
      text,
      from: sender(chatId),
      chat: { id: chatId, type: 'private' },
      ...(commandMatch ? { entities: [{ type: 'bot_command', offset: 0, length: commandMatch[0].length }] } : {}),
    },
  });
}

function sendPhoto(chatId, caption) {
  return bot.handleUpdate({
    update_id: ++updateCounter,
    message: {
      message_id: ++messageCounter,
      date: Math.floor(Date.now() / 1000),
      from: sender(chatId),
      chat: { id: chatId, type: 'private' },
      photo: [
        { file_id: 'small-photo', width: 90, height: 90 },
        { file_id: 'big-photo', width: 1280, height: 1280 },
      ],
      ...(caption ? { caption } : {}),
    },
  });
}

function pressButton(chatId, callbackData) {
  return bot.handleUpdate({
    update_id: ++updateCounter,
    callback_query: {
      id: String(updateCounter),
      data: callbackData,
      chat_instance: '1',
      from: sender(chatId),
      message: {
        message_id: ++messageCounter,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private' },
        text: '…',
      },
    },
  });
}

before(async () => {
  shop = await testHelpers.start();
  bot = shop.bot;
  process.env.YOOKASSA_SHOP_ID = ''; // без онлайн-оплаты: заказ сразу «принят»
  const response = await shop.placeOrder(BUYER_ID, [[1, 1, 'S']]);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  orderId = response.body.id;
});

test('/start, /myid и /admin', async () => {
  await sendText(BUYER_ID, '/start');
  assert.match(lastText(BUYER_ID), /^Привет, Анна! 🌷/);
  assert.equal(lastButtons(BUYER_ID)[0].web_app.url, process.env.WEBAPP_URL);
  await sendText(BUYER_ID, '/myid');
  assert.match(lastText(BUYER_ID), new RegExp(`OWNER_ID=${BUYER_ID}`));
  await sendText(BUYER_ID, '/admin');
  assert.equal(lastText(BUYER_ID), 'Эта команда только для владелицы магазина 🌷');
  await sendText(OWNER_ID, '/admin');
  assert.equal(lastButtons(OWNER_ID)[0].web_app.url, 'https://fleur.test/admin.html');
  await sendText(BUYER_ID, '/unknown');
  assert.match(lastText(BUYER_ID), /Не знаю такой команды/);
});

test('новый заказ: владелице — с кнопками статусов и без контактов, покупателю — «принят» с напоминанием', async () => {
  const ownerNote = testHelpers.sentTo(OWNER_ID).find((call) => /Новый заказ!/.test(testHelpers.textOf(call)));
  assert.match(
    testHelpers.textOf(ownerNote),
    new RegExp(`Заказ №${orderId}[\\s\\S]*👤 <a href="tg://user\\?id=${BUYER_ID}">Покупатель в Telegram</a> @anna`),
  );
  assert.doesNotMatch(
    testHelpers.textOf(ownerNote),
    /123-45-67|Невский|Анна/,
    'телефон, адрес и имя — только в админке',
  );
  assert.deepEqual(
    buttonsOf(ownerNote)
      .map((button) => button.callback_data)
      .slice(0, 2),
    [`st:${orderId}:confirmed`, `st:${orderId}:assembling`],
  );
  const buyerNote = testHelpers.sentTo(BUYER_ID).find((call) => /принят!/.test(testHelpers.textOf(call)));
  assert.deepEqual(
    buttonsOf(buyerNote).map((button) => button.callback_data),
    [`rem:${orderId}`, `ask:${orderId}`],
  );
});

test('кнопки статусов: только владелица; неизвестный статус не ломает заказ', async () => {
  await pressButton(BUYER_ID, `st:${orderId}:done`);
  assert.equal((await shop.findOrder(orderId)).status, 'new');
  await pressButton(OWNER_ID, `st:${orderId}:constructor`);
  assert.equal((await shop.findOrder(orderId)).status, 'new');
  await pressButton(OWNER_ID, `st:${orderId}:confirmed`);
  assert.equal((await shop.findOrder(orderId)).status, 'confirmed');
  const statusEdit = testHelpers.telegramCalls.findLast(
    (call) => call.method === 'editMessageText' && /Подтверждён/.test(call.payload.text),
  );
  assert.ok(statusEdit);
  assert.match(statusEdit.payload.text, /Контакты и адрес — в админке/);
  assert.doesNotMatch(statusEdit.payload.text, /123-45-67|Невский/, 'и после смены статуса — без контактов');
});

test('вопрос флористу и ответ владелицы через кнопку «Ответить»', async () => {
  await pressButton(BUYER_ID, `ask:${orderId}`);
  await sendText(BUYER_ID, 'Можно добавить <ленту>?');
  assert.match(
    lastText(OWNER_ID),
    new RegExp(`💬 Анна \\(@anna\\) · заказ №${orderId}:\\n\\nМожно добавить &lt;ленту&gt;\\?`),
  );
  assert.equal(lastButtons(OWNER_ID)[0].callback_data, `reply:${BUYER_ID}:${orderId}`);
  assert.equal(lastText(BUYER_ID), 'Передала флористу ✅ Ответ придёт сюда, в этот чат');
  const saved = await shop.database.message.findFirst({
    where: { user_id: BUYER_ID, direction: 'in' },
    orderBy: { id: 'desc' },
  });
  assert.equal(saved.order_id, orderId);

  await sendText(OWNER_ID, 'просто текст');
  assert.match(lastText(OWNER_ID), /нажмите «↩️ Ответить»/);
  await pressButton(OWNER_ID, `reply:${BUYER_ID}:${orderId}`);
  await sendText(OWNER_ID, 'Конечно, добавим');
  assert.equal(lastText(BUYER_ID), `💬 <b>Флорист «Флёр»</b> · заказ №${orderId}:\n\nКонечно, добавим`);
  assert.equal(lastText(OWNER_ID), 'Ответ отправлен ✅');
  assert.equal(
    (await shop.database.message.findFirst({ where: { user_id: BUYER_ID }, orderBy: { id: 'desc' } })).direction,
    'out',
  );
});

test('фото букета: владелица подписывает номером заказа, покупатель просит изменить, затем одобряет', async () => {
  await sendPhoto(OWNER_ID, 'на 8 марта');
  assert.match(lastText(OWNER_ID), /подпишите его номером заказа/);
  await sendPhoto(OWNER_ID, `№${orderId}`);
  assert.match(lastText(OWNER_ID), new RegExp(`Фото отправлено на согласование \\(заказ №${orderId}\\)`));
  const order = await shop.findOrder(orderId);
  assert.equal(testHelpers.sentTo(BUYER_ID).at(-1).payload.photo, 'big-photo', 'покупателю — самое большое разрешение');
  assert.match(order.bouquet_photo, /^photo-\d+$/, 'запомнили file_id отправленного фото');
  assert.equal(order.photo_status, 'pending');

  await pressButton(OWNER_ID + 1, `ph:ok:${orderId}`); // чужой заказ кнопкой не одобрить
  assert.equal((await shop.findOrder(orderId)).photo_status, 'pending');
  await pressButton(BUYER_ID, `ph:no:${orderId}`);
  assert.equal((await shop.findOrder(orderId)).photo_status, 'changes');
  assert.match(lastText(OWNER_ID), /просит изменить букет/);
  await sendText(BUYER_ID, 'Хочу больше лаванды');
  assert.match(lastText(OWNER_ID), /Хочу больше лаванды/);
  await pressButton(BUYER_ID, `ph:ok:${orderId}`);
  assert.equal((await shop.findOrder(orderId)).photo_status, 'approved');
  assert.equal(lastButtons(OWNER_ID)[0].callback_data, `st:${orderId}:delivering`);
});

test('напоминание о поводе через год: включить, посмотреть, удалить', async () => {
  await pressButton(BUYER_ID, `rem:${orderId}`);
  assert.equal(lastText(BUYER_ID), 'Какой был повод? 🎁');
  await pressButton(BUYER_ID, `rem:${orderId}:bd`);
  const reminder = await shop.database.reminder.findFirst({ where: { order_id: orderId } });
  const order = await shop.findOrder(orderId);
  const nextYear = String(Number(order.delivery_date.slice(0, 4)) + 1) + order.delivery_date.slice(4);
  assert.equal(reminder.event_date, nextYear);
  assert.equal(reminder.occasion, '🎂 День рождения');
  assert.equal(reminder.user_id, BUYER_ID);
  await pressButton(BUYER_ID, `rem:${orderId}`);
  assert.match(lastText(BUYER_ID), /^Уже напомню/);
  await sendText(BUYER_ID, '/reminders');
  assert.match(lastText(BUYER_ID), new RegExp(`🎂 День рождения — .*\\nНапомню .* \\(заказ №${orderId}\\)`));
  await pressButton(OWNER_ID, `remdel:${reminder.id}`); // чужое напоминание не удалить
  assert.ok(await shop.database.reminder.findUnique({ where: { id: reminder.id } }));
  await pressButton(BUYER_ID, `remdel:${reminder.id}`);
  assert.equal(await shop.database.reminder.findUnique({ where: { id: reminder.id } }), null);
});

test('оценка после доставки: низкая — просим рассказать, отзыв сохраняется и уходит владелице', async () => {
  await pressButton(OWNER_ID, `st:${orderId}:done`);
  await pressButton(BUYER_ID, `rate:${orderId}:2`);
  assert.equal((await shop.findOrder(orderId)).rating, 2);
  assert.match(lastText(BUYER_ID), /Расскажите, что пошло не так/);
  await sendText(BUYER_ID, 'Курьер опоздал');
  assert.equal((await shop.findOrder(orderId)).review_text, 'Курьер опоздал');
  assert.match(
    lastText(OWNER_ID),
    new RegExp(`📝 Отзыв к заказу №${orderId} от Анна \\(@anna\\):\\n\\nКурьер опоздал`),
  );
  assert.equal(lastText(BUYER_ID), 'Спасибо, что рассказали 🙏 Флорист свяжется с вами');
});

test('«Мои заказы» и сводка владелицы на завтра', async () => {
  await sendText(BUYER_ID, '/orders');
  assert.match(lastText(BUYER_ID), new RegExp(`<b>Заказ №${orderId}</b> · Доставлен`));
  await sendText(BUYER_ID, '/tomorrow');
  assert.equal(lastText(BUYER_ID), 'Команда только для владелицы 🌷');
  await sendText(OWNER_ID, '/tomorrow');
  assert.match(
    lastText(OWNER_ID),
    new RegExp(
      `^🌙 Завтра — \\d\\d\\.\\d\\d\\.\\d{4}\\n\\n<b>12:00–15:00</b> · №${orderId} 🌷\\n   Утро в Провансе \\(S\\) ×1`,
    ),
  );
  assert.match(lastText(OWNER_ID), /Итого: 1 доставка на 2\s780 ₽/);
  assert.match(lastText(OWNER_ID), /🚚 Санкт-Петербург/);
  assert.doesNotMatch(lastText(OWNER_ID), /Невский/, 'в сводке — зона доставки, адрес — в админке');
});
