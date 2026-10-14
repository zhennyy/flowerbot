// Вкладка «Заказы»: фильтры (в работе, новые, сегодня, завтра, все), поиск, список карточек, счётчик новых.
import { getElement, escapeHtml } from '../../shared/dom.js';
import { vibrateNotification } from '../../shared/telegram.js';
import { callAdminApi, loadTelegramPhotosIn } from '../api.js';
import { moscowDay } from '../dates.js';
import { orderCardHtml } from './order-card.js';

const ACTIVE_STATUSES = ['new', 'confirmed', 'assembling', 'delivering'];
const FILTER_LABELS = { active: 'В работе', new: 'Новые', today: 'Сегодня', tomorrow: 'Завтра', all: 'Все' };
const MIN_PHONE_DIGITS = 3;

export const orderState = {
  orders: [],
  statuses: {}, // статус → название с эмодзи (с сервера)
  filter: 'active',
  query: '',
  openMenuOrderId: null, // у какого заказа открыто меню «⋯»
};

// «В работе» — без неоплаченных: они появятся там после оплаты
const isActive = (order) => ACTIVE_STATUSES.includes(order.status) && order.payment_status !== 'pending';
const isDeliveredOn = (order, isoDate) => order.delivery_date === isoDate && order.status !== 'cancelled';
const FILTERS = {
  active: isActive,
  new: (order) => order.status === 'new',
  today: (order) => isDeliveredOn(order, moscowDay(0)),
  tomorrow: (order) => isDeliveredOn(order, moscowDay(1)),
  all: () => true,
};

const normalizeText = (text) => text.toLowerCase().replace(/ё/g, 'е');

// Поиск по номеру, имени, @username, адресу, получателю и телефону (от трёх цифр)
function matchesQuery(order) {
  const query = normalizeText(orderState.query);
  const digits = orderState.query.replace(/\D/g, '');
  if (!query) return true;
  const searchableText = normalizeText(`${order.id} ${order.customer_name} ${order.username || ''} ${order.address} ${order.recipient || ''}`);
  return searchableText.includes(query) || (digits.length >= MIN_PHONE_DIGITS && order.phone.replace(/\D/g, '').includes(digits)) || String(order.id) === digits;
}

function renderFilters() {
  getElement('orderFilters').innerHTML = Object.entries(FILTER_LABELS).map(([filter, label]) => {
    const count = filter === 'all' ? 0 : orderState.orders.filter(FILTERS[filter]).length; // у «Все» счётчика нет
    return `<button class="f ${filter === orderState.filter ? 'active' : ''}" data-action="filter-orders" data-filter="${filter}">${label}${count ? `<span class="fn">${count}</span>` : ''}</button>`;
  }).join('');
}

export function renderOrders() {
  renderFilters();
  let visibleOrders = orderState.orders.filter((order) => FILTERS[orderState.filter](order) && matchesQuery(order));
  // Для «сегодня/завтра» удобнее порядок по времени доставки — как маршрут курьера
  if (orderState.filter === 'today' || orderState.filter === 'tomorrow') {
    visibleOrders = [...visibleOrders].sort((first, second) => first.delivery_time.localeCompare(second.delivery_time));
  }
  const ordersBox = getElement('orders');
  ordersBox.innerHTML = visibleOrders.length
    ? visibleOrders.map((order) => orderCardHtml(order, orderState.statuses, orderState.openMenuOrderId === order.id)).join('')
    : '<div class="empty">Здесь пока пусто 🌿</div>';
  loadTelegramPhotosIn(ordersBox);
}

const countNewOrders = () => orderState.orders.filter((order) => order.status === 'new').length;

export async function loadOrders() {
  try {
    const previousNewCount = countNewOrders();
    ({ orders: orderState.orders, statuses: orderState.statuses } = await callAdminApi('/orders'));
    renderOrders();
    const newCount = countNewOrders();
    getElement('newCount').hidden = !newCount;
    getElement('newCount').textContent = newCount;
    if (previousNewCount && newCount > previousNewCount) vibrateNotification('warning'); // пришёл новый заказ
  } catch (error) {
    if (getElement('orders')) getElement('orders').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

/** Заказ изменился на сервере — заменяем его в списке и закрываем меню «⋯» */
export function replaceOrder(updatedOrder) {
  orderState.orders = orderState.orders.map((order) => (order.id === updatedOrder.id ? updatedOrder : order));
  orderState.openMenuOrderId = null;
}

export function listenToOrderSearch() {
  getElement('orderSearch').addEventListener('input', (event) => {
    orderState.query = event.target.value.trim();
    if (orderState.query) orderState.filter = 'all';
    renderOrders();
  });
}

export const orderListActions = {
  'filter-orders': (element) => {
    orderState.filter = element.dataset.filter;
    renderOrders();
  },
  'toggle-order-menu': (element) => {
    const orderId = Number(element.dataset.orderId);
    orderState.openMenuOrderId = orderState.openMenuOrderId === orderId ? null : orderId;
    renderOrders();
  },
};
