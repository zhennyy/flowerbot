// Кнопки под сообщениями бота
const { Markup } = require('telegraf');
const { findReminderByOrder } = require('../reminders');
const { shopUrl, adminUrl } = require('./links');

// Под подтверждением заказа — только то, что нужно сейчас
async function orderKeyboard(order) {
  const rows = [];
  if (!(await findReminderByOrder(order.id))) rows.push([Markup.button.callback('🔔 Напомнить о дате через год', `rem:${order.id}`)]);
  rows.push([Markup.button.callback('💬 Вопрос по заказу', `ask:${order.id}`)]);
  return Markup.inlineKeyboard(rows);
}

// Кнопки смены статуса под сообщением владелице
const statusButtons = (orderId) => Markup.inlineKeyboard([
  [Markup.button.callback('✅ Подтвердить', `st:${orderId}:confirmed`), Markup.button.callback('💐 Собираем', `st:${orderId}:assembling`)],
  [Markup.button.callback('🚚 В пути', `st:${orderId}:delivering`), Markup.button.callback('🌷 Доставлен', `st:${orderId}:done`)],
  [Markup.button.callback('📸 Фото букета', `photo:${orderId}`), Markup.button.callback('❌ Отменить', `st:${orderId}:cancelled`)],
]);

// Покупателю: одобрить фото букета или попросить изменить
const bouquetPhotoButtons = (orderId) => Markup.inlineKeyboard([
  Markup.button.callback('👍 Всё отлично!', `ph:ok:${orderId}`),
  Markup.button.callback('✏️ Хочу изменить', `ph:no:${orderId}`),
]);

const shopAndOrdersRow = () => [Markup.button.webApp('💐 Магазин', shopUrl()), Markup.button.callback('📦 Мои заказы', 'my_orders')];
const adminKeyboard = () => Markup.inlineKeyboard([Markup.button.webApp('⚙️ Открыть админку', adminUrl())]);

module.exports = { shopUrl, adminUrl, orderKeyboard, statusButtons, bouquetPhotoButtons, shopAndOrdersRow, adminKeyboard };
