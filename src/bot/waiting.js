// «Режимы ожидания»: бот ждёт от человека текст или фото.
// Например, после «Написать флористу» следующее сообщение уйдёт флористу. Ожидание забывается через 15 минут.
const WAITING_TTL_MS = 15 * 60000;

const waitingByUser = new Map(); // id пользователя → { type, orderId, toUser, until }

// type: 'ask' — вопрос флористу, 'reply' — ответ владелицы покупателю, 'photo' — фото букета, 'review' — текст отзыва
function startWaiting(userId, waitingData) {
  waitingByUser.set(String(userId), { ...waitingData, until: Date.now() + WAITING_TTL_MS });
}

// Чего ждём от пользователя (или null, если ничего или ожидание истекло)
function peekWaiting(userId) {
  const waiting = waitingByUser.get(String(userId));
  if (!waiting || waiting.until < Date.now()) {
    waitingByUser.delete(String(userId));
    return null;
  }
  return waiting;
}

const stopWaiting = (userId) => waitingByUser.delete(String(userId));

module.exports = { startWaiting, peekWaiting, stopWaiting };
