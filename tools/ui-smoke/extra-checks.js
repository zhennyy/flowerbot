// Действия без скриншотов: проверяем, что кнопки работают и не сыплют ошибками (и найденные баги не вернулись).
const { BUYER_ID, THIRD_BUYER_ID, OWNER_ID, SAMPLE_PHOTO_PATH } = require('./test-data');
const { pressBackButton, telegramLog, isSheetOpen } = require('./browser');

const ADMIN = '/admin.html';
const isShown = (page, selector) => page.locator(selector).evaluate((element) => element.classList.contains('show'));
const card = (page, name) => page.locator('#grid .card', { hasText: name });

async function runBuyerChecks(runner, shop) {
  const { openPage, check, settle } = runner;
  const page = await openPage(BUYER_ID, { name: 'buyer-extra', waitFor: '#grid .card' });

  await card(page, 'Орхидея').click();
  await pressBackButton(page);
  check('«Назад» Telegram закрывает карточку товара', !(await isSheetOpen(page)));
  await card(page, 'Орхидея').click();
  await page.keyboard.press('Escape');
  check('Esc закрывает карточку товара', !(await isSheetOpen(page)));

  // склад: орхидей осталось 2 — третью положить нельзя
  await card(page, 'Орхидея').locator('.add').click();
  await card(page, 'Орхидея').locator('.qty button', { hasText: '+' }).click();
  await card(page, 'Орхидея').locator('.qty button', { hasText: '+' }).click();
  check(
    'больше остатка в корзину не кладётся',
    /осталось 2 шт/.test((await telegramLog(page)).alerts.at(-1)),
    (await telegramLog(page)).alerts.at(-1),
  );

  await page.fill('#q', 'тюльпан');
  await page.locator('#clearQ').click();
  check(
    'крестик очищает поиск',
    (await page.inputValue('#q')) === '' && (await page.locator('#grid .card').count()) === 14,
  );

  // поштучные: «Убрать из корзины» в карточке
  await card(page, 'Роза белая').locator('.add').click();
  await page.locator('#sheet .big').click();
  await card(page, 'Роза белая').locator('.pill').click();
  await page.locator('#sheet .remove').click();
  check(
    '«Убрать из корзины» убирает поштучные цветы',
    !(await isSheetOpen(page)) && (await card(page, 'Роза белая').locator('.add').count()) === 1,
  );

  // из карточки товара — сразу в корзину, оттуда в оформление и обратно кнопкой «Назад»
  await card(page, 'Полевой').click();
  await page.locator('#sheet .tocart').click();
  check('кнопка «Корзина» в карточке открывает корзину', await isShown(page, '#cartPage'));
  await page.locator('#cartFooter .big').click();
  await pressBackButton(page);
  check(
    '«Назад» из оформления возвращает в корзину',
    (await isShown(page, '#cartPage')) && !(await isShown(page, '#checkoutPage')),
  );
  await page.keyboard.press('Escape');
  check('Esc из корзины возвращает в каталог', !(await isShown(page, '#cartPage')));

  await page.locator('#hord').click();
  await page.waitForSelector('#myOrders .myord');
  const linksBefore = (await telegramLog(page)).links.length;
  await page.locator('#myOrders .mo-act .pay').first().click();
  check(
    '«Оплатить» в «Мои заказы» открывает ссылку на оплату',
    (await telegramLog(page)).links.length === linksBefore + 1,
  );
  await page.locator('#ordersPage .back').click();
  check('стрелка «←» закрывает «Мои заказы»', !(await isShown(page, '#ordersPage')));
  await page.context().close();

  // ссылка «Повторить заказ» из чата с ботом: витрина открывается с ?repeat=<номер>
  const doneOrder = await shop.database.order.findFirst({ where: { user_id: BUYER_ID, status: 'done' } });
  const repeat = await openPage(BUYER_ID, {
    name: 'buyer-repeat',
    pagePath: `/?repeat=${doneOrder.id}`,
    waitFor: '#cartPage.show',
  });
  await settle(repeat);
  check('?repeat= собирает корзину по заказу', (await repeat.locator('#cartLines .line').count()) === 2);
  await repeat.context().close();
}

async function runOwnerChecks(runner, shop) {
  const { openPage, check, settle } = runner;
  const fromNotification = await openPage(OWNER_ID, {
    name: 'owner-chat-link',
    pagePath: `${ADMIN}?chat=${THIRD_BUYER_ID}`,
    waitFor: '#msgs .bubble',
  });
  check('?chat= открывает переписку сразу', /Игорь/.test(await fromNotification.locator('#tName').innerText()));
  await fromNotification.locator('#thread .back').click();
  check('стрелка «←» закрывает переписку', await fromNotification.locator('#thread').isHidden());
  await fromNotification.context().close();

  const page = await openPage(OWNER_ID, { name: 'owner-extra', pagePath: ADMIN, waitFor: '#orders .ord' });
  const orderCard = (orderId) => page.locator('#orders .ord', { hasText: `Заказ №${orderId}` });
  await orderCard(6).locator('.iconbtn[aria-label="Написать"]').click();
  await page.waitForSelector('#msgs .bubble');
  check(
    '💬 из заказа открывает переписку с выбранным заказом',
    /№6/.test(await page.locator('#tOrders .f.active').innerText()),
  );
  await pressBackButton(page);

  // ⋯ → «Отменить заказ»: сначала «нет» в подтверждении, потом «да»
  await orderCard(6).locator('.iconbtn[aria-label="Ещё"]').click();
  await page.evaluate(() => {
    window.__confirmAnswer = false;
  });
  await orderCard(6).locator('.more-st .danger').click();
  await settle(page);
  check('отказ в подтверждении не отменяет заказ', (await shop.findOrder(6)).status === 'confirmed');
  await page.evaluate(() => {
    window.__confirmAnswer = true;
  });
  await orderCard(6).locator('.more-st .danger').click();
  await settle(page);
  check('заказ отменяется через «⋯»', (await shop.findOrder(6)).status === 'cancelled');

  // 📸 фото букета на согласование с телефона
  await page.locator('#orderFilters .f', { hasText: 'Все' }).click();
  await orderCard(3).locator('.iconbtn[aria-label="Фото на согласование"]').click();
  await page.setInputFiles('#bouquetFile', SAMPLE_PHOTO_PATH);
  await settle(page);
  check('фото букета отправлено покупателю', (await shop.findOrder(3)).photo_status === 'pending');

  await page.locator('.tab', { hasText: 'Букеты' }).click();
  await page.waitForSelector('#products .prod');
  const productRow = (name) => page.locator('#products .prod', { hasText: name });
  await productRow('Орхидея').locator('.icon[title="Показать/скрыть"]').click();
  await settle(page);
  check('👁 скрывает букет из витрины', (await shop.database.product.findUnique({ where: { id: 6 } })).in_stock === 0);
  await productRow('Орхидея').locator('.icon[title="Показать/скрыть"]').click();
  await settle(page);

  // новый букет с фото с телефона, потом удаление
  await page.locator('#productsView .add', { hasText: 'Добавить букет' }).click();
  await page.fill('#p_name', 'Тестовый букет');
  await page.fill('#p_price', '1500');
  await page.fill('#p_cat', 'Букеты');
  await page.setInputFiles('#p_file', SAMPLE_PHOTO_PATH);
  await page.waitForSelector('#p_preview img[src^="/uploads/"]');
  check('фото с телефона загружается в редакторе', true);
  await page.locator('#pForm .upload.ghost').click();
  check(
    '«Убрать фото» очищает ссылку',
    (await page.inputValue('#p_photo')) === '' && (await page.locator('#p_preview img').count()) === 0,
  );
  await page.locator('#pForm .big').click();
  await page.waitForSelector('#products .prod:has-text("Тестовый букет")');
  await productRow('Тестовый букет').locator('.icon[title="Изменить"]').click();
  await page.locator('#pDelete').click();
  await settle(page);
  check(
    'букет удаляется после подтверждения',
    !(await shop.database.product.findFirst({ where: { name: 'Тестовый букет' } })),
  );
  await page.locator('#productsView .add', { hasText: 'Копия' }).click();
  await settle(page);
  check(
    'резервная копия запрошена',
    /резервной копией/.test((await telegramLog(page)).alerts.at(-1)),
    (await telegramLog(page)).alerts.at(-1),
  );
  await page.context().close();
}

// Админка, открытая не владелицей: опросы по таймеру не должны падать и стучаться в API
async function runDeniedChecks(runner) {
  const { openPage, check } = runner;
  for (const [userId, name] of [
    [BUYER_ID, 'admin-buyer-timers'],
    [null, 'admin-outside-timers'],
  ]) {
    const page = await openPage(userId, { name, pagePath: ADMIN, fakeTimers: true });
    await page.waitForSelector('.denied');
    const errorsBefore = runner.report.consoleErrors.length;
    let adminRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/admin/')) adminRequests++;
    });
    // ошибка в таймере страницы прерывает runFor — записываем её и проверяем дальше
    await page.clock
      .runFor(61000)
      .catch((error) => runner.report.consoleErrors.push(`[${name}] таймер: ${error.message.split('\n')[0]}`));
    await page.waitForTimeout(300);
    check(
      `${name}: за минуту без ошибок и без запросов к API`,
      runner.report.consoleErrors.length === errorsBefore && adminRequests === 0,
      `ошибок ${runner.report.consoleErrors.length - errorsBefore}, запросов ${adminRequests}`,
    );
    await page.context().close();
  }
}

async function runExtraChecks(runner, shop) {
  await runBuyerChecks(runner, shop);
  await runOwnerChecks(runner, shop);
  await runDeniedChecks(runner);
}

module.exports = { runExtraChecks };
