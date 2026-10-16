// Экраны покупателя: каталог, поиск, карточки товара (обычная, с размерами, поштучная), корзина с допами,
// оформление (город, Ленобласть, ошибка адреса, открытка, согласие на обработку данных), «спасибо», «Мои заказы»,
// повтор заказа, тёмная тема, ноутбук.
const { BUYER_ID, NEW_BUYER_ID, normalizeOrders } = require('./test-data');
const { telegramLog, DESKTOP_VIEWPORT } = require('./browser');

const card = (page, name) => page.locator('#grid .card', { hasText: name });

async function fillAddress(page, address) {
  await page.fill('#f_address', address);
  await page.locator('#f_address').blur();
  // расчёт доставки уходит на сервер после потери фокуса — ждём ответ, иначе «Заказать» успеет раньше
  await page.waitForTimeout(50);
  await page.waitForFunction(() => !document.getElementById('quote').textContent.includes('Считаем'));
}

async function runCatalogScreens(runner, page) {
  const { snap, check } = runner;
  await snap(page, 'b01-catalog');
  await page.locator('#chips .chip', { hasText: 'Розы' }).click();
  await snap(page, 'b02-catalog-category');
  await page.fill('#q', 'роз');
  await snap(page, 'b03-search');
  await page.fill('#q', 'кактус');
  await snap(page, 'b04-search-empty');
  await page.locator('#grid .empty button').click();
  check(
    '«Показать все букеты» очищает поиск',
    (await page.inputValue('#q')) === '' && (await page.locator('#grid .card').count()) === 14,
  );
  await page.locator('#chips .chip', { hasText: 'Все' }).click();

  await card(page, '51 красная роза').click();
  await snap(page, 'b05-sheet-simple', { scroller: '#sheet' });
  await page.locator('#sheet .big').click();
  await snap(page, 'b06-sheet-simple-in-cart', { scroller: '#sheet' });
  await page.locator('#sheet .x-close').click();

  await card(page, 'Утро в Провансе').click();
  await snap(page, 'b07-sheet-sizes', { scroller: '#sheet' });
  await page.locator('#sheet .size', { hasText: 'L' }).click();
  await page.locator('#sheet .big').click();
  await snap(page, 'b08-sheet-size-added', { scroller: '#sheet' });
  await page.locator('#sheetWrap .sheet-bg').click({ position: { x: 10, y: 10 } });

  await card(page, 'Роза красная, 60 см').click();
  await snap(page, 'b09-sheet-stems', { scroller: '#sheet' });
  await page.locator('#sheet .preset', { hasText: '15' }).click();
  await page.locator('#sheet .stepper button[aria-label="Больше"]').click();
  await snap(page, 'b10-sheet-stems-16', { scroller: '#sheet' });
  await page.locator('#sheet .big').click();
  await card(page, 'Шляпная коробка').locator('.add').click();
  await snap(page, 'b11-catalog-with-cart');
  check(
    'в корзине 4 позиции',
    /4 товара/.test(await page.locator('#cartCount').innerText()),
    await page.locator('#cartCount').innerText(),
  );
}

// Согласие на обработку данных (152-ФЗ): без галочки «Заказать» неактивна и заказ не уходит,
// ссылка на документ открывается через Telegram.WebApp.openLink и галочку не ставит
async function checkConsentLock(runner, page, shop) {
  const { check } = runner;
  const ordersBefore = await shop.database.order.count();
  check('без согласия кнопка «Заказать» неактивна', await page.locator('#submitBtn').isDisabled());
  await page.locator('#submitBtn').click({ force: true });
  await page.waitForTimeout(300);
  check('без согласия заказ не отправляется', (await shop.database.order.count()) === ordersBefore);
  await page.locator('.consent-check a').click();
  const links = (await telegramLog(page)).links;
  check(
    'ссылка на согласие открывается через Telegram и не ставит галочку',
    links.at(-1)?.endsWith('/legal/consent.html') && !(await page.locator('#t_consent').isChecked()),
    JSON.stringify(links),
  );
  await page.locator('#t_consent').check();
  check('с согласием кнопка «Заказать» активна', await page.locator('#submitBtn').isEnabled());
}

async function runCartAndCheckout(runner, page, shop) {
  const { snap, check } = runner;
  await page.locator('#cartbar').click();
  await snap(page, 'b12-cart', { scroller: '#cartPage' });
  await page.locator('#addons .addon', { hasText: 'Стеклянная ваза' }).locator('.add').click();
  await page
    .locator('#cartLines .line', { hasText: '51 красная роза' })
    .locator('.qty button', { hasText: '+' })
    .click();
  await snap(page, 'b13-cart-changed', { scroller: '#cartPage' });

  await page.locator('#cartFooter .big').click();
  await snap(page, 'b14-checkout', { scroller: '#checkoutPage' });
  await page.fill('#f_phone', '+7 900 123-45-67');
  await fillAddress(page, 'Невский проспект, 1');
  await snap(page, 'b15-checkout-quote', { scroller: '#checkoutPage' });
  await page.locator('#zones .slot', { hasText: 'Ленобласть' }).click();
  await fillAddress(page, 'Гатчина, ул. Мира, 2');
  await snap(page, 'b16-checkout-region', { scroller: '#checkoutPage' });
  await checkConsentLock(runner, page, shop);
  await page.locator('#submitBtn').click();
  await snap(page, 'b17-checkout-no-time', { scroller: '#checkoutPage' });
  check(
    'без интервала — «Выберите время доставки»',
    /Выберите время/.test(await page.locator('#formError').innerText()),
  );

  await page.locator('#zones .slot', { hasText: 'Санкт-Петербург' }).click();
  await fillAddress(page, 'Псков, ул. Ленина, 1');
  await page.locator('#days .slot', { hasText: 'Завтра' }).click();
  await page.locator('#slots .slot', { hasText: '12:00–15:00' }).click();
  await page.locator('#submitBtn').click();
  await snap(page, 'b18-checkout-address-error', { scroller: '#checkoutPage' });
  check('с ошибкой адреса заказ не отправляется', /Проверьте адрес/.test(await page.locator('#formError').innerText()));

  await fillAddress(page, 'Невский проспект, 1');
  await page.locator('#t_recipient').check();
  await page.fill('#f_recipient', 'Ольга, +7 921 000-11-22');
  await page.locator('#t_card').check();
  await page.fill('#f_card', 'С годовщиной! 🌷');
  await page.fill('#f_comment', 'Домофон не работает');

  // сценарий: заказ на завтра → «спасибо» с оплатой → заказ виден в «Мои заказы»
  await page.locator('#slots .slot', { hasText: '15:00–18:00' }).click();
  await snap(page, 'b19-checkout-ready', { scroller: '#checkoutPage' });
  await page.locator('#submitBtn').click();
  await page.waitForSelector('#donePage.show');
  await snap(page, 'b20-done');
  await page.locator('#payBtn').click();
  const links = (await telegramLog(page)).links;
  check(
    '«Оплатить» открывает страницу ЮKassa',
    links.length === 2 && links[1].startsWith('https://pay.test/'),
    JSON.stringify(links),
  );
  check(
    'в заказе записано согласие на обработку данных',
    Boolean(
      (await shop.database.order.findFirst({ where: { user_id: BUYER_ID }, orderBy: { id: 'desc' } })).consent_at,
    ),
  );
  check(
    'корзина пуста после заказа',
    !(await page.locator('#cartbar').evaluate((element) => element.classList.contains('show'))),
  );
}

async function runOrderScreens(runner, page, shop) {
  const { snap, check } = runner;
  await normalizeOrders(shop);
  await page.locator('#backBtn').click();
  await page.locator('#hcart').click();
  await snap(page, 'b21-cart-empty', { scroller: '#cartPage' });
  await page.locator('#cartEmpty .big').click();
  await page.locator('#hord').click();
  await page.waitForSelector('#myOrders .myord');
  await snap(page, 'b22-my-orders', { scroller: '#ordersPage' });
  const newOrder = await shop.database.order.findFirst({ where: { user_id: BUYER_ID }, orderBy: { id: 'desc' } });
  const ordersText = await page.locator('#myOrders').innerText();
  check(
    'новый заказ виден в «Мои заказы»',
    ordersText.includes(`Заказ №${newOrder.id}`) && /Ждёт оплаты/.test(ordersText),
    ordersText.slice(0, 120),
  );
  check(
    'в заказе — открытка, получатель и интервал',
    newOrder.card_text === 'С годовщиной! 🌷' &&
      newOrder.recipient === 'Ольга, +7 921 000-11-22' &&
      newOrder.delivery_time === '15:00–18:00' &&
      newOrder.items.includes('"size":"L"'),
    JSON.stringify(newOrder).slice(0, 300),
  );

  await page
    .locator('#myOrders .myord', { hasText: 'С днём рождения, мама!' })
    .locator('.mo-act button', { hasText: 'Повторить' })
    .click();
  await page.waitForSelector('#cartPage.show');
  await snap(page, 'b23-repeat-order-cart', { scroller: '#cartPage' });
  const alerts = (await telegramLog(page)).alerts;
  check(
    '«Повторить» собирает корзину и сообщает об этом',
    /Собрали корзину по заказу/.test(alerts.at(-1)),
    alerts.at(-1),
  );
}

async function runBuyerScreens(runner, shop) {
  const { openPage, snap } = runner;
  const page = await openPage(BUYER_ID, { name: 'buyer', waitFor: '#grid .card' });
  await runCatalogScreens(runner, page);
  await runCartAndCheckout(runner, page, shop);
  await runOrderScreens(runner, page, shop);
  await page.context().close();

  const dark = await openPage(BUYER_ID, { name: 'buyer-dark', colorScheme: 'dark', waitFor: '#grid .card' });
  await snap(dark, 'b24-catalog-dark');
  await card(dark, 'Весенний микс').click();
  await snap(dark, 'b25-sheet-dark', { scroller: '#sheet' });
  await dark.locator('#sheet .x-close').click();
  await dark.locator('#hord').click();
  await dark.waitForSelector('#myOrders .myord');
  await snap(dark, 'b26-my-orders-dark', { scroller: '#ordersPage' });
  // оформление в тёмной теме: галочка согласия и ссылки должны читаться
  await dark.locator('#ordersPage .back').click();
  await card(dark, 'Весенний микс').click();
  await dark.locator('#sheet .big').click();
  await dark.locator('#sheet .x-close').click();
  await dark.locator('#cartbar').click();
  await dark.locator('#cartFooter .big').click();
  await snap(dark, 'b33-checkout-dark', { scroller: '#checkoutPage' });
  await dark.context().close();

  const desktop = await openPage(BUYER_ID, {
    name: 'buyer-desktop',
    viewport: DESKTOP_VIEWPORT,
    waitFor: '#grid .card',
  });
  await snap(desktop, 'b27-catalog-desktop');
  await card(desktop, 'Роза пионовидная').click();
  await snap(desktop, 'b28-sheet-desktop');
  await desktop.locator('#sheet .big').click();
  await desktop.keyboard.press('Escape');
  await desktop.locator('#cartbar').click();
  await snap(desktop, 'b29-cart-desktop', { scroller: '#cartPage' });
  await desktop.context().close();

  const newBuyer = await openPage(NEW_BUYER_ID, { name: 'new-buyer', waitFor: '#grid .card' });
  await newBuyer.locator('#hord').click();
  await newBuyer.waitForSelector('#myOrders .cart-empty .big');
  await snap(newBuyer, 'b30-my-orders-empty', { scroller: '#ordersPage' });
  await newBuyer.context().close();

  const outside = await openPage(null, { name: 'outside-telegram', waitFor: '#grid .card' });
  await snap(outside, 'b31-outside-telegram');
  await outside.locator('#hord').click();
  await snap(outside, 'b32-outside-my-orders', { scroller: '#ordersPage' });
  await outside.context().close();
}

module.exports = { runBuyerScreens };
