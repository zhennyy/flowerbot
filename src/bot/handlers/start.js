// Приветствие, свой Telegram ID и вход в админку
const { Markup } = require('telegraf');
const { isOwner } = require('../../owner');

function registerStartHandlers(bot) {
  bot.start((context) => context.reply(
    `Привет, ${context.from.first_name}! 🌷\nЭто «Флёр» — свежие цветы с доставкой за 2 часа.\n\nЖми кнопку, чтобы открыть каталог. А если есть вопрос — просто напиши его сюда, флорист ответит 💬`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('💐 Открыть магазин', process.env.WEBAPP_URL)],
      [Markup.button.callback('📦 Мои заказы', 'my_orders'), Markup.button.callback('💬 Написать флористу', 'ask:0')],
    ]),
  ));

  bot.command('myid', (context) => context.reply(`Твой Telegram ID: ${context.from.id}\nВпиши его в .env как OWNER_ID=${context.from.id}`));

  bot.command('admin', (context) => {
    if (!isOwner(context.from.id)) return context.reply('Эта команда только для владелицы магазина 🌷');
    return context.reply(
      'Панель управления «Флёр» 🛠',
      Markup.inlineKeyboard([Markup.button.webApp('⚙️ Открыть админку', process.env.WEBAPP_URL.replace(/\/$/, '') + '/admin.html')]),
    );
  });
}

module.exports = { registerStartHandlers };
