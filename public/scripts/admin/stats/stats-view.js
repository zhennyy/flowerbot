// Вкладка «Статистика»: период 7/30/90 дней, показатели, столбики выручки по дням с подсказкой и топ товаров.
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles, pluralize, formatDate } from '../../shared/format.js';
import { callAdminApi } from '../api.js';
import { renderRevenueSplit, renderStatusSplit, renderQuality } from './stats-blocks.js';

const PERIODS = [7, 30, 90];
let periodDays = 30;

export async function loadStats() {
  getElement('period').innerHTML = PERIODS.map((days) => `<button class="f ${days === periodDays ? 'active' : ''}" data-action="select-stats-period" data-days="${days}">${days} дней</button>`).join('');
  try {
    renderStats(await callAdminApi(`/stats?days=${periodDays}`));
  } catch (error) {
    if (getElement('kpis')) getElement('kpis').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderKpis(stats) {
  getElement('kpis').innerHTML = [
    ['Выручка', formatRubles(stats.revenue), `товары ${formatRubles(stats.goods)}`],
    ['Заказов', stats.orders, stats.cancelled ? `ещё ${stats.cancelled} отменено` : 'без отмен 🎉'],
    ['Средний чек', formatRubles(stats.avg), ''],
    ['Покупателей', stats.customers, stats.repeat ? `${stats.repeat} ${pluralize(stats.repeat, ['вернулся', 'вернулись', 'вернулись'])} снова` : ''],
  ].map(([label, value, note]) => `<div class="kpi"><div class="l">${label}</div><div class="v">${value}</div><div class="s">${note}</div></div>`).join('');
}

// Столбики выручки по дням (один цвет — одна величина); нажатие или наведение показывает день
function renderRevenueChart(stats) {
  const chart = getElement('chart');
  const maxRevenue = Math.max(...stats.byDay.map((day) => day.revenue), 1);
  chart.setAttribute('aria-label', `Выручка по дням за ${stats.days} дней, максимум ${formatRubles(maxRevenue)}`);
  chart.innerHTML = `<div class="ymax">${formatRubles(maxRevenue)}</div>` + stats.byDay.map((day, dayIndex) => `<div class="bar ${day.revenue ? '' : 'zero'}" data-day-index="${dayIndex}" title="${formatDate(day.date)}: ${formatRubles(day.revenue)}">
       <span style="height:${Math.max(day.revenue ? 2 : 0, day.revenue / maxRevenue * 100)}%"></span></div>`).join('');
  const axisDates = [stats.byDay[0].date, stats.byDay[Math.floor(stats.byDay.length / 2)].date, stats.byDay.at(-1).date];
  getElement('axis').innerHTML = axisDates.map((date) => `<span>${formatDate(date).slice(0, 5)}</span>`).join('');
  const bars = chart.querySelectorAll('.bar');
  bars.forEach((bar) => {
    const showDay = () => {
      const day = stats.byDay[bar.dataset.dayIndex];
      bars.forEach((otherBar) => otherBar.classList.toggle('sel', otherBar === bar));
      getElement('tip').innerHTML = `<b>${formatDate(day.date)}</b> · ${formatRubles(day.revenue)} · ${day.orders} ${pluralize(day.orders, ['заказ', 'заказа', 'заказов'])}`;
    };
    bar.addEventListener('click', showDay);
    bar.addEventListener('mouseenter', showDay);
  });
}

function renderTopProducts(stats) {
  const topRevenue = Math.max(...stats.top.map((product) => product.revenue), 1);
  getElement('top').innerHTML = stats.top.length ? stats.top.map((product, position) => `
    <div class="toprow"><div class="t"><span>${position + 1}. ${escapeHtml(product.name)} <span class="toprow-qty">× ${product.qty}${product.unit ? ' шт' : ''}</span></span><span>${formatRubles(product.revenue)}</span></div>
    <div class="track"><div class="fill" style="width:${product.revenue / topRevenue * 100}%"></div></div></div>`).join('')
    : '<div class="empty">Пока нет продаж за этот период</div>';
}

function renderStats(stats) {
  renderKpis(stats);
  renderRevenueChart(stats);
  renderTopProducts(stats);
  renderRevenueSplit(stats);
  renderStatusSplit(stats);
  renderQuality(stats);
}

export const statsActions = {
  'select-stats-period': (element) => {
    periodDays = Number(element.dataset.days);
    loadStats();
  },
};
