// Вкладка «Чаты»: список диалогов с покупателями и счётчик непрочитанных на вкладке.
import { getElement, escapeHtml } from '../../shared/dom.js';
import { callAdminApi } from '../api.js';
import { timeOf, dayOf, nowAsDatabaseTime } from '../dates.js';

export const chatState = { chats: [] };

export async function loadChats() {
  try {
    const { chats, unread } = await callAdminApi('/chats');
    chatState.chats = chats;
    getElement('chatCount').hidden = !unread;
    getElement('chatCount').textContent = unread;
    if (!getElement('chatsView').hidden) renderChats();
  } catch { /* счётчик обновится при следующем опросе */ }
}

// Сегодняшнее сообщение — время, более раннее — дата
const lastMessageTime = (chat) => (dayOf(chat.created_at) === dayOf(nowAsDatabaseTime()) ? timeOf(chat.created_at) : dayOf(chat.created_at));

export function renderChats() {
  getElement('chatList').innerHTML = chatState.chats.length ? chatState.chats.map((chat) => `
    <div class="card chat ${chat.unread ? 'unread' : ''}" data-action="open-chat" data-user-id="${chat.user_id}">
      <div class="ava">${escapeHtml((chat.name || '?')[0].toUpperCase())}</div>
      <div class="mid"><div class="nm"><span>${escapeHtml(chat.name || 'Покупатель')}</span><small>${lastMessageTime(chat)}</small></div>
        <div class="last">${chat.direction === 'out' ? 'Вы: ' : ''}${chat.photo ? '📷 Фото ' : ''}${escapeHtml(chat.text || '')}</div></div>
      ${chat.unread ? `<span class="dot">${chat.unread}</span>` : ''}
    </div>`).join('') : '<div class="empty">Сообщений пока нет 🌿<br>Когда покупатель напишет боту, диалог появится здесь</div>';
}

/** Диалога с покупателем ещё нет (он не писал) — добавляем пустой в начало списка, чтобы открыть переписку из заказа */
export function ensureChatExists(order) {
  if (chatState.chats.some((chat) => chat.user_id === order.user_id)) return;
  chatState.chats.unshift({ user_id: order.user_id, name: order.customer_name, username: order.username, text: '', created_at: nowAsDatabaseTime(), unread: 0 });
}
