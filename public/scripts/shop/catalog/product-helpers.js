// Товар и строка корзины: поштучный ли цветок, размеры S/M/L, ограничения количества, фото.
import { state } from '../state.js';
import { escapeHtml } from '../../shared/dom.js';
import { formatRubles } from '../../shared/format.js';

export const MAX_PER_ITEM = 10; // как на сервере: больше 10 одинаковых букетов — через флориста
const MAX_STEMS = 501;
const LOW_STOCK_STEMS = 20;
const LOW_STOCK_BOUQUETS = 3;

export const findProduct = (productId) => state.products.find((product) => product.id === Number(productId));
export const isSoldByStem = (product) => product.unit === 'шт'; // продаётся поштучно?
export const hasSizes = (product) => Array.isArray(product.sizes) && product.sizes.length > 0;
export const minQuantity = (product) => (isSoldByStem(product) ? (product.min_qty || 1) : 1);
export const maxQuantity = (product) => (isSoldByStem(product) ? MAX_STEMS : MAX_PER_ITEM);
/** Допы (ваза, шары…) показываем только в корзине */
export const showcaseProducts = () => state.products.filter((product) => !product.addon);

// Ключ строки корзины: "12" или "12|M"
export const cartKey = (productId, sizeName) => (sizeName ? `${productId}|${sizeName}` : String(productId));
export function parseCartKey(key) {
  const [productId, sizeName] = String(key).split('|');
  return { productId: Number(productId), sizeName: sizeName || null };
}
/** Размер букета по названию (неизвестный — первый), у букета без размеров — null */
export const findSize = (product, sizeName) => (hasSizes(product) ? (product.sizes.find((size) => size.name === sizeName) || product.sizes[0]) : null);

// Фото: в карточке — облегчённая версия (_min), в подробностях — полная. Нет фото — эмодзи
const fullPhotoUrl = (url) => url.replace(/_min\.webp$/, '.png').replace(/_min\.jpg$/, '.jpg');
export const productPhotoHtml = (product, full) => (product.photo_url
  ? `<img src="${escapeHtml(full ? fullPhotoUrl(product.photo_url) : product.photo_url)}" alt="${escapeHtml(product.name)}" loading="lazy">`
  : escapeHtml(product.emoji || '💐'));

export const priceLabel = (product) => (hasSizes(product)
  ? `от ${formatRubles(product.price)}`
  : `${formatRubles(product.price)}${isSoldByStem(product) ? '<small> /шт</small>' : ''}`);

/** Значок «осталось N», когда товара мало */
export const lowStockBadge = (product) => (product.stock != null && product.stock <= (isSoldByStem(product) ? LOW_STOCK_STEMS : LOW_STOCK_BOUQUETS)
  ? `<span class="badge left">осталось ${product.stock}</span>` : '');
