// Фото готового букета: владелица присылает его покупателю, покупатель одобряет или просит изменить
const { Markup } = require('telegraf');
const { setPhotoStatus } = require('../../bouquet-photo');
const messages = require('../../chat/messages');
const { customerName, findOwnOrder } = require('../../chat');
const { adminUrl } = require('../links');
const { startWaiting } = require('../waiting');
const { isOwner, getOwnerId } = require('../../owner');

function registerBouquetPhotoHandlers(bot) {
  // Владелица нажала «📸 Фото букета» — следующее фото уйдёт покупателю
  bot.action(/^photo:(\d+)$/, async (context) => {
    if (!isOwner(context.from.id)) return context.answerCbQuery('Только для владелицы');
    await context.answerCbQuery();
    startWaiting(context.from.id, { type: 'photo', orderId: Number(context.match[1]) });
    return context.reply(`Пришлите фото букета для заказа №${context.match[1]} 📸`);
  });

  // Ответ покупателя на фото
  bot.action(/^ph:(ok|no):(\d+)$/, async (context) => {
    const order = await findOwnOrder(context.from.id, context.match[2]);
    if (!order) return context.answerCbQuery('Заказ не найден');
    const approved = context.match[1] === 'ok';
    await setPhotoStatus(order.id, approved ? 'approved' : 'changes');
    await context.answerCbQuery(approved ? 'Спасибо! 🌷' : 'Поправим 💐');
    await context.editMessageCaption(
      `📸 <b>Букет к заказу №${order.id}</b>\n${approved ? '✅ Вы одобрили букет — передаём курьеру 🚚' : '✏️ Флорист переделает букет и пришлёт новое фото'}`,
      { parse_mode: 'HTML' }).catch(() => {});
    await messages.saveMessage({
      user_id: order.user_id, name: customerName(context.from), username: context.from.username || null, order_id: order.id,
      direction: 'in', text: approved ? '👍 Букет одобрен' : '✏️ Просит изменить букет',
    });
    const ownerId = getOwnerId();
    if (ownerId) {
      const ownerButtons = approved
        ? [Markup.button.callback('🚚 В доставку', `st:${order.id}:delivering`)]
        : [Markup.button.webApp('📬 Открыть чат', adminUrl({ chat: order.user_id })), Markup.button.callback('📸 Новое фото', `photo:${order.id}`)];
      await bot.telegram.sendMessage(ownerId, approved
        ? `👍 <b>Покупатель одобрил букет</b> · заказ №${order.id}\nМожно отправлять курьера`
        : `✏️ <b>Покупатель просит изменить букет</b> · заказ №${order.id}\nЖдём комментарий — он придёт в чат`,
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([ownerButtons]) }).catch(() => {});
    }
    if (approved) return undefined;
    startWaiting(context.from.id, { type: 'ask', orderId: order.id });
    return context.reply('Напишите, что поправить (цвет, размер, упаковку…) — флорист переделает и пришлёт новое фото 💐');
  });
}

module.exports = { registerBouquetPhotoHandlers };
