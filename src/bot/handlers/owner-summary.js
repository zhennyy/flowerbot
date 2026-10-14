// /today и /tomorrow — что везём сегодня и завтра (только владелица)
const { summaryText } = require('../../summary');
const { moscowDate } = require('../../calendar');
const { adminKeyboard } = require('../keyboards');
const { isOwner } = require('../../owner');

function registerOwnerSummaryHandlers(bot) {
  const sendSummary = (plusDays, title) => async (context) => {
    if (!isOwner(context.from.id)) return context.reply('Команда только для владелицы 🌷');
    return context.reply(await summaryText(moscowDate(plusDays), title), { parse_mode: 'HTML', ...adminKeyboard() });
  };
  bot.command('today', sendSummary(0, '☀️ Сегодня'));
  bot.command('tomorrow', sendSummary(1, '🌙 Завтра'));
}

module.exports = { registerOwnerSummaryHandlers };
