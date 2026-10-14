// «Мои заказы»: карточки заказов с этапами, «Оплатить» у неоплаченных, «Повторить», значок активных заказов в шапке.
import { state } from '../state.js';
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles } from '../../shared/format.js';
import { telegramInitData, openExternalLink } from '../../shared/telegram.js';
import { requestShopApi } from '../api.js';

const STEP_NAMES = ['Принят', 'Подтверждён', 'Сборка', 'В пути', 'Доставлен'];
const STEP_STATUSES = ['new', 'confirmed', 'assembling', 'delivering', 'done'];
const ACTIVE_STATUSES = ['new', 'confirmed', 'assembling', 'delivering'];

const messageHtml = (text) => `<div class="cart-empty">${text}</div>`;
const EMPTY_ORDERS_HTML = `<div class="cart-empty"><div class="cart-empty-icon">📦</div>Заказов пока нет<br>Самое время выбрать букет 🌷
      <br><button class="big" data-action="go-to-page">Перейти в каталог</button></div>`;

/** render — сразу показать список (экран открыт); без него — только обновить значок в шапке */
export async function loadMyOrders(render) {
  if (!telegramInitData()) {
    if (render) getElement('myOrders').innerHTML = messageHtml('Откройте магазин через Telegram-бота');
    return;
  }
  try {
    const response = await requestShopApi('/my-orders', { signed: true });
    state.myOrders = await response.json();
  } catch {
    if (render) getElement('myOrders').innerHTML = messageHtml('Не удалось загрузить заказы 😔');
    return;
  }
  // Значок: сколько заказов сейчас в работе
  const activeCount = state.myOrders.filter((order) => ACTIVE_STATUSES.includes(order.status) && order.payment_status !== 'canceled').length;
  getElement('obadge').hidden = !activeCount;
  getElement('obadge').textContent = activeCount;
  if (render) renderMyOrders();
}

function orderNote(order, isUnpaid) {
  if (isUnpaid) return '💳 Осталось оплатить — после оплаты флорист возьмётся за букет';
  if (order.photo_status === 'pending') return '📸 Флорист прислал фото букета — ответьте в чате с ботом';
  if (order.status === 'delivering') return '🚚 Курьер уже в пути, держите телефон рядом';
  return '';
}

// Полоска из пяти этапов: от «Принят» до «Доставлен»
function progressHtml(order, isUnpaid) {
  if (order.status === 'cancelled') return '';
  const currentStep = STEP_STATUSES.indexOf(order.status);
  return `<div class="mo-track">${STEP_NAMES.map((stepName, stepIndex) => `<span class="${stepIndex <= currentStep && !isUnpaid ? 'on' : ''}"></span>`).join('')}</div>
        <div class="mo-steps"><span>${STEP_NAMES[0]}</span><span>${STEP_NAMES[4]}</span></div>`;
}

function orderCardHtml(order) {
  const isUnpaid = order.payment_status === 'pending';
  const statusLabel = isUnpaid ? 'Ждёт оплаты' : order.status_label;
  const note = orderNote(order, isUnpaid);
  return `<article class="myord st-${order.status}">
      <div class="mo-head"><div><b>Заказ №${order.id}</b><div class="mo-when">${escapeHtml(order.when)} · ${escapeHtml(order.address)}</div></div>
        <span class="mo-pill">${escapeHtml(statusLabel)}</span></div>
      ${progressHtml(order, isUnpaid)}
      <ul class="mo-items">${order.items.map((item) => `<li><span>${escapeHtml(item.name)}</span><span>× ${item.qty}${item.unit ? ' шт' : ''}</span></li>`).join('')}</ul>
      <div class="mo-total"><span>Итого</span><span>${formatRubles(order.total)} ${order.delivery_fee ? '<small>с доставкой</small>' : ''}</span></div>
      ${order.card_text ? `<div class="mo-when mo-card">💌 «${escapeHtml(order.card_text)}»</div>` : ''}
      ${note ? `<div class="mo-note">${note}</div>` : ''}
      <div class="mo-act">
        ${isUnpaid && order.pay_url ? `<button class="pay" data-action="pay-order" data-url="${escapeHtml(order.pay_url)}">💳 Оплатить</button>` : ''}
        <button data-action="repeat-order" data-order-id="${order.id}">🔁 Повторить</button>
      </div>
    </article>`;
}

function renderMyOrders() {
  getElement('myOrders').innerHTML = state.myOrders.length ? state.myOrders.map(orderCardHtml).join('') : EMPTY_ORDERS_HTML;
}

export const myOrdersActions = {
  'pay-order': (element) => openExternalLink(element.dataset.url),
};
