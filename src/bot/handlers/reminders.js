// Напоминания о поводе через год: включить после заказа, посмотреть и удалить (/reminders)
const { Markup } = require('telegraf');
const reminders = require('../../reminders');
const { findOwnOrder } = require('../../chat');
const { formatDate } = require('../../orders/texts');

function registerReminderHandlers(bot) {
  // «🔔 Напомнить о дате через год» — спрашиваем повод
  bot.action(/^rem:(\d+)$/, async (context) => {
    const order = await findOwnOrder(context.from.id, context.match[1]);
    if (!order) return context.answerCbQuery('Заказ не найден');
    await context.answerCbQuery();
    const existingReminder = await reminders.findReminderByOrder(order.id);
    if (existingReminder)
      return context.reply(`Уже напомню ${formatDate(existingReminder.remind_at)} — за 3 дня до повода 🔔`);
    return context.reply(
      'Какой был повод? 🎁',
      Markup.inlineKeyboard([
        Object.entries(reminders.OCCASIONS).map(([occasionKey, occasionTitle]) =>
          Markup.button.callback(occasionTitle, `rem:${order.id}:${occasionKey}`),
        ),
      ]),
    );
  });

  bot.action(/^rem:(\d+):(bd|an|ot)$/, async (context) => {
    const order = await findOwnOrder(context.from.id, context.match[1]);
    if (!order) return context.answerCbQuery('Заказ не найден');
    if (await reminders.findReminderByOrder(order.id)) return context.answerCbQuery('Напоминание уже есть');
    const occasion = reminders.OCCASIONS[context.match[2]];
    const reminder = await reminders.addReminderForOrder(order, occasion);
    await context.answerCbQuery('Сохранено 🔔');
    return context
      .editMessageText(
        `Готово! ${occasion} — ${formatDate(reminder.event_date)}.\nНапомню ${formatDate(reminder.remind_at)}, за 3 дня 🔔`,
      )
      .catch(() => {});
  });

  bot.command('reminders', async (context) => {
    const userReminders = await reminders.getUserReminders(context.from.id);
    if (!userReminders.length)
      return context.reply('Напоминаний пока нет. Их можно включить кнопкой «🔔 Напомнить» после заказа');
    for (const reminder of userReminders) {
      await context.reply(
        `${reminder.occasion} — ${formatDate(reminder.event_date)}\nНапомню ${formatDate(reminder.remind_at)} (заказ №${reminder.order_id})`,
        Markup.inlineKeyboard([Markup.button.callback('❌ Удалить', `remdel:${reminder.id}`)]),
      );
    }
    return undefined;
  });

  bot.action(/^remdel:(\d+)$/, async (context) => {
    await reminders.deleteReminder(Number(context.match[1]), context.from.id);
    await context.answerCbQuery('Удалено');
    return context.editMessageText('Напоминание удалено 🗑').catch(() => {});
  });
}

module.exports = { registerReminderHandlers };
