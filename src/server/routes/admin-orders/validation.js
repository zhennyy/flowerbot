// Проверка запросов админки по заказам: номер заказа, новый статус, фото готового букета
const { ValidationError, createValidator, parsePositiveId } = require('../../validation');
const { STATUSES } = require('../../../orders');
const { decodeJpeg } = require('../../photos');

const statusChangeValidator = createValidator((request) => {
  const status = String(request.body?.status ?? '');
  if (!Object.hasOwn(STATUSES, status)) throw new ValidationError('Неизвестный статус');
  return { orderId: parsePositiveId(request.params.id), status };
});

const bouquetPhotoValidator = createValidator((request) => ({
  orderId: parsePositiveId(request.params.id),
  bouquetPhoto: decodeJpeg(request.body?.full),
}));

module.exports = { statusChangeValidator, bouquetPhotoValidator };
