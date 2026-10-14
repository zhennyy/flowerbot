// Карточка заказа в админке: когда везти, состав, сумма и оплата, покупатель, фото букета, главная кнопка и меню «⋯».
import { escapeHtml } from '../../shared/dom.js';
import { formatRubles, formatKilometers } from '../../shared/format.js';
import { niceDay, niceTime } from '../dates.js';

// Следующий шаг заказа — одна главная кнопка вместо шести
const NEXT_STEP = {
  new: ['confirmed', 'Подтвердить'],
  confirmed: ['assembling', 'Начать сборку'],
  assembling: ['delivering', 'В доставку'],
  delivering: ['done', 'Доставлен'],
};
const STATUS_CLASSES = { new: 's-new', confirmed: 's-conf', assembling: 's-asm', delivering: 's-dlv', done: 's-done', cancelled: 's-cnl' };
const PHOTO_STATUS_LABELS = {
  pending: '⏳ Ждём ответа покупателя', approved: '👍 Покупатель одобрил', changes: '✏️ Просят изменить', auto: '⏰ Не ответил — одобрено автоматически',
};
// Фото на согласование можно отправить, пока букет подтверждён или собирается
const PHOTO_STATUSES = ['confirmed', 'assembling'];

/** Название статуса без эмодзи: «✅ Подтверждён» → «Подтверждён» */
export const statusName = (statuses, status) => (statuses[status] || '').replace(/^\S+\s/, '');

// Главная кнопка. На этапе сборки фото — по желанию (кнопка 📸 рядом), главная кнопка сразу ведёт дальше;
// только если покупатель попросил изменить — сначала новое фото
function primaryButtonHtml(order) {
  const nextStep = NEXT_STEP[order.status];
  if (order.payment_status === 'pending') return '<span class="done-note">⏳ Ждём оплату — заказ появится «В работе» после оплаты</span>';
  if (!nextStep) return `<span class="done-note">${order.status === 'done' ? 'Заказ выполнен' : 'Заказ отменён'}</span>`;
  if (order.status === 'assembling') {
    if (order.photo_status === 'changes') return `<button class="primary" data-action="pick-bouquet-photo" data-order-id="${order.id}">📸 Новое фото</button>`;
    if (order.photo_status === 'pending') return `<button class="primary wait" data-action="deliver-without-approval" data-order-id="${order.id}">⏳ Ждём ответа</button>`;
  }
  return `<button class="primary" data-action="set-order-status" data-order-id="${order.id}" data-status="${nextStep[0]}">${nextStep[1]}</button>`;
}

function deliveryHtml(order) {
  if (order.delivery_fee == null) return '<span class="warn">доставку уточнить</span>';
  return `доставка ${order.delivery_fee ? formatRubles(order.delivery_fee) : 'бесплатно'}${order.delivery_km != null ? ` · ${formatKilometers(order.delivery_km)} км` : ''}`;
}

function paymentHtml(order) {
  if (order.payment_status === 'paid') return '<span class="paid">💳 оплачен</span>';
  if (order.payment_status === 'pending') return '<span class="unpaid">ждёт оплаты</span>';
  return '';
}

// Получатель, открытка, комментарий, отзыв — только то, что есть
const extrasHtml = (order) => [
  order.recipient && `<div class="ln"><span class="ic">🎁</span>${escapeHtml(order.recipient)}</div>`,
  order.card_text && `<div class="ln"><span class="ic">💌</span><i>«${escapeHtml(order.card_text)}»</i></div>`,
  order.comment && `<div class="ln"><span class="ic">💬</span>${escapeHtml(order.comment)}</div>`,
  order.rating && `<div class="ln"><span class="ic">⭐</span>${order.rating}/5${order.review_text ? ` — ${escapeHtml(order.review_text)}` : ''}</div>`,
].filter(Boolean).join('');

const bouquetPhotoHtml = (order) => (order.bouquet_photo ? `<div class="bphoto"><img data-photo="${escapeHtml(order.bouquet_photo)}" alt="Фото букета">
        <span class="ps ps-${order.photo_status}">${PHOTO_STATUS_LABELS[order.photo_status] || ''}</span></div>` : '');

// Меню «⋯»: новое фото, любой другой статус, отмена
function moreMenuHtml(order, statuses) {
  const otherStatuses = Object.keys(statuses).filter((status) => status !== order.status && status !== 'cancelled');
  return `<div class="more-st">
        ${!PHOTO_STATUSES.includes(order.status) && order.bouquet_photo ? `<button data-action="pick-bouquet-photo" data-order-id="${order.id}">📸 Новое фото</button>` : ''}
        ${otherStatuses.map((status) => `<button data-action="set-order-status" data-order-id="${order.id}" data-status="${status}">${escapeHtml(statusName(statuses, status))}</button>`).join('')}
        ${order.status !== 'cancelled' ? `<button class="danger" data-action="cancel-order" data-order-id="${order.id}">Отменить заказ</button>` : ''}
      </div>`;
}

export function orderCardHtml(order, statuses, isMenuOpen) {
  const canSendPhoto = PHOTO_STATUSES.includes(order.status) && order.photo_status !== 'changes';
  return `
    <article class="ord ${STATUS_CLASSES[order.status]}">
      <div class="oh">
        <div><div class="when">${niceDay(order.delivery_date)}, ${niceTime(order.delivery_time)}</div><div class="oid">Заказ №${order.id}</div></div>
        <span class="pill">${escapeHtml(statusName(statuses, order.status))}</span>
      </div>
      <ul class="oitems">${order.items.map((item) => `<li><span>${escapeHtml(item.name)}</span><span class="q">× ${item.qty}${item.unit ? ' шт' : ''}</span></li>`).join('')}</ul>
      <div class="ototal"><b>${formatRubles(order.total)}</b>${paymentHtml(order)}<span>${deliveryHtml(order)}</span></div>
      <div class="oinfo">
        <div class="ln"><span class="ic">👤</span>${escapeHtml(order.customer_name)}${order.username ? ` <span class="mut">@${escapeHtml(order.username)}</span>` : ''}</div>
        <div class="ln"><span class="ic">📍</span>${escapeHtml(order.address)}</div>
        ${extrasHtml(order)}
      </div>
      ${bouquetPhotoHtml(order)}
      <div class="oact">
        ${primaryButtonHtml(order)}
        <a class="iconbtn" href="tel:${escapeHtml(order.phone.replace(/[^\d+]/g, ''))}" aria-label="Позвонить">📞</a>
        <button class="iconbtn" data-action="chat-about-order" data-order-id="${order.id}" aria-label="Написать">💬</button>
        ${canSendPhoto ? `<button class="iconbtn" data-action="pick-bouquet-photo" data-order-id="${order.id}" aria-label="Фото на согласование" title="Фото на согласование">📸</button>` : ''}
        <button class="iconbtn" data-action="toggle-order-menu" data-order-id="${order.id}" aria-label="Ещё">⋯</button>
      </div>
      ${isMenuOpen ? moreMenuHtml(order, statuses) : ''}
    </article>`;
}
