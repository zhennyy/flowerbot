// Экраны владелицы (admin.html): заказы и фильтры, смена статуса, чаты, статистика, букеты и редактор, доставка и календарь,
// а также админка, открытая покупателем и не из Telegram.
const helpers = require('../../src/server/test-helpers');
const { OWNER_ID, BUYER_ID, SECOND_BUYER_ID, moscowDate } = require('./test-data');
const { pressBackButton, telegramLog, DESKTOP_VIEWPORT } = require('./browser');

const ADMIN = '/admin.html';
const tab = (page, label) => page.locator('.tab', { hasText: label });
const orderCard = (page, orderId) => page.locator('#orders .ord', { hasText: `Заказ №${orderId}` });
const productRow = (page, name) => page.locator('#products .prod', { hasText: name });
const closeEditor = (page) => page.locator('#sheetWrap .sheet-bg').click({ position: { x: 10, y: 10 } });

async function runOrderScreens(runner, page, shop) {
  const { snap, check } = runner;
  await snap(page, 'o01-orders');
  for (const [label, screen] of [['Новые', 'o02-orders-new'], ['Сегодня', 'o03-orders-today'], ['Завтра', 'o04-orders-tomorrow'], ['Все', 'o05-orders-all']]) {
    await page.locator('#orderFilters .f', { hasText: label }).click();
    await snap(page, screen);
  }
  await page.fill('#orderSearch', 'Гатчина');
  await snap(page, 'o06-orders-search');
  await page.fill('#orderSearch', '');
  await page.locator('#orderFilters .f', { hasText: 'В работе' }).click();
  await orderCard(page, 6).locator('.iconbtn[aria-label="Ещё"]').click();
  await snap(page, 'o07-order-more');
  await orderCard(page, 6).locator('.iconbtn[aria-label="Ещё"]').click();

  // сценарий: смена статуса заказа главной кнопкой
  await orderCard(page, 3).locator('.primary', { hasText: 'Подтвердить' }).click();
  await snap(page, 'o08-order-confirmed');
  check('статус заказа №3 сменился на «подтверждён»', (await shop.findOrder(3)).status === 'confirmed');
  // фото ещё без ответа — передать курьеру после подтверждения
  await orderCard(page, 4).locator('.primary', { hasText: 'Ждём ответа' }).click();
  await runner.settle(page);
  const confirms = (await telegramLog(page)).confirms;
  check('«Ждём ответа» спрашивает подтверждение и отправляет в доставку', /без одобрения/.test(confirms.at(-1)) && (await shop.findOrder(4)).status === 'delivering');
}

async function runChatScreens(runner, page) {
  const { snap, check } = runner;
  await tab(page, 'Чаты').click();
  await page.waitForSelector('#chatList .chat');
  await snap(page, 'o09-chats');
  await page.locator('#chatList .chat', { hasText: 'Мария' }).click();
  await page.waitForSelector('#msgs .bubble');
  await snap(page, 'o10-thread');
  await page.locator('#quick .f', { hasText: 'Курьер выехал' }).click();
  check('быстрый ответ подставляется в поле', (await page.inputValue('#reply')) === 'Курьер выехал 🚚');
  await page.locator('#tOrders .f', { hasText: '№5' }).click();
  await page.locator('#sendBtn').click();
  await page.waitForFunction(() => document.querySelectorAll('#msgs .bubble.out').length === 3);
  const sent = helpers.sentTo(SECOND_BUYER_ID).at(-1);
  check('ответ покупателю отправлен с привязкой к заказу', /Курьер выехал/.test(helpers.textOf(sent)) && /№5/.test(helpers.textOf(sent)), helpers.textOf(sent));
  await pressBackButton(page);
  check('«Назад» Telegram закрывает переписку', await page.locator('#thread').isHidden());
}

async function runStatsScreens(runner, page) {
  const { snap } = runner;
  await tab(page, 'Статистика').click();
  await page.waitForSelector('#kpis .kpi');
  await snap(page, 'o11-stats');
  await page.locator('#period .f', { hasText: '7 дней' }).click();
  await snap(page, 'o12-stats-7-days');
  await page.locator('#chart .bar:not(.zero)').first().click();
  await snap(page, 'o13-stats-day-tip');
}

async function runProductScreens(runner, page, shop) {
  const { snap, check } = runner;
  await tab(page, 'Букеты').click();
  await page.waitForSelector('#products .prod');
  await snap(page, 'o14-products');
  await productRow(page, 'Утро в Провансе').locator('.icon[title="Изменить"]').click();
  await snap(page, 'o15-editor-sizes', { scroller: '#pForm' });
  await closeEditor(page);
  await productRow(page, 'Роза красная').locator('.icon[title="Изменить"]').click();
  await snap(page, 'o16-editor-stems', { scroller: '#pForm' });
  await closeEditor(page);
  await page.locator('#productsView .add', { hasText: 'Добавить букет' }).click();
  await snap(page, 'o17-editor-new', { scroller: '#pForm' });
  await page.fill('#p_price', '2000');
  await page.locator('#p_sizes_on').check();
  await page.locator('#sizesBox button', { hasText: 'Размер' }).click();
  await snap(page, 'o18-editor-new-sizes', { scroller: '#pForm' });
  await closeEditor(page);

  // сценарий: правка букета
  await productRow(page, 'Полевой').locator('.icon[title="Изменить"]').click();
  await page.fill('#p_name', 'Полевой букет');
  await page.fill('#p_qty', '7');
  await page.locator('#pForm .big').click();
  await page.waitForFunction(() => !document.getElementById('sheetWrap').classList.contains('open'));
  await snap(page, 'o19-products-after-edit');
  const edited = await shop.database.product.findUnique({ where: { id: 5 } });
  check('букет изменён', edited.name === 'Полевой букет' && edited.stock === 7, `${edited.name} ${edited.stock}`);
}

async function runDeliveryScreens(runner, page, shop) {
  const { snap, check } = runner;
  await tab(page, 'Доставка').click();
  await page.waitForSelector('#tiers .tier');
  await snap(page, 'o20-delivery');
  await page.locator('#deliveryView button', { hasText: 'Добавить зону' }).click();
  await page.fill('#r_base', '1090');
  await page.locator('#c_date').fill(moscowDate(3));
  await page.locator('#deliveryView button', { hasText: 'Закрыть дату' }).click();
  await snap(page, 'o21-delivery-edited');
  await page.locator('#deliveryView .big', { hasText: 'Сохранить тарифы' }).click();
  await runner.settle(page);
  const tariff = (await shop.call(OWNER_ID, 'GET', '/api/admin/delivery', undefined, { 'X-Forwarded-For': '10.1.0.2' })).body;
  check('тарифы сохранены: новая зона и базовая цена Ленобласти', tariff.city.length === 6 && tariff.region.base === 1090, JSON.stringify(tariff));
  await page.locator('#deliveryView .big', { hasText: 'Сохранить календарь' }).click();
  await runner.settle(page);
  const calendar = (await shop.call(OWNER_ID, 'GET', '/api/admin/calendar', undefined, { 'X-Forwarded-For': '10.1.0.2' })).body;
  check('выходной день сохранён', calendar.closed.includes(moscowDate(3)), JSON.stringify(calendar));
  await page.fill('#ph_timeout', '30');
  await page.locator('#deliveryView .big', { hasText: /^Сохранить$/ }).click();
  await runner.settle(page);
  check('срок согласования фото сохранён', /30 мин/.test((await telegramLog(page)).alerts.at(-1)), (await telegramLog(page)).alerts.at(-1));
}

async function runOwnerScreens(runner, shop) {
  const { openPage, snap } = runner;
  const page = await openPage(OWNER_ID, { pagePath: ADMIN, name: 'owner', waitFor: '#orders .ord' });
  await runOrderScreens(runner, page, shop);
  await runChatScreens(runner, page);
  await runStatsScreens(runner, page);
  await runProductScreens(runner, page, shop);
  await runDeliveryScreens(runner, page, shop);
  await page.context().close();

  const dark = await openPage(OWNER_ID, { pagePath: ADMIN, name: 'owner-dark', colorScheme: 'dark', waitFor: '#orders .ord' });
  await snap(dark, 'o22-orders-dark');
  await tab(dark, 'Статистика').click();
  await dark.waitForSelector('#kpis .kpi');
  await snap(dark, 'o23-stats-dark');
  await dark.context().close();

  const desktop = await openPage(OWNER_ID, { pagePath: ADMIN, name: 'owner-desktop', viewport: DESKTOP_VIEWPORT, waitFor: '#orders .ord' });
  await snap(desktop, 'o24-orders-desktop');
  await tab(desktop, 'Букеты').click();
  await desktop.waitForSelector('#products .prod');
  await desktop.locator('#products .prod', { hasText: 'Орхидея' }).locator('.icon[title="Изменить"]').click();
  await snap(desktop, 'o25-editor-desktop');
  await closeEditor(desktop);
  await tab(desktop, 'Чаты').click();
  await desktop.locator('#chatList .chat', { hasText: 'Игорь' }).click();
  await desktop.waitForSelector('#msgs .bubble');
  await snap(desktop, 'o26-thread-desktop');
  await desktop.context().close();

  const buyer = await openPage(BUYER_ID, { pagePath: ADMIN, name: 'admin-buyer', waitFor: '.denied' });
  await snap(buyer, 'o27-admin-buyer-denied');
  await buyer.context().close();
  const outside = await openPage(null, { pagePath: ADMIN, name: 'admin-outside', waitFor: '.denied' });
  await snap(outside, 'o28-admin-outside-telegram');
  await outside.context().close();
}

module.exports = { runOwnerScreens };
