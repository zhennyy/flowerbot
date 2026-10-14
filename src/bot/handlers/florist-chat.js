// Связь с флористом через бота (без раскрытия контактов): вопросы покупателей, ответы владелицы,
// фото от покупателя и фото букета от владелицы, текст отзыва. Подключается последним — ловит любой текст и фото.
const { Markup } = require('telegraf');
const messages = require('../../chat/messages');
const { sendToBuyer, customerName, MAX_MESSAGE_LENGTH } = require('../../chat');
const { sendBouquetPhoto } = require('../../bouquet-photo');
const { setReviewText, MAX_REVIEW_LENGTH } = require('../../reviews');
const { escapeHtml } = require('../../orders/texts');
const { adminUrl } = require('../links');
const { shopAndOrdersRow } = require('../keyboards');
const { startWaiting, peekWaiting, stopWaiting } = require('../waiting');
const { isOwner, getOwnerId } = require('../../owner');

// Не больше 20 сообщений флористу за 10 минут от одного человека — защита от флуда
const FLOOD_MAX_MESSAGES = 20;
const FLOOD_WINDOW_MS = 10 * 60000;
const MAX_TRACKED_USERS = 5000;
const messageTimesByUser = new Map();
function isTooChatty(userId) {
  const now = Date.now();
  const recentTimes = (messageTimesByUser.get(userId) || []).filter((messageTime) => now - messageTime < FLOOD_WINDOW_MS);
  recentTimes.push(now);
  messageTimesByUser.set(userId, recentTimes);
  if (messageTimesByUser.size > MAX_TRACKED_USERS) messageTimesByUser.clear();
  return recentTimes.length > FLOOD_MAX_MESSAGES;
}

// «Анна (@anna)» — для сообщений владелице
const senderLabel = (telegramUser, name) => `${escapeHtml(name)}${telegramUser.username ? ' (@' + escapeHtml(telegramUser.username) + ')' : ''}`;
const replyButtons = (bot, userId, orderId) => Markup.inlineKeyboard([
  Markup.button.callback('↩️ Ответить', `reply:${userId}:${orderId || 0}`),
  Markup.button.webApp('📬 Открыть чат', adminUrl({ chat: userId })),
]);

// Сообщение покупателя → флористу (и в историю переписки)
async function forwardFromBuyer(bot, context, { text = null, photo = null, orderId = null }) {
  if (isTooChatty(String(context.from.id))) return context.reply('Слишком много сообщений подряд — флорист ответит, как освободится 🌷');
  await messages.saveMessage({
    user_id: context.from.id, name: customerName(context.from), username: context.from.username || null,
    order_id: orderId || null, direction: 'in', text, photo,
  });
  const ownerId = getOwnerId();
  if (ownerId) {
    const heading = `💬 ${senderLabel(context.from, customerName(context.from))}${orderId ? ` · заказ №${orderId}` : ''}`;
    const keyboard = replyButtons(bot, context.from.id, orderId);
    if (photo) {
      await bot.telegram.sendPhoto(ownerId, photo, { caption: `${heading}${text ? '\n\n' + escapeHtml(text) : ''}`, parse_mode: 'HTML', ...keyboard }).catch(() => {});
    } else {
      await bot.telegram.sendMessage(ownerId, `${heading}:\n\n${escapeHtml(text.slice(0, MAX_MESSAGE_LENGTH))}`, { parse_mode: 'HTML', ...keyboard }).catch(() => {});
    }
  }
  return context.reply('Передала флористу ✅ Ответ придёт сюда, в этот чат', Markup.inlineKeyboard([shopAndOrdersRow()]));
}

// Номер заказа в подписи к фото: «12», «№12» или «#12» — но не «на 8 марта»
function orderIdFromCaption(caption = '') {
  const captionMatch = caption.match(/^\s*(?:№|#)?\s*(\d+)\s*$/) || caption.match(/(?:№|#)\s*(\d+)/);
  return captionMatch ? Number(captionMatch[1]) : null;
}

function registerFloristChatActions(bot) {
  bot.action(/^ask:(\d+)$/, async (context) => {
    await context.answerCbQuery();
    const orderId = Number(context.match[1]);
    startWaiting(context.from.id, { type: 'ask', orderId });
    return context.reply(`Напишите сообщение${orderId ? ` по заказу №${orderId}` : ''} — я передам флористу 💬\nМожно и фото`);
  });

  bot.action(/^reply:(\d+):(\d+)$/, async (context) => {
    if (!isOwner(context.from.id)) return context.answerCbQuery('Только для владелицы');
    await context.answerCbQuery();
    startWaiting(context.from.id, { type: 'reply', toUser: Number(context.match[1]), orderId: Number(context.match[2]) });
    return context.reply('Напишите ответ — отправлю покупателю ✍️');
  });
}

function registerIncomingMessageHandlers(bot) {
  bot.on('photo', async (context) => {
    const fileId = context.message.photo.at(-1).file_id; // самое большое разрешение
    if (!isOwner(context.from.id)) { // фото от покупателя (например, пример желаемого букета) — флористу
      const waiting = peekWaiting(context.from.id);
      stopWaiting(context.from.id);
      return forwardFromBuyer(bot, context, { photo: fileId, text: context.message.caption || null, orderId: waiting?.orderId });
    }
    const waiting = peekWaiting(context.from.id);
    const orderId = waiting?.type === 'photo' ? waiting.orderId : orderIdFromCaption(context.message.caption);
    if (!orderId) return context.reply('Чтобы отправить фото покупателю, подпишите его номером заказа, например «12» или «№12» 📸');
    stopWaiting(context.from.id);
    try {
      await sendBouquetPhoto(bot, orderId, fileId);
      return await context.reply(`Фото отправлено на согласование (заказ №${orderId}) ✅\nКак только покупатель ответит — напишу`);
    } catch (sendError) {
      return context.reply('Не получилось отправить: ' + sendError.message);
    }
  });

  bot.on('text', async (context) => {
    const text = context.message.text.trim();
    if (text.startsWith('/')) return context.reply('Не знаю такой команды 🤔 Попробуйте /start или /orders');
    const waiting = peekWaiting(context.from.id);

    if (waiting?.type === 'reply' && isOwner(context.from.id)) {
      stopWaiting(context.from.id);
      try {
        await sendToBuyer(bot, waiting.toUser, text, waiting.orderId);
        return await context.reply('Ответ отправлен ✅');
      } catch (sendError) {
        return context.reply('Не получилось отправить: ' + sendError.message);
      }
    }
    if (isOwner(context.from.id)) {
      return context.reply('Чтобы ответить покупателю, нажмите «↩️ Ответить» под его сообщением или откройте вкладку «💬 Чаты» в /admin');
    }
    if (waiting?.type === 'review') {
      stopWaiting(context.from.id);
      const reviewText = text.slice(0, MAX_REVIEW_LENGTH);
      await setReviewText(waiting.orderId, reviewText);
      await messages.saveMessage({
        user_id: context.from.id, name: customerName(context.from), username: context.from.username || null,
        order_id: waiting.orderId, direction: 'in', text: `📝 Отзыв: ${reviewText}`,
      });
      const ownerId = getOwnerId();
      if (ownerId) {
        await bot.telegram.sendMessage(ownerId,
          `📝 Отзыв к заказу №${waiting.orderId} от ${senderLabel(context.from, context.from.first_name || '')}:\n\n${escapeHtml(reviewText)}`,
          { parse_mode: 'HTML', ...replyButtons(bot, context.from.id, waiting.orderId) }).catch(() => {});
      }
      return context.reply('Спасибо, что рассказали 🙏 Флорист свяжется с вами');
    }

    // Любой текст покупателя — сообщение флористу (кнопку искать не нужно)
    stopWaiting(context.from.id);
    return forwardFromBuyer(bot, context, { text: text.slice(0, MAX_MESSAGE_LENGTH), orderId: waiting?.type === 'ask' ? waiting.orderId : null });
  });
}

module.exports = { registerFloristChatActions, registerIncomingMessageHandlers, forwardFromBuyer, orderIdFromCaption };
