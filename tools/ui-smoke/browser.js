// Браузерная часть проверки: подмена Telegram WebApp, страница с учётом запросов и ошибок консоли, скриншоты.
const fs = require('node:fs');
const path = require('node:path');
const helpers = require('../../src/server/test-helpers');
const { moscowDate } = require('./test-data');

const VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1100, height: 800 };

// Время в странице — сегодня 10:00 по Москве: интервалы «сегодня» и подписи «Сегодня/Завтра» одинаковые в любом прогоне
const pageNow = () => new Date(`${moscowDate(0)}T10:00:00+03:00`);

function telegramMock({ initData, user }) {
  // выполняется в странице до её скриптов: подменяем Telegram.WebApp и запоминаем, что с ним делали
  const telegramLog = { links: [], telegramLinks: [], alerts: [], confirms: [] };
  window.__telegramLog = telegramLog;
  window.__confirmAnswer = true;
  const backButton = {
    isVisible: false,
    callbacks: [],
    show() {
      this.isVisible = true;
    },
    hide() {
      this.isVisible = false;
    },
    onClick(callback) {
      this.callbacks.push(callback);
    },
  };
  window.Telegram = {
    WebApp: {
      initData,
      initDataUnsafe: user ? { user } : {},
      colorScheme: 'light',
      ready() {},
      expand() {},
      BackButton: backButton,
      HapticFeedback: { notificationOccurred() {}, selectionChanged() {}, impactOccurred() {} },
      showAlert(text) {
        telegramLog.alerts.push(text);
      },
      showConfirm(text, callback) {
        telegramLog.confirms.push(text);
        callback(window.__confirmAnswer);
      },
      openLink(url) {
        telegramLog.links.push(url);
      },
      openTelegramLink(url) {
        telegramLog.telegramLinks.push(url);
      },
    },
  };
}

// заранее известные ошибки сети: админка, открытая покупателем, получает 403 «Только для владелицы»;
// расчёт доставки по адресу вне зоны отвечает 400 с текстом ошибки (так и задумано — текст показывается под адресом)
const isExpectedFailure = (text, url, { pagePath, userId }) =>
  (/Failed to load resource.*status of 400/.test(text) && url.endsWith('/api/delivery-quote')) ||
  (/Failed to load resource.*status of 403/.test(text) && pagePath === '/admin.html' && userId !== helpers.OWNER_ID);

function createRunner(browser, baseUrl, outputDir) {
  const report = { screens: [], consoleErrors: [], expectedNetworkErrors: [], checks: [] };
  fs.mkdirSync(outputDir, { recursive: true });
  let contextNumber = 0;

  /**
   * Открывает страницу как пользователь Telegram (userId = null — не из Telegram, без подписанных данных).
   * pagePath: '/' — витрина, '/admin.html' — админка.
   */
  async function openPage(
    userId,
    { pagePath = '/', name, colorScheme = 'light', viewport = VIEWPORT, waitFor, fakeTimers = false },
  ) {
    contextNumber++;
    const context = await browser.newContext({
      viewport,
      isMobile: viewport === VIEWPORT,
      hasTouch: true,
      deviceScaleFactor: 1,
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      colorScheme,
      // у каждой страницы свой «адрес»: общий лимит 120 запросов к API в минуту рассчитан на одного посетителя
      extraHTTPHeaders: { 'X-Forwarded-For': `10.2.${Math.floor(contextNumber / 250)}.${(contextNumber % 250) + 1}` },
    });
    if (fakeTimers) await context.clock.install({ time: pageNow() });
    else await context.clock.setFixedTime(pageNow());
    const user = userId ? { id: userId, first_name: 'Анна', username: 'anna' } : null;
    await context.addInitScript(telegramMock, { initData: userId ? helpers.initData(userId) : '', user });
    // настоящий telegram-web-app.js перезаписал бы подмену, шрифты Google — внешняя сеть: отдаём пустые ответы
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const url = route.request().url();
      if (url.includes('telegram.org')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      if (url.includes('fonts.googleapis.com'))
        return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return route.abort();
    });
    const page = await context.newPage();
    let inFlight = 0;
    page.on('request', () => {
      inFlight++;
    });
    page.on('requestfinished', () => {
      inFlight--;
    });
    page.on('requestfailed', () => {
      inFlight--;
    });
    page.inFlight = () => inFlight;
    page.on('pageerror', (error) => report.consoleErrors.push(`[${name}] pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const url = message.location().url || '';
      const text = `[${name}] ${message.text()} ${url}`;
      if (isExpectedFailure(message.text(), url, { pagePath, userId })) report.expectedNetworkErrors.push(text);
      else report.consoleErrors.push(text);
    });
    await page.goto(baseUrl + pagePath);
    if (waitFor) await page.waitForSelector(waitFor);
    if (!fakeTimers) await settle(page);
    return page;
  }

  /** Ждём, пока закончатся запросы, анимации и загрузка картинок */
  async function settle(page) {
    for (let quietChecks = 0, attempts = 0; quietChecks < 3 && attempts < 100; attempts++) {
      await page.waitForTimeout(100);
      quietChecks = page.inFlight() === 0 ? quietChecks + 1 : 0;
    }
    // «ленивые» картинки ниже экрана на длинном скриншоте могли бы не успеть загрузиться
    await page.evaluate(() =>
      document.querySelectorAll('img[loading="lazy"]').forEach((image) => {
        image.loading = 'eager';
      }),
    );
    await page
      .waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(800); // полёт «в корзину» и лепестки — 650 мс
  }

  /**
   * Скриншот всей страницы. scroller — экран со своей прокруткой поверх страницы (корзина, оформление, шторка):
   * его содержимое длиннее окна, поэтому снимаем окно дважды — в начале и прокрутив экран до конца (файл «…-bottom»).
   */
  async function snap(page, name, { scroller } = {}) {
    await settle(page);
    // клики Playwright прокручивают окно по-разному — снимаем всегда с начала страницы (липкие вкладки и фон под шторкой)
    await page.evaluate(() => window.scrollTo(0, 0));
    const shoot = (fileName) =>
      page.screenshot({
        path: path.join(outputDir, fileName + '.png'),
        fullPage: !scroller,
        animations: 'disabled',
        caret: 'hide',
      });
    if (!scroller) {
      // на снимке во всю высоту закрытая шторка и спрятанная плашка корзины (уехавшие вниз за экран) попали бы в кадр —
      // прячем их на время съёмки
      const hideClosedSheet = (hidden) =>
        page.evaluate((hide) => {
          document.querySelectorAll('#sheetWrap:not(.open) .sheet, .cartbar:not(.show)').forEach((element) => {
            element.style.visibility = hide ? 'hidden' : '';
          });
        }, hidden);
      await hideClosedSheet(true);
      await shoot(name);
      await hideClosedSheet(false);
    } else {
      const scrollerElement = page.locator(scroller);
      const startScroll = await scrollerElement.evaluate((element) => {
        const top = element.scrollTop;
        element.scrollTop = 0;
        return top;
      });
      await shoot(name);
      const scrollable = await scrollerElement.evaluate((element) => element.scrollHeight > element.clientHeight + 1);
      if (scrollable) {
        await scrollerElement.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await page.waitForTimeout(100);
        await shoot(name + '-bottom');
      }
      await scrollerElement.evaluate((element, top) => {
        element.scrollTop = top;
      }, startScroll);
    }
    const telegramState = await page.evaluate(() => {
      const webApp = window.Telegram.WebApp;
      const log = window.__telegramLog;
      return {
        backButton: webApp.BackButton.isVisible,
        alerts: log.alerts.length,
        lastAlert: log.alerts.at(-1) || null,
        links: log.links.length,
      };
    });
    report.screens.push({ name, ...telegramState });
  }

  function check(description, passed, details = '') {
    report.checks.push({ description, passed: Boolean(passed), details });
    if (!passed) console.error('ПРОВАЛ:', description, details);
  }

  return { report, openPage, snap, settle, check };
}

const pressBackButton = (page) =>
  page.evaluate(() => window.Telegram.WebApp.BackButton.callbacks.forEach((callback) => callback()));
const telegramLog = (page) => page.evaluate(() => window.__telegramLog);
const isSheetOpen = (page) => page.evaluate(() => document.getElementById('sheetWrap').classList.contains('open'));

module.exports = { createRunner, pressBackButton, telegramLog, isSheetOpen, VIEWPORT, DESKTOP_VIEWPORT };
