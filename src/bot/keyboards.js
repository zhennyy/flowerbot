// Кнопки под сообщениями бота
const { Markup } = require('telegraf');
const { findReminderByOrder } = require('../reminders');
const { shopUrl, adminUrl } = require('./links');

// Под подтверждением заказа — только то, что нужно сейчас
async function orderKeyboard(order) {
  const rows = [];
  if (!(await findReminderByOrder(order.id)))
    rows.push([Markup.button.callback('🔔 Напомнить о дате через год', `rem:${order.id}`)]);
  rows.push([Markup.button.callback('💬 Вопрос по заказу', `ask:${order.id}`)]);
  return Markup.inlineKeyboard(rows);
}

// Кнопки под заказом у владелицы: статусы, админка (там контакты и адрес) и «Написать покупателю»
const statusButtons = (order) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Подтвердить', `st:${order.id}:confirmed`),
      Markup.button.callback('💐 Собираем', `st:${order.id}:assembling`),
    ],
    [
      Markup.button.callback('🚚 В пути', `st:${order.id}:delivering`),
      Markup.button.callback('🌷 Доставлен', `st:${order.id}:done`),
    ],
    [
      Markup.button.callback('📸 Фото букета', `photo:${order.id}`),
      Markup.button.callback('❌ Отменить', `st:${order.id}:cancelled`),
    ],
    [
      Markup.button.webApp('⚙️ Открыть админку', adminUrl()),
      Markup.button.callback('↩️ Написать покупателю', `reply:${order.user_id}:${order.id}`),
    ],
  ]);

// Покупателю: одобрить фото букета или попросить изменить
const bouquetPhotoButtons = (orderId) =>
  Markup.inlineKeyboard([
    Markup.button.callback('👍 Всё отлично!', `ph:ok:${orderId}`),
    Markup.button.callback('✏️ Хочу изменить', `ph:no:${orderId}`),
  ]);

const shopAndOrdersRow = () => [
  Markup.button.webApp('💐 Магазин', shopUrl()),
  Markup.button.callback('📦 Мои заказы', 'my_orders'),
];
const adminKeyboard = () => Markup.inlineKeyboard([Markup.button.webApp('⚙️ Открыть админку', adminUrl())]);

module.exports = {
  shopUrl,
  adminUrl,
  orderKeyboard,
  statusButtons,
  bouquetPhotoButtons,
  shopAndOrdersRow,
  adminKeyboard,
};
