// Каталог: букеты, цветы поштучно и допы к заказу
const { database } = require('../database');

// «Заканчивается»: поштучных цветов — 20 шт и меньше, букетов и допов — 2 и меньше
const LOW_STOCK_SINGLE_FLOWERS = 20;
const LOW_STOCK_BOUQUETS = 2;
const lowStockLimit = (product) => (product.unit === 'шт' ? LOW_STOCK_SINGLE_FLOWERS : LOW_STOCK_BOUQUETS);

// Размеры S/M/L хранятся JSON-строкой — наружу отдаём массивом
const parseProduct = (product) => product && { ...product, sizes: product.sizes ? JSON.parse(product.sizes) : null };

// Для витрины — только то, что в наличии
async function getShowcaseProducts() {
  const products = await database.product.findMany({
    where: { in_stock: 1, OR: [{ stock: null }, { stock: { gt: 0 } }] },
    orderBy: [{ sort: 'asc' }, { id: 'asc' }],
  });
  return products.map(parseProduct);
}

// Для админки — все, включая скрытые; допы в конце
async function getAllProducts() {
  const products = await database.product.findMany({ orderBy: [{ addon: 'asc' }, { sort: 'asc' }, { id: 'asc' }] });
  return products.map(parseProduct);
}

async function findProduct(productId) {
  if (!Number.isSafeInteger(productId)) return null;
  return parseProduct(await database.product.findUnique({ where: { id: productId } }));
}

// Новый товар — в конец каталога
async function addProduct(productData) {
  const { _max: maximum } = await database.product.aggregate({ _max: { sort: true } });
  const createdProduct = await database.product.create({ data: { ...productData, sort: (maximum.sort || 0) + 1 } });
  return createdProduct.id;
}

const updateProduct = (productId, productData) =>
  database.product.update({ where: { id: productId }, data: productData });
const deleteProduct = (productId) => database.product.deleteMany({ where: { id: productId } });

// Возвращает, сколько товаров получили фото (0 — такого товара нет)
async function setProductPhoto(productId, photoUrl) {
  const { count } = await database.product.updateMany({ where: { id: productId }, data: { photo_url: photoUrl } });
  return count;
}

// Что заканчивается на складе — для утренней сводки
async function getLowStock() {
  const countedProducts = await database.product.findMany({
    where: { stock: { not: null }, in_stock: 1 },
    select: { name: true, stock: true, unit: true },
    orderBy: [{ stock: 'asc' }, { id: 'asc' }],
  });
  return countedProducts.filter((product) => product.stock <= lowStockLimit(product));
}

module.exports = {
  parseProduct,
  getShowcaseProducts,
  getAllProducts,
  findProduct,
  addProduct,
  updateProduct,
  deleteProduct,
  setProductPhoto,
  getLowStock,
  lowStockLimit,
};
