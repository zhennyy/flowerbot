// Открытая переписка с покупателем: сообщения по дням, фото, заказы покупателя (ответ можно привязать к заказу),
// быстрые ответы и отправка. Новые сообщения подтягиваются сами раз в 8 секунд.
import { getElement, escapeHtml } from '../../shared/dom.js';
import {
  vibrateNotification,
  showAlert,
  showBackButton,
  hideBackButton,
  onBackButton,
  openTelegramLink,
} from '../../shared/telegram.js';
import { callAdminApi, loadTelegramPhotosIn } from '../api.js';
import { timeOf, dayOf } from '../dates.js';
import { chatState, loadChats, ensureChatExists } from './chat-list.js';

const QUICK_REPLIES = [
  'Здравствуйте! 🌷',
  'Да, всё получится!',
  'Ваш букет уже собираем 💐',
  'Курьер выехал 🚚',
  'Спасибо за заказ! ❤️',
];
const REFRESH_INTERVAL_MS = 8000;
const NEAR_BOTTOM_PX = 60;
const MAX_REPLY_HEIGHT_PX = 120;

const threadState = {
  userId: null, // чья переписка открыта
  replyOrderId: null, // к какому заказу привязать ответ
  refreshTimer: null,
  lastMessageCount: 0,
};

export async function openThread(userId) {
  threadState.userId = userId;
  threadState.replyOrderId = null;
  const chat = chatState.chats.find((item) => item.user_id === userId) || {};
  getElement('tName').textContent = chat.name || 'Покупатель';
  getElement('tUser').innerHTML = chat.username
    ? `<a href="#" data-action="open-buyer-profile" data-username="${escapeHtml(chat.username)}">@${escapeHtml(chat.username)}</a>`
    : '';
  getElement('quick').innerHTML = QUICK_REPLIES.map(
    (reply) => `<button class="f" data-action="quick-reply">${escapeHtml(reply)}</button>`,
  ).join('');
  getElement('thread').hidden = false;
  showBackButton();
  await refreshThread(true);
  clearInterval(threadState.refreshTimer);
  threadState.refreshTimer = setInterval(() => !document.hidden && refreshThread(), REFRESH_INTERVAL_MS);
}

/** Из карточки заказа: открыть переписку с покупателем, ответ сразу привязан к этому заказу */
export function openChatAboutOrder(order) {
  ensureChatExists(order);
  openThread(order.user_id).then(() => {
    threadState.replyOrderId = order.id;
    refreshThread();
  });
}

export function closeThread() {
  getElement('thread').hidden = true;
  threadState.userId = null;
  clearInterval(threadState.refreshTimer);
  hideBackButton();
  loadChats();
}

async function refreshThread(scrollToEnd) {
  if (!threadState.userId) return;
  try {
    const { messages, orders } = await callAdminApi(`/chats/${threadState.userId}`);
    renderMessages(messages, scrollToEnd);
    getElement('tOrders').innerHTML = orders
      .map(
        (order) =>
          `<button class="f ${threadState.replyOrderId === order.id ? 'active' : ''}" data-action="toggle-reply-order" data-order-id="${order.id}">№${order.id} · ${escapeHtml(order.status)}</button>`,
      )
      .join('');
    loadChats();
  } catch (error) {
    getElement('msgs').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderMessages(messages, scrollToEnd) {
  const messagesBox = getElement('msgs');
  const wasAtBottom = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight < NEAR_BOTTOM_PX;
  let previousDay = '';
  messagesBox.innerHTML =
    messages
      .map((message) => {
        const day = dayOf(message.created_at);
        const daySeparator = day !== previousDay ? `<div class="day">${day}</div>` : '';
        previousDay = day;
        return `${daySeparator}<div class="bubble ${message.direction}">${message.photo ? `<img data-photo="${escapeHtml(message.photo)}" alt="Фото">` : ''}${escapeHtml(message.text || '')}<div class="meta2">${message.order_id ? `№${message.order_id} · ` : ''}${timeOf(message.created_at)}</div></div>`;
      })
      .join('') || '<div class="empty">Нет сообщений</div>';
  loadTelegramPhotosIn(messagesBox);
  // прокручиваем вниз, если были внизу или пришло новое сообщение
  if (scrollToEnd || wasAtBottom || messages.length > threadState.lastMessageCount)
    messagesBox.scrollTop = messagesBox.scrollHeight;
  threadState.lastMessageCount = messages.length;
}

async function sendReply() {
  const replyInput = getElement('reply');
  const text = replyInput.value.trim();
  if (!text || !threadState.userId) return;
  getElement('sendBtn').disabled = true;
  try {
    const { messages } = await callAdminApi(`/chats/${threadState.userId}`, {
      method: 'POST',
      body: { text, orderId: threadState.replyOrderId },
    });
    replyInput.value = '';
    replyInput.style.height = '';
    renderMessages(messages, true);
    vibrateNotification('success');
  } catch (error) {
    showAlert(error.message);
  } finally {
    getElement('sendBtn').disabled = false;
  }
}

export function listenToThreadInputs() {
  const replyInput = getElement('reply');
  // поле ответа растёт вместе с текстом
  replyInput.addEventListener('input', () => {
    replyInput.style.height = 'auto';
    replyInput.style.height = Math.min(MAX_REPLY_HEIGHT_PX, replyInput.scrollHeight) + 'px';
  });
  replyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendReply();
  }); // Cmd+Enter на компьютере
  onBackButton(() => {
    const thread = getElement('thread');
    if (thread && !thread.hidden) closeThread();
  });
}

export const chatActions = {
  'open-chat': (element) => openThread(Number(element.dataset.userId)),
  'close-thread': () => closeThread(),
  'send-reply': () => sendReply(),
  'quick-reply': (element) => {
    getElement('reply').value = element.textContent;
    getElement('reply').focus();
  },
  'toggle-reply-order': (element) => {
    const orderId = Number(element.dataset.orderId);
    threadState.replyOrderId = threadState.replyOrderId === orderId ? null : orderId;
    refreshThread();
  },
  'open-buyer-profile': (element, event) => {
    event.preventDefault();
    openTelegramLink(`https://t.me/${element.dataset.username}`);
  },
};
