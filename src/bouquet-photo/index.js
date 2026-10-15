// Фото готового букета на согласование: отправить покупателю, принять ответ,
// напомнить на половине срока и считать одобренным, если ответа так и не было.
const { Markup } = require('telegraf');
const { database, toSqliteTimestamp, fromSqliteTimestamp } = require('../database');
const { findOrder, parseOrder } = require('../orders');
const { getSetting } = require('../settings');
const { getOwnerId } = require('../owner');
const { bouquetPhotoButtons } = require('../bot/keyboards');
const messages = require('../chat/messages');

const DEFAULT_TIMEOUT_MINUTES = 30; // 0 — ждать сколько угодно
const MINUTE_MS = 60000;
const userError = (message) => Object.assign(new Error(message), { expose: true });

const getPhotoTimeout = () => getSetting('photo_timeout', DEFAULT_TIMEOUT_MINUTES);

// photo — file_id из Telegram или { source: Buffer } (загрузка из админки)
async function sendBouquetPhoto(bot, orderId, photo) {
  const order = await findOrder(orderId);
  if (!order) throw userError(`Заказ №${orderId} не найден`);
  const sentPhoto = await bot.telegram.sendPhoto(order.user_id, photo, {
    caption: `📸 <b>Ваш букет к заказу №${order.id} готов!</b>\nПосмотрите, всё ли нравится? Курьера отправим сразу после вашего ответа 🌷`,
    parse_mode: 'HTML',
    ...bouquetPhotoButtons(order.id),
  });
  const fileId = sentPhoto.photo.at(-1).file_id; // самое большое разрешение
  await database.order.update({
    where: { id: order.id },
    data: { bouquet_photo: fileId, photo_status: 'pending', photo_sent_at: toSqliteTimestamp(), photo_reminded: 0 },
  });
  await messages.saveMessage({
    user_id: order.user_id,
    order_id: order.id,
    direction: 'out',
    text: '📸 Фото букета на согласование',
    photo: fileId,
    is_read: 1,
  });
  return findOrder(order.id);
}

// 'approved' одобрен · 'changes' просят изменить · 'auto' — ответа не было
const setPhotoStatus = (orderId, photoStatus) =>
  database.order.update({ where: { id: orderId }, data: { photo_status: photoStatus } });

// Фото ждут ответа: waitedMinutes — сколько минут прошло с отправки
async function getPendingPhotos(now = Date.now()) {
  const waitingOrders = await database.order.findMany({
    where: { photo_status: 'pending', status: { notIn: ['done', 'cancelled'] } },
  });
  return waitingOrders.map((order) => ({
    ...parseOrder(order),
    waitedMinutes: (now - fromSqliteTimestamp(order.photo_sent_at)) / MINUTE_MS,
  }));
}

// Фото без ответа: на половине срока — напоминание, по истечении — считаем одобренным
async function checkPhotoTimeouts(bot) {
  const timeoutMinutes = await getPhotoTimeout();
  if (!timeoutMinutes) return;
  const ownerId = getOwnerId();
  for (const order of await getPendingPhotos()) {
    if (order.waitedMinutes >= timeoutMinutes) {
      await setPhotoStatus(order.id, 'auto');
      await messages.saveMessage({
        user_id: order.user_id,
        order_id: order.id,
        direction: 'out',
        text: '⏰ Ответа не было — отправляем букет как на фото',
        is_read: 1,
      });
      await bot.telegram
        .sendMessage(
          order.user_id,
          `⏰ Мы не дождались ответа по фото букета (заказ №${order.id}) — отправляем его как на фото 🌷\nЕсли что-то не так, просто напишите сюда.`,
        )
        .catch(() => {});
      if (ownerId) {
        await bot.telegram
          .sendMessage(
            ownerId,
            `⏰ <b>Покупатель не ответил ${timeoutMinutes} мин</b> · заказ №${order.id}\nСчитаем букет одобренным — можно отправлять курьера`,
            {
              parse_mode: 'HTML',
              ...Markup.inlineKeyboard([Markup.button.callback('🚚 В доставку', `st:${order.id}:delivering`)]),
            },
          )
          .catch(() => {});
      }
    } else if (!order.photo_reminded && order.waitedMinutes >= timeoutMinutes / 2) {
      await database.order.update({ where: { id: order.id }, data: { photo_reminded: 1 } });
      const minutesLeft = Math.max(1, Math.round(timeoutMinutes - order.waitedMinutes));
      await bot.telegram
        .sendMessage(
          order.user_id,
          `🌷 Ждём ваш ответ по фото букета (заказ №${order.id}) ☝️\nЕсли не ответите за ${minutesLeft} мин — отправим букет как на фото.`,
          bouquetPhotoButtons(order.id),
        )
        .catch(() => {});
    }
  }
}

module.exports = {
  sendBouquetPhoto,
  setPhotoStatus,
  getPendingPhotos,
  checkPhotoTimeouts,
  getPhotoTimeout,
  DEFAULT_TIMEOUT_MINUTES,
};
