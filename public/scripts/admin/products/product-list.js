// Вкладка «Букеты»: список с миниатюрой, ценой, остатком; 👁 — показать/скрыть в витрине; резервная копия базы.
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles } from '../../shared/format.js';
import { showAlert } from '../../shared/telegram.js';
import { callAdminApi } from '../api.js';

const LOW_STOCK_STEMS = 20;
const LOW_STOCK_BOUQUETS = 2;

export const productState = { products: [] };

export const findAdminProduct = (productId) => productState.products.find((product) => product.id === productId);

export async function loadProducts() {
  try {
    productState.products = await callAdminApi('/products');
    renderProducts();
  } catch (error) {
    if (getElement('products'))
      getElement('products').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

// «Букеты · S/M/L от 2 490 ₽ · Хит · скрыт»
function productSummary(product) {
  const kind = product.addon ? '🎁 доп · ' : escapeHtml(product.category) + ' · ';
  const sizes = product.sizes ? product.sizes.map((size) => escapeHtml(size.name)).join('/') + ' от ' : '';
  return `${kind}${sizes}${formatRubles(product.price)}${product.unit ? '/шт' : ''}${product.badge ? ' · ' + escapeHtml(product.badge) : ''}${product.in_stock ? '' : ' · скрыт'}`;
}

function stockHtml(product) {
  if (product.stock == null) return '';
  const isLow = product.stock <= (product.unit ? LOW_STOCK_STEMS : LOW_STOCK_BOUQUETS);
  return `<div class="sub" style="color:${isLow ? 'var(--danger)' : 'var(--muted)'}">📦 остаток: ${product.stock} шт</div>`;
}

export function renderProducts() {
  // подсказки категорий в редакторе
  getElement('catList').innerHTML = [...new Set(productState.products.map((product) => product.category))]
    .map((category) => `<option value="${escapeHtml(category)}">`)
    .join('');
  getElement('products').innerHTML =
    productState.products
      .map(
        (product) => `
    <div class="card prod ${product.in_stock ? '' : 'off'}">
      <div class="thumb" style="background:${escapeHtml(product.bg)}">${product.photo_url ? `<img src="${escapeHtml(product.photo_url)}" alt="">` : escapeHtml(product.emoji || '💐')}</div>
      <div class="mid"><div class="name">${escapeHtml(product.name)}</div>
        <div class="sub">${productSummary(product)}</div>
        ${stockHtml(product)}</div>
      <button class="icon" data-action="toggle-product-visibility" data-product-id="${product.id}" title="Показать/скрыть">${product.in_stock ? '👁' : '🚫'}</button>
      <button class="icon" data-action="edit-product" data-product-id="${product.id}" title="Изменить">✏️</button>
    </div>`,
      )
      .join('') || '<div class="empty">Букетов пока нет</div>';
}

async function toggleProductVisibility(productId) {
  const product = findAdminProduct(productId);
  try {
    await callAdminApi(`/products/${productId}`, { method: 'PUT', body: { ...product, in_stock: !product.in_stock } });
    loadProducts();
  } catch (error) {
    showAlert(error.message);
  }
}

// Резервная копия: бот пришлёт архив с базой в чат
async function makeBackup() {
  try {
    await callAdminApi('/backup', { method: 'POST', body: {} });
    showAlert('Готово — архив с резервной копией в чате с ботом 📦', 'Готово');
  } catch (error) {
    showAlert(error.message);
  }
}

export const productListActions = {
  'toggle-product-visibility': (element) => toggleProductVisibility(Number(element.dataset.productId)),
  'make-backup': () => makeBackup(),
};
