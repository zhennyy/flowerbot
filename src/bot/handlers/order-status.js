// Кнопки статусов под уведомлением о заказе (только владелица)
const { STATUSES } = require('../../orders');
const { orderText } = require('../../orders/texts');
const { changeStatus } = require('../../orders/status');
const { statusButtons } = require('../keyboards');
const { isOwner } = require('../../owner');

const MAX_CALLBACK_ANSWER_LENGTH = 190;

function registerOrderStatusHandlers(bot) {
  bot.action(/^st:(\d+):(\w+)$/, async (context) => {
    if (!isOwner(context.from.id)) return context.answerCbQuery('Только для владелицы');
    try {
      const order = await changeStatus(bot, Number(context.match[1]), context.match[2]);
      await context.editMessageText(orderText(order, true), { parse_mode: 'HTML', ...statusButtons(order.id) });
      return await context.answerCbQuery(STATUSES[order.status]);
    } catch (statusError) {
      return context.answerCbQuery(statusError.message.slice(0, MAX_CALLBACK_ANSWER_LENGTH));
    }
  });
}

module.exports = { registerOrderStatusHandlers };
