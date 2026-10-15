// Смена статуса заказа + сообщение покупателю. Общая для кнопок в чате и для админки.
const { Markup } = require('telegraf');
const { STATUSES, findOrder, restock, setOrderStatus, setStatusMessage } = require('./index');
const { statusNote } = require('./texts');
const { findProduct } = require('../catalog');
const { shopUrl } = require('../bot/links');

const userError = (message) => Object.assign(new Error(message), { expose: true });

// Фото букета из заказа (первый товар с фото, не доп) — для красивого статуса
async function orderPhoto(order) {
  if (order.bouquet_photo) return order.bouquet_photo; // настоящее фото собранного букета — лучше всего
  for (const orderItem of order.items) {
    const product = await findProduct(orderItem.id);
    if (!product || product.addon || !product.photo_url) continue;
    const fullSizePhoto = product.photo_url.replace(/_min\.webp$/, '.png').replace(/_min\.jpg$/, '.jpg');
    return fullSizePhoto.startsWith('/') ? new URL(fullSizePhoto, process.env.WEBAPP_URL).toString() : fullSizePhoto;
  }
  return null;
}

async function changeStatus(bot, orderId, status) {
  if (!Object.hasOwn(STATUSES, status)) throw userError('Неизвестный статус');
  const order = await findOrder(orderId);
  if (!order) throw userError('Заказ не найден');
  if (status === 'cancelled' && order.status !== 'cancelled') await restock(order, +1); // вернули цветы на склад
  if (order.status === 'cancelled' && status !== 'cancelled') await restock(order, -1);
  await setOrderStatus(orderId, status);
  const updatedOrder = await findOrder(orderId);
  // Прошлое сообщение о статусе убираем — в чате остаётся только актуальное
  if (order.status_msg_id) await bot.telegram.deleteMessage(order.user_id, order.status_msg_id).catch(() => {});
  let keyboard = {};
  if (status === 'done')
    keyboard = Markup.inlineKeyboard([Markup.button.webApp('🔁 Повторить заказ', shopUrl({ repeat: orderId }))]);
  if (status === 'cancelled')
    keyboard = Markup.inlineKeyboard([Markup.button.callback('💬 Написать флористу', `ask:${orderId}`)]);
  // С фото букета — живее. Если Telegram не смог загрузить картинку, отправим просто текст
  const photo = status === 'cancelled' ? null : await orderPhoto(updatedOrder);
  let sentMessage = photo
    ? await bot.telegram
        .sendPhoto(order.user_id, photo, { caption: statusNote(updatedOrder), parse_mode: 'HTML', ...keyboard })
        .catch(() => null)
    : null;
  if (!sentMessage) {
    sentMessage = await bot.telegram
      .sendMessage(order.user_id, statusNote(updatedOrder), { parse_mode: 'HTML', ...keyboard })
      .catch((sendError) => console.error('Не смогла написать покупателю:', sendError.message));
  }
  if (sentMessage?.message_id) await setStatusMessage(orderId, sentMessage.message_id);
  return updatedOrder;
}

module.exports = { changeStatus, orderPhoto };
