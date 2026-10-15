// Напоминания о поводах через год: «через 3 дня — день рождения, повторим букет?»
const { Markup } = require('telegraf');
const { database } = require('../database');
const { moscowDate, moscowHour } = require('../calendar');
const { findOrder } = require('../orders');
const { escapeHtml, formatDate } = require('../orders/texts');
const { shopUrl } = require('../bot/links');

const OCCASIONS = { bd: '🎂 День рождения', an: '💍 Годовщина', ot: '🌷 Другой повод' };
const DAYS_BEFORE_EVENT = 3;
const DAY_MS = 864e5;

const toIsoDate = (date) => date.toISOString().slice(0, 10);
// Та же дата через год (29 февраля → 1 марта, как date(..., '+1 year') в SQLite)
function plusOneYear(isoDate) {
  const date = new Date(isoDate + 'T00:00:00Z');
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return toIsoDate(date);
}

const findReminderByOrder = (orderId) => database.reminder.findFirst({ where: { order_id: orderId } });
const getUserReminders = (userId) =>
  database.reminder.findMany({ where: { user_id: Number(userId) }, orderBy: [{ event_date: 'asc' }, { id: 'asc' }] });
// Удалить можно только своё напоминание
const deleteReminder = (reminderId, userId) =>
  database.reminder.deleteMany({ where: { id: reminderId, user_id: Number(userId) } });

// Повод — дата доставки заказа; ровно через год, напомнить за 3 дня
async function addReminderForOrder(order, occasion) {
  const eventDate = new Date(order.delivery_date + 'T12:00:00Z');
  eventDate.setUTCFullYear(eventDate.getUTCFullYear() + 1);
  const remindDate = new Date(eventDate - DAYS_BEFORE_EVENT * DAY_MS);
  return database.reminder.create({
    data: {
      user_id: order.user_id,
      order_id: order.id,
      occasion,
      event_date: toIsoDate(eventDate),
      remind_at: toIsoDate(remindDate),
    },
  });
}

// Пора напомнить: дата наступила (по Москве)
const getDueReminders = () =>
  database.reminder.findMany({ where: { remind_at: { lte: moscowDate(0) } }, orderBy: { id: 'asc' } });

// Повод ежегодный — после напоминания переносим на следующий год
async function moveReminderToNextYear(reminder) {
  await database.reminder.update({
    where: { id: reminder.id },
    data: { event_date: plusOneYear(reminder.event_date), remind_at: plusOneYear(reminder.remind_at) },
  });
}

// Напоминаем днём, а не ночью: с 10 до 21 по Москве
const REMIND_FROM_HOUR = 10;
const REMIND_UNTIL_HOUR = 21;

async function sendDueReminders(bot) {
  const currentHour = moscowHour();
  if (currentHour < REMIND_FROM_HOUR || currentHour >= REMIND_UNTIL_HOUR) return;
  for (const reminder of await getDueReminders()) {
    const order = await findOrder(reminder.order_id);
    await moveReminderToNextYear(reminder); // повод ежегодный — следующий раз через год
    if (!order) continue;
    const giftNames = order.items.map((orderItem) => orderItem.name).join(', ');
    await bot.telegram
      .sendMessage(
        reminder.user_id,
        `🔔 Через 3 дня — ${reminder.occasion.toLowerCase()} (${formatDate(reminder.event_date)})${order.recipient ? `, ${escapeHtml(order.recipient)}` : ''}!\n` +
          `В прошлый раз вы дарили: ${escapeHtml(giftNames)}.\nПовторим или выберем что-то новое? 💐`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.webApp('🔁 Повторить тот же букет', shopUrl({ repeat: order.id }))],
            [Markup.button.webApp('💐 Выбрать другой', shopUrl())],
          ]),
        },
      )
      .catch((sendError) => console.error('Напоминание:', sendError.message));
  }
}

module.exports = {
  OCCASIONS,
  sendDueReminders,
  findReminderByOrder,
  getUserReminders,
  deleteReminder,
  addReminderForOrder,
  getDueReminders,
  moveReminderToNextYear,
  plusOneYear,
};
