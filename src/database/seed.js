// Стартовый ассортимент для пустой базы — тот же каталог, который получался у старого db.js на новой базе:
// 8 букетов, розы и хризантемы поштучно, допы к заказу и размеры S/M/L у трёх букетов.
// Фото из папки проекта public/photos потом ставит src/server/photos.js.
const { database } = require('./index');

const PHOTO_BASE = 'https://d8j0ntlcm91z4.cloudfront.net/user_3HReZJSR0X0kuSZvadzwtcMlq6H/hf_20260930_'; // фото из Higgsfield
const sizesJson = (sizeRows) => JSON.stringify(sizeRows.map(([name, price, note]) => ({ name, price, note })));

const STARTER_BOUQUETS = [
  { category: 'Букеты', name: 'Утро в Провансе', description: 'Лаванда, кустовая роза и эвкалипт', price: 2490, photo: '105120_0db73747-c724-451e-9b45-d5226df7b11e', badge: 'Хит', bg: '#e9e0f3',
    sizes: sizesJson([['S', 2490, 'компактный, ~25 см'], ['M', 3490, 'классический, ~35 см'], ['L', 4990, 'пышный, ~45 см']]) },
  { category: 'Розы', name: '51 красная роза', description: 'Классика 60 см, в крафте', price: 7990, photo: '105122_0e80c362-c556-474f-b167-e3c2a035ea27', bg: '#f7dfe3' },
  { category: 'Тюльпаны', name: 'Весенний микс', description: '25 тюльпанов пастельных оттенков', price: 1890, photo: '105120_d151b758-d7a9-4bb9-8cdb-42f8af8360c9', badge: 'Новинка', bg: '#fbe6ec',
    sizes: sizesJson([['S', 1890, '15 тюльпанов'], ['M', 2890, '25 тюльпанов'], ['L', 4990, '51 тюльпан']]) },
  { category: 'В коробке', name: 'Шляпная коробка «Нежность»', description: 'Пионовидные розы и гортензия', price: 4590, photo: '105120_f37b613f-1a8d-4969-b4a7-03669d56966f', bg: '#f3e6dc' },
  { category: 'Букеты', name: 'Полевой', description: 'Ромашки, васильки, злаки', price: 1490, photo: '105120_ab07feb0-0329-4fca-96a3-98c517fdfa7f', bg: '#f5f0d8',
    sizes: sizesJson([['S', 1490, 'маленький'], ['M', 2190, 'средний'], ['L', 3290, 'большой']]) },
  { category: 'Комнатные', name: 'Орхидея фаленопсис', description: 'Белая, 2 ствола, в керамике', price: 3290, photo: '105122_4a1116b8-a0e5-42d2-a5e2-24c6a9f388fc', bg: '#e3efe4' },
  { category: 'Розы', name: 'Кустовая пудровая', description: '15 веток, лента в тон', price: 3990, photo: '105121_205f729e-9a0e-425f-ac41-3066ef28a855', bg: '#f9e4e8' },
  { category: 'В коробке', name: 'Коробка с макарунами', description: 'Розы + 6 макарун ручной работы', price: 5290, photo: '105121_571b8a8d-e475-431f-a42e-3a7f32ceaba9', bg: '#efe3f0' },
];

// Поштучно: единица «шт» и минимальное количество в заказе
const STARTER_SINGLE_FLOWERS = [
  { name: 'Роза красная, 60 см', description: 'Эквадор, крупный бутон. Соберём в букет по вашему количеству', price: 190, photo: '151740_e7dbaf90-2d2e-47b4-a053-8eb39a787509', badge: 'Хит', bg: '#f7dfe3', min_qty: 5 },
  { name: 'Роза белая, 60 см', description: 'Эквадор, чистый белый. Отлично смотрится в миксе с красной', price: 190, photo: '151741_dddd6e21-25b3-4ff2-8d69-0cddb8f6c4f7', bg: '#f3e6dc', min_qty: 5 },
  { name: 'Роза пионовидная', description: 'Пышная, ароматная, нежно-розовая', price: 390, photo: '151740_823907a8-4f4f-4a71-8ee9-b926b6ed088a', bg: '#f9e4e8', min_qty: 3 },
  { name: 'Хризантема одноголовая', description: 'Белая, крупный цветок, стоит до 3 недель', price: 220, photo: '151740_3794c6f3-0eb7-448f-9884-5a38e1cce683', bg: '#e3efe4', min_qty: 3 },
  { name: 'Хризантема кустовая', description: 'Ветка с 8–10 сиреневыми цветками', price: 250, photo: '151740_2c2402c6-06e4-4d56-b790-c7766f04774c', bg: '#e9e0f3', min_qty: 3 },
  { name: 'Хризантема Сантини', description: 'Ветка с зелёными помпончиками — для акцента в букете', price: 170, photo: '151742_0b757b7a-aa1f-42a2-a4ed-60fbf192a0a0', badge: 'Новинка', bg: '#f5f0d8', min_qty: 3 },
];

// Допы к заказу: показываются в корзине «Добавить к заказу», вместо фото — эмодзи
const STARTER_ADDONS = [
  { name: 'Стеклянная ваза', description: 'Чтобы букет сразу встал в воду', price: 690, bg: '#e3eef3', emoji: '🏺' },
  { name: 'Большая авторская открытка', description: 'Крафт, ручная каллиграфия', price: 250, bg: '#f3e6dc', emoji: '💌' },
  { name: 'Шоколад ручной работы', description: 'Бельгийский, 100 г, в подарочной коробке', price: 450, bg: '#efe3dc', emoji: '🍫' },
  { name: 'Воздушные шары, 5 шт', description: 'Пастельные, с гелием, держатся 2–3 дня', price: 990, bg: '#e9e0f3', emoji: '🎈' },
  { name: 'Мишка Тедди', description: 'Плюшевый, 25 см', price: 1290, bg: '#f5f0d8', emoji: '🧸' },
];

const SINGLE_FLOWERS_FIRST_SORT = 100;
const ADDONS_FIRST_SORT = 200;

function buildStarterProducts() {
  const bouquets = STARTER_BOUQUETS.map(({ photo, badge = null, sizes = null, ...bouquet }, position) => ({
    ...bouquet, photo_url: `${PHOTO_BASE}${photo}_min.webp`, badge, sizes, sort: position + 1,
  }));
  const singleFlowers = STARTER_SINGLE_FLOWERS.map(({ photo, badge = null, ...flower }, position) => ({
    ...flower, category: 'Поштучно', photo_url: `${PHOTO_BASE}${photo}_min.webp`, badge, unit: 'шт', sort: SINGLE_FLOWERS_FIRST_SORT + position,
  }));
  const addons = STARTER_ADDONS.map((addon, position) => ({ ...addon, category: 'Дополнения', addon: 1, sort: ADDONS_FIRST_SORT + position }));
  return [...bouquets, ...singleFlowers, ...addons];
}

async function seedDatabase() {
  if (await database.product.count()) return;
  const starterProducts = buildStarterProducts();
  await database.product.createMany({ data: starterProducts });
  console.log('🌱 База создана, добавлено букетов:', starterProducts.length);
}

module.exports = { seedDatabase, buildStarterProducts };
