// Админка, вкладка «Чаты»: список диалогов, переписка с покупателем, ответ, фото из переписки
const express = require('express');
const messages = require('../../../chat/messages');
const { sendToBuyer } = require('../../../chat');
const { STATUSES, getUserOrders } = require('../../../orders');
const { asyncHandler } = require('../../async-handler');
const { chatUserValidator, chatMessageValidator, fileIdValidator } = require('./validation');

const CHAT_ORDERS_LIMIT = 10;
const PHOTO_TIMEOUT_MS = 15000;

function createAdminChatsRouter({ bot, ownerAuth }) {
  const router = express.Router();

  router.get('/chats', ownerAuth, asyncHandler(async (request, response) => {
    response.json({ chats: await messages.listChats(), unread: await messages.countUnread() });
  }));

  // Открыли переписку — сообщения покупателя прочитаны; рядом его последние заказы
  router.get('/chats/:userId', ownerAuth, chatUserValidator, asyncHandler(async (request, response) => {
    const { userId } = request.validated;
    await messages.markChatRead(userId);
    const buyerOrders = (await getUserOrders(userId, CHAT_ORDERS_LIMIT))
      .map((order) => ({ id: order.id, status: STATUSES[order.status], total: order.total, date: order.delivery_date }));
    response.json({ messages: await messages.getChatHistory(userId), orders: buyerOrders });
  }));

  router.post('/chats/:userId', ownerAuth, chatUserValidator, chatMessageValidator, asyncHandler(async (request, response) => {
    const { userId, text, orderId } = request.validated;
    try {
      await sendToBuyer(bot, userId, text, orderId);
    } catch (sendError) {
      return response.status(400).json({ error: 'Telegram не доставил сообщение: ' + sendError.message });
    }
    return response.json({ messages: await messages.getChatHistory(userId) });
  }));

  // Фото из переписки: Telegram хранит его у себя, отдаём через наш сервер (только владелице)
  router.get('/photo/:fileId', ownerAuth, fileIdValidator, asyncHandler(async (request, response) => {
    try {
      const fileLink = await bot.telegram.getFileLink(request.validated.fileId);
      const photoResponse = await fetch(fileLink, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
      if (!photoResponse.ok) return response.status(404).end();
      response.set('Content-Type', photoResponse.headers.get('content-type') || 'image/jpeg');
      return response.send(Buffer.from(await photoResponse.arrayBuffer()));
    } catch {
      return response.status(404).end();
    }
  }));

  return router;
}

module.exports = { createAdminChatsRouter };
