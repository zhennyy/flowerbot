// Каталог: категории с числом найденного, подсказка поиска, сетка карточек с кнопками «+» / −N+.
import { state, ALL_CATEGORIES } from '../state.js';
import { getElement, escapeHtml } from '../../shared/dom.js';
import { vibrateSelection } from '../../shared/telegram.js';
import { matchesSearch, highlightMatches } from './search.js';
import {
  showcaseProducts,
  isSoldByStem,
  hasSizes,
  productPhotoHtml,
  priceLabel,
  lowStockBadge,
} from './product-helpers.js';
import { quantityInCart } from '../cart/cart-model.js';

export const LOADING_GRID_HTML = '<div class="empty">Собираем букеты… 🌸</div>';
export const LOAD_ERROR_GRID_HTML = '<div class="empty">Не удалось загрузить каталог 😔<br>Попробуйте обновить</div>';

export function renderChips() {
  const found = showcaseProducts().filter(matchesSearch);
  const countIn = (category) =>
    category === ALL_CATEGORIES ? found.length : found.filter((product) => product.category === category).length;
  getElement('chips').innerHTML = [ALL_CATEGORIES, ...state.categories]
    .map((category) => {
      const count = countIn(category);
      return `<button class="chip ${category === state.activeCategory ? 'active' : ''} ${state.searchQuery && !count ? 'zero' : ''}" data-action="select-category" data-category="${escapeHtml(category)}">${escapeHtml(category)}${state.searchQuery ? `<span class="n">${count}</span>` : ''}</button>`;
    })
    .join('');
  // Подсказка: сколько нашлось и в каких категориях
  if (!state.searchQuery) {
    getElement('hint').innerHTML = '';
    return;
  }
  const categoriesWithResults = state.categories.filter((category) => countIn(category));
  getElement('hint').innerHTML = found.length
    ? `Нашлось <b>${found.length}</b> — в категориях: ${categoriesWithResults.map(escapeHtml).join(', ')}`
    : '';
}

/** −N+ для строки корзины и допов; клик между кнопками не открывает карточку товара */
export const quantityStepperHtml = (
  key,
  quantity,
  extraClass = '',
) => `<div class="qty${extraClass}" data-action="ignore-click">
      <button data-action="change-quantity" data-key="${key}" data-delta="-1">−</button>${quantity}<button data-action="change-quantity" data-key="${key}" data-delta="1">+</button></div>`;

// Кнопки на карточке каталога: поштучные и букеты с размерами открывают выбор в шторке, остальные — сразу в корзину
function cardControlsHtml(product) {
  const quantity = quantityInCart(product.id);
  if (isSoldByStem(product) || hasSizes(product)) {
    return quantity
      ? `<button class="pill" data-action="open-product" data-product-id="${product.id}">${quantity}${isSoldByStem(product) ? ' шт' : ''} ✎</button>`
      : `<button class="add" data-action="open-product" data-product-id="${product.id}" aria-label="Выбрать">+</button>`;
  }
  return quantity
    ? quantityStepperHtml(product.id, quantity)
    : `<button class="add" data-action="change-quantity" data-key="${product.id}" data-delta="1" aria-label="В корзину">+</button>`;
}

export function renderGrid() {
  const visibleProducts = showcaseProducts().filter(
    (product) =>
      (state.activeCategory === ALL_CATEGORIES || product.category === state.activeCategory) && matchesSearch(product),
  );
  getElement('grid').innerHTML = visibleProducts.length
    ? visibleProducts
        .map(
          (product) => `
    <article class="card" data-action="open-product" data-product-id="${product.id}">
      <div class="pic" style="background:${escapeHtml(product.bg)}">${productPhotoHtml(product)}${product.badge ? `<span class="badge">${escapeHtml(product.badge)}</span>` : ''}${lowStockBadge(product)}</div>
      <div class="info">
        <div class="name">${highlightMatches(product.name)}</div>
        <div class="desc">${highlightMatches(product.description)}</div>
        <div class="row"><span class="price">${priceLabel(product)}</span>${cardControlsHtml(product)}</div>
      </div>
    </article>`,
        )
        .join('')
    : '<div class="empty">Ничего не нашлось 🌿<br>Попробуйте «розы», «коробка» или «тюльпаны»<br><button data-action="clear-search">Показать все букеты</button></div>';
}

function selectCategory(category) {
  state.activeCategory = category;
  vibrateSelection();
  renderChips();
  renderGrid();
}

function clearSearch() {
  const searchInput = getElement('q');
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input'));
  searchInput.focus();
}

export function listenToSearchInput() {
  getElement('q').addEventListener('input', (event) => {
    state.searchQuery = event.target.value.trim();
    getElement('searchBox').classList.toggle('has-text', Boolean(state.searchQuery));
    // Если в выбранной категории ничего нет, а в других есть — показываем «Все»
    const categoryHasResults = showcaseProducts().some(
      (product) => product.category === state.activeCategory && matchesSearch(product),
    );
    if (state.searchQuery && state.activeCategory !== ALL_CATEGORIES && !categoryHasResults)
      state.activeCategory = ALL_CATEGORIES;
    renderChips();
    renderGrid();
  });
}

export const catalogActions = {
  'select-category': (element) => selectCategory(element.dataset.category),
  'clear-search': () => clearSearch(),
  'ignore-click': () => {},
};
