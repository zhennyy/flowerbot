// Точка входа админки «Флёр»: вкладки, обработчики, автообновление заказов и счётчика непрочитанных, первая загрузка.
// Открыта не из Telegram или не владелицей — вместо админки замок, запросов по таймеру нет.
import { getElement } from '../shared/dom.js';
import { initTelegram, telegramInitData } from '../shared/telegram.js';
import { registerClickActions, listenForClickActions } from '../shared/actions.js';
import { showAccessDenied, isAccessDenied } from './api.js';
import { orderListActions, loadOrders, listenToOrderSearch } from './orders/order-list.js';
import { orderActions, listenToBouquetPhotoInput } from './orders/order-actions.js';
import { chatActions, openThread, listenToThreadInputs } from './chats/chat-thread.js';
import { loadChats } from './chats/chat-list.js';
import { productListActions, loadProducts } from './products/product-list.js';
import { productEditorActions, listenToEditorInputs } from './products/product-editor.js';
import { sizeActions, listenToSizeInputs } from './products/size-rows.js';
import { statsActions, loadStats } from './stats/stats-view.js';
import { deliveryTariffActions, loadDelivery, listenToTariffInputs } from './delivery/delivery-tariffs.js';
import { calendarActions } from './delivery/calendar-settings.js';

const ORDERS_REFRESH_MS = 30000;
const CHATS_REFRESH_MS = 15000;
// вкладка → её экран и загрузка
const TABS = {
  orders: { view: 'ordersView', load: loadOrders },
  products: { view: 'productsView', load: loadProducts },
  delivery: { view: 'deliveryView', load: loadDelivery },
  stats: { view: 'statsView', load: loadStats },
  chats: { view: 'chatsView', load: loadChats },
};

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
  Object.entries(TABS).forEach(([name, { view }]) => {
    getElement(view).hidden = name !== tabName;
  });
  TABS[tabName].load();
}

function startPolling() {
  // Заказы — раз в 30 секунд, пока открыта вкладка «Заказы»
  setInterval(() => {
    if (!isAccessDenied() && !getElement('ordersView').hidden && !document.hidden) loadOrders();
  }, ORDERS_REFRESH_MS);
  // Счётчик непрочитанных обновляется сам, на любой вкладке
  setInterval(() => !isAccessDenied() && !document.hidden && loadChats(), CHATS_REFRESH_MS);
}

initTelegram();
[
  orderListActions,
  orderActions,
  chatActions,
  productListActions,
  productEditorActions,
  sizeActions,
  statsActions,
  deliveryTariffActions,
  calendarActions,
  { 'switch-tab': (element) => switchTab(element.dataset.tab) },
].forEach(registerClickActions);
listenForClickActions();
listenToOrderSearch();
listenToBouquetPhotoInput();
listenToThreadInputs();
listenToEditorInputs();
listenToSizeInputs();
listenToTariffInputs();
startPolling();

if (!telegramInitData()) showAccessDenied('Админка открывается только из Telegram');
else {
  const chatUserId = new URLSearchParams(window.location.search).get('chat');
  if (chatUserId) {
    // открыли из уведомления «📬 Открыть чат»
    switchTab('chats');
    loadChats().then(() => openThread(Number(chatUserId)));
  } else {
    loadOrders();
    loadChats();
  }
}
