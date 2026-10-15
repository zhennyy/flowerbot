// Переписка покупатель ⇄ флорист: всё сохраняется для вкладки «Чаты» в админке
const { database } = require('../database');

const CHATS_LIMIT = 100;
const CHAT_HISTORY_LIMIT = 200;

const saveMessage = (message) =>
  database.message.create({
    data: {
      name: null,
      username: null,
      order_id: null,
      text: null,
      photo: null,
      is_read: 0,
      ...message,
      user_id: Number(message.user_id),
    },
  });

// Список диалогов: последнее сообщение, имя, сколько непрочитанных
async function listChats() {
  const lastMessageIds = await database.message.groupBy({ by: ['user_id'], _max: { id: true } });
  const lastMessages = await database.message.findMany({
    where: { id: { in: lastMessageIds.map((group) => group._max.id) } },
    orderBy: { id: 'desc' },
    take: CHATS_LIMIT,
  });
  const userIds = lastMessages.map((message) => message.user_id);
  // Имя и username — из последнего сообщения, где они были
  const namedMessages = await database.message.findMany({
    where: { user_id: { in: userIds }, OR: [{ name: { not: null } }, { username: { not: null } }] },
    select: { user_id: true, name: true, username: true },
    orderBy: { id: 'desc' },
  });
  const latestName = new Map();
  const latestUsername = new Map();
  for (const message of namedMessages) {
    if (message.name != null && !latestName.has(message.user_id)) latestName.set(message.user_id, message.name);
    if (message.username != null && !latestUsername.has(message.user_id))
      latestUsername.set(message.user_id, message.username);
  }
  const unreadGroups = await database.message.groupBy({
    by: ['user_id'],
    where: { user_id: { in: userIds }, direction: 'in', is_read: 0 },
    _count: { _all: true },
  });
  const unreadByUser = new Map(unreadGroups.map((group) => [group.user_id, group._count._all]));
  return lastMessages.map((message) => ({
    user_id: message.user_id,
    text: message.text,
    photo: message.photo,
    direction: message.direction,
    created_at: message.created_at,
    name: latestName.get(message.user_id) ?? null,
    username: latestUsername.get(message.user_id) ?? null,
    unread: unreadByUser.get(message.user_id) || 0,
  }));
}

// Последние 200 сообщений диалога, по порядку
async function getChatHistory(userId) {
  const latestMessages = await database.message.findMany({
    where: { user_id: userId },
    orderBy: { id: 'desc' },
    take: CHAT_HISTORY_LIMIT,
  });
  return latestMessages.reverse();
}

const markChatRead = (userId) =>
  database.message.updateMany({ where: { user_id: userId, direction: 'in' }, data: { is_read: 1 } });
const countUnread = () => database.message.count({ where: { direction: 'in', is_read: 0 } });

module.exports = { saveMessage, listChats, getChatHistory, markChatRead, countUnread };
