// Проверка запросов вкладки «Чаты»: id покупателя, текст ответа, file_id фото
const { ValidationError, createValidator, parsePositiveId, cleanText } = require('../../validation');

const MAX_FILE_ID_LENGTH = 256;

const chatUserValidator = createValidator((request) => {
  const userId = parsePositiveId(request.params.userId);
  if (!userId) throw new ValidationError('Чат не найден', 404);
  return { userId };
});

const chatMessageValidator = createValidator((request) => {
  const text = cleanText(request.body?.text, Infinity);
  if (!text) throw new ValidationError('Пустое сообщение');
  return { text, orderId: parsePositiveId(request.body.orderId) || null };
});

const fileIdValidator = createValidator((request) => {
  const fileId = String(request.params.fileId || '');
  if (!fileId || fileId.length > MAX_FILE_ID_LENGTH) throw new ValidationError('Фото не найдено', 404);
  return { fileId };
});

module.exports = { chatUserValidator, chatMessageValidator, fileIdValidator };
