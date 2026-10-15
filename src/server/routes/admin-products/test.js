// Админка: букеты — добавить, изменить, скрыть, удалить; загрузка фото с телефона
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const testHelpers = require('../../test-helpers');

const OWNER_ID = testHelpers.OWNER_ID;
let shop;

before(async () => {
  shop = await testHelpers.start();
});

const fakeJpeg = () =>
  'data:image/jpeg;base64,' +
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');

test('все букеты для админки: и скрытые, допы — в конце', async () => {
  await shop.database.product.update({ where: { id: 8 }, data: { in_stock: 0 } });
  const response = await shop.call(OWNER_ID, 'GET', '/api/admin/products');
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 19);
  assert.equal(response.body.find((product) => product.id === 8).in_stock, 0);
  assert.equal(response.body.at(-1).addon, 1);
  assert.equal(response.body[0].addon, 0);
});

test('новый букет с размерами: цена «от» — по самому маленькому, в конец каталога; ошибки формы', async () => {
  const created = await shop.call(OWNER_ID, 'POST', '/api/admin/products', {
    category: ' Букеты ',
    name: 'Осенний',
    price: 9999,
    bg: 'red',
    stock: '3',
    sizes: [
      { name: 'S', price: 2900, note: 'мал' },
      { name: 'L', price: 4900 },
      { name: '', price: 100 },
    ],
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const product = await shop.database.product.findUnique({ where: { id: created.body.id } });
  assert.equal(product.category, 'Букеты');
  assert.equal(product.price, 2900);
  assert.equal(product.bg, '#f6e3ea');
  assert.equal(product.stock, 3);
  assert.equal(product.sort, 205, 'после последнего допа (sort 204)');
  assert.deepEqual(JSON.parse(product.sizes), [
    { name: 'S', price: 2900, note: 'мал' },
    { name: 'L', price: 4900, note: '' },
  ]);

  assert.deepEqual(
    (await shop.call(OWNER_ID, 'POST', '/api/admin/products', { name: 'Без категории', price: 100 })).body,
    { error: 'Заполните название и категорию' },
  );
  assert.deepEqual(
    (await shop.call(OWNER_ID, 'POST', '/api/admin/products', { name: 'X', category: 'Y', price: 0 })).body,
    { error: 'Цена должна быть больше нуля' },
  );
  assert.match(
    (
      await shop.call(OWNER_ID, 'POST', '/api/admin/products', {
        name: 'X',
        category: 'Y',
        price: 10,
        photo_url: 'http://evil.test/a.jpg',
      })
    ).body.error,
    /https:\/\//,
  );
});

test('изменить и скрыть букет, удалить; несуществующий — «Букет не найден»', async () => {
  const product = await shop
    .call(OWNER_ID, 'GET', '/api/admin/products')
    .then((response) => response.body.find((item) => item.name === 'Осенний'));
  const hidden = await shop.call(OWNER_ID, 'PUT', `/api/admin/products/${product.id}`, {
    ...product,
    in_stock: false,
    unit: true,
    min_qty: 3,
  });
  assert.deepEqual(hidden.body, { ok: true });
  const updated = await shop.database.product.findUnique({ where: { id: product.id } });
  assert.equal(updated.in_stock, 0);
  assert.equal(updated.unit, 'шт');
  assert.equal(updated.min_qty, 3);
  assert.deepEqual((await shop.call(OWNER_ID, 'PUT', '/api/admin/products/99999', product)).body, {
    error: 'Букет не найден',
  });
  assert.deepEqual((await shop.call(OWNER_ID, 'DELETE', `/api/admin/products/${product.id}`)).body, { ok: true });
  assert.equal(await shop.database.product.findUnique({ where: { id: product.id } }), null);
  assert.equal((await shop.call(7501, 'DELETE', '/api/admin/products/1')).status, 403);
  assert.ok(await shop.database.product.findUnique({ where: { id: 1 } }));
});

test('загрузка фото: два JPEG в uploads рядом с базой, ссылка на миниатюру; не-JPEG отклоняется', async () => {
  const uploaded = await shop.call(OWNER_ID, 'POST', '/api/admin/upload', { full: fakeJpeg(), thumb: fakeJpeg() });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert.match(uploaded.body.url, /^\/uploads\/[0-9a-f-]{36}_min\.jpg$/);
  const fileName = path.basename(uploaded.body.url);
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'uploads', fileName)));
  assert.ok(fs.existsSync(path.join(process.env.DATA_DIR, 'uploads', fileName.replace('_min', ''))));
  assert.equal((await fetch(shop.base + uploaded.body.url)).status, 200);
  const uploadsBefore = fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).length;
  assert.deepEqual(
    (await shop.call(OWNER_ID, 'POST', '/api/admin/upload', { full: fakeJpeg(), thumb: 'R0lGODlh' })).body,
    { error: 'Это не похоже на фото (нужен JPEG)' },
  );
  assert.equal(
    fs.readdirSync(path.join(process.env.DATA_DIR, 'uploads')).length,
    uploadsBefore,
    'большое фото без миниатюры не сохраняем',
  );
});
