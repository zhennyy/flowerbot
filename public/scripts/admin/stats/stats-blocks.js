// Блоки статистики: из чего выручка (товары/доставка), заказы по статусам, отзывы и открытки.
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles, pluralize } from '../../shared/format.js';

const DELIVERY_COLOR = '#8fa8d8';
// Та же цветовая схема, что и у карточек заказов
const STATUS_COLORS = { new: '#d9668b', confirmed: '#5b8def', assembling: '#a173d6', delivering: '#e0a030', done: '#4caf7d', cancelled: '#8a7d83' };
const NO_SALES_HTML = '<div class="empty">Пока нет продаж за этот период</div>';

const percentOf = (part, total) => (total ? Math.round(part / total * 100) : 0);

// Одна полоса «товары / доставка» + подписи с процентами
export function renderRevenueSplit(stats) {
  const parts = [['Товары', stats.goods, 'var(--accent)'], ['Доставка', stats.delivery, DELIVERY_COLOR]];
  getElement('split').innerHTML = stats.revenue ? `
    <div class="stack" role="img" aria-label="Товары ${percentOf(stats.goods, stats.revenue)}%, доставка ${percentOf(stats.delivery, stats.revenue)}%">
      ${parts.filter(([, amount]) => amount).map(([, amount, color]) => `<span style="width:${amount / stats.revenue * 100}%;background:${color}"></span>`).join('')}</div>
    <div class="legend one">${parts.map(([label, amount, color]) => `<div class="lg"><i style="background:${color}"></i>${label}<b>${formatRubles(amount)}<small>${percentOf(amount, stats.revenue)}%</small></b></div>`).join('')}</div>`
    : NO_SALES_HTML;
}

export function renderStatusSplit(stats) {
  const total = Object.values(stats.byStatus).reduce((sum, count) => sum + count, 0);
  const presentStatuses = Object.keys(stats.statuses).filter((status) => stats.byStatus[status]);
  const label = (status) => stats.statuses[status].replace(/^\S+\s/, ''); // без эмодзи
  getElement('bystatus').innerHTML = total ? `
    <div class="stack" role="img" aria-label="${presentStatuses.map((status) => `${label(status)}: ${stats.byStatus[status]}`).join(', ')}">
      ${presentStatuses.map((status) => `<span title="${escapeHtml(label(status))}: ${stats.byStatus[status]}" style="width:${stats.byStatus[status] / total * 100}%;background:${STATUS_COLORS[status]}"></span>`).join('')}</div>
    <div class="legend">${presentStatuses.map((status) => `<div class="lg"><i style="background:${STATUS_COLORS[status]}"></i>${escapeHtml(label(status))}<b>${stats.byStatus[status]}</b></div>`).join('')}</div>`
    : '<div class="empty">Заказов нет</div>';
}

// Отзывы и открытки — отдельно от денег
export function renderQuality(stats) {
  const rating = stats.rating ? `${String(stats.rating).replace('.', ',')} <span class="mini-unit">/ 5</span>` : '—';
  const ratingNote = stats.rated ? `средняя оценка · ${stats.rated} ${pluralize(stats.rated, ['отзыв', 'отзыва', 'отзывов'])}` : 'отзывов пока нет';
  getElement('quality').innerHTML = `
    <div class="mini"><div class="v">${rating}</div>
      <div class="l">${ratingNote}</div></div>
    <div class="mini"><div class="v">${stats.cards}</div>
      <div class="l">${pluralize(stats.cards, ['заказ', 'заказа', 'заказов'])} с открыткой${stats.orders ? ` · ${percentOf(stats.cards, stats.orders)}%` : ''}</div></div>`;
}
