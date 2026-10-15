// Админка: букеты (добавить, изменить, скрыть, удалить) и загрузка фото с телефона
const express = require('express');
const catalog = require('../../../catalog');
const { saveUploadedPhoto } = require('../../photos');
const { asyncHandler } = require('../../async-handler');
const { productFormValidator, productIdValidator, photoUploadValidator } = require('./validation');

function createAdminProductsRouter({ ownerAuth }) {
  const router = express.Router();

  router.get(
    '/products',
    ownerAuth,
    asyncHandler(async (request, response) => response.json(await catalog.getAllProducts())),
  );

  router.post(
    '/products',
    ownerAuth,
    productFormValidator,
    asyncHandler(async (request, response) => {
      response.json({ id: await catalog.addProduct(request.validated.productData) });
    }),
  );

  router.put(
    '/products/:id',
    ownerAuth,
    productIdValidator,
    productFormValidator,
    asyncHandler(async (request, response) => {
      const { productId, productData } = request.validated;
      if (!(await catalog.findProduct(productId))) return response.status(400).json({ error: 'Букет не найден' });
      await catalog.updateProduct(productId, productData);
      return response.json({ ok: true });
    }),
  );

  router.delete(
    '/products/:id',
    ownerAuth,
    productIdValidator,
    asyncHandler(async (request, response) => {
      await catalog.deleteProduct(request.validated.productId);
      response.json({ ok: true });
    }),
  );

  // Загрузка фото с телефона: админка сама сжимает картинку и присылает два JPEG — большой и маленький
  router.post('/upload', ownerAuth, photoUploadValidator, (request, response) => {
    response.json({ url: saveUploadedPhoto(request.validated.fullPhoto, request.validated.thumbnailPhoto) });
  });

  return router;
}

module.exports = { createAdminProductsRouter };
