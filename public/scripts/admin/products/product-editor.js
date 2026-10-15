// Редактор букета (шторка снизу): поля, фото (загрузка с телефона или ссылка), размеры, поштучная продажа, удаление.
import { getElement, escapeHtml } from '../../shared/dom.js';
import { vibrateNotification, askConfirmation } from '../../shared/telegram.js';
import { callAdminApi } from '../api.js';
import { readImageFile, resizeToJpeg } from '../photo-files.js';
import { loadProducts, findAdminProduct } from './product-list.js';
import { sizeState, renderSizeRows, suggestSizesFromPrice } from './size-rows.js';

const DEFAULT_BACKGROUND = '#f6e3ea';
const EMPTY_PRODUCT = {
  name: '',
  description: '',
  price: '',
  category: '',
  photo_url: '',
  badge: '',
  bg: DEFAULT_BACKGROUND,
  in_stock: 1,
  unit: null,
  min_qty: 1,
  stock: null,
  addon: 0,
  emoji: '',
  sizes: null,
};
// Фото по ссылке: внешние https://, загруженные (/uploads/) и из папки проекта (/photos/) — как разрешает сервер
const PHOTO_URL_PATTERN = /^(https:\/\/|\/uploads\/|\/photos\/)/;
const PHOTO_SIDE = 1400;
const THUMBNAIL_SIDE = 600;

let editingProduct = null; // null — новый букет
const field = (id) => getElement(id);

function fillForm(product) {
  field('p_name').value = product.name;
  field('p_desc').value = product.description;
  field('p_price').value = product.price;
  field('p_cat').value = product.category;
  field('p_photo').value = product.photo_url || '';
  field('p_badge').value = product.badge || '';
  field('p_bg').value = product.bg || DEFAULT_BACKGROUND;
  field('p_stock').checked = Boolean(product.in_stock);
  field('p_unit').checked = Boolean(product.unit);
  field('p_min').value = product.min_qty || 1;
  field('minBox').hidden = !product.unit;
  field('p_qty').value = product.stock ?? '';
  field('p_emoji').value = product.emoji || '';
  field('p_addon').checked = Boolean(product.addon);
  sizeState.sizes = product.sizes ? product.sizes.map((size) => ({ ...size })) : [];
  field('p_sizes_on').checked = sizeState.sizes.length > 0;
  field('sizesBox').hidden = !sizeState.sizes.length;
  field('p_price').disabled = sizeState.sizes.length > 0; // цена букета с размерами — самая маленькая из размеров
  renderSizeRows();
}

/** productId = null — новый букет */
export function openProductEditor(productId) {
  editingProduct = productId ? findAdminProduct(productId) : null;
  field('pTitle').textContent = editingProduct ? 'Изменить букет' : 'Новый букет';
  fillForm(editingProduct || EMPTY_PRODUCT);
  field('pDelete').hidden = !editingProduct;
  field('pError').textContent = '';
  showPhotoPreview();
  field('sheetWrap').classList.add('open');
}

const closeEditor = () => field('sheetWrap').classList.remove('open');

/** Превью: фото по ссылке или эмодзи на цвете фона */
function showPhotoPreview() {
  const photoUrl = field('p_photo').value.trim();
  const preview = field('p_preview');
  preview.style.background = field('p_bg').value;
  if (!PHOTO_URL_PATTERN.test(photoUrl)) {
    preview.innerHTML = escapeHtml(field('p_emoji').value || '💐');
    return;
  }
  preview.innerHTML = `<img src="${escapeHtml(photoUrl)}" alt="">`;
  preview.querySelector('img').addEventListener('error', (event) => event.target.replaceWith('⚠️ фото не открывается'));
}

// Загрузка фото с телефона: на сервер — большое фото и миниатюра
async function uploadPhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  field('p_preview').innerHTML = '⏳';
  field('pError').textContent = '';
  try {
    const image = await readImageFile(file);
    const uploaded = await callAdminApi('/upload', {
      method: 'POST',
      body: { full: resizeToJpeg(image, PHOTO_SIDE, 0.85), thumb: resizeToJpeg(image, THUMBNAIL_SIDE, 0.8) },
    });
    field('p_photo').value = uploaded.url;
    showPhotoPreview();
    vibrateNotification('success');
  } catch (error) {
    field('pError').textContent = error.message || 'Не получилось загрузить фото';
    showPhotoPreview();
  }
  event.target.value = '';
}

function readForm() {
  const hasSizes = field('p_sizes_on').checked;
  return {
    name: field('p_name').value,
    description: field('p_desc').value,
    price: field('p_price').value,
    category: field('p_cat').value,
    photo_url: field('p_photo').value,
    badge: field('p_badge').value,
    bg: field('p_bg').value,
    in_stock: field('p_stock').checked,
    unit: field('p_unit').checked,
    min_qty: field('p_min').value,
    stock: field('p_qty').value,
    emoji: field('p_emoji').value,
    addon: field('p_addon').checked,
    sizes: hasSizes ? sizeState.sizes : [],
    ...(hasSizes && sizeState.sizes.length
      ? { price: Math.min(...sizeState.sizes.map((size) => size.price || Infinity)) }
      : {}),
  };
}

async function saveProduct(event) {
  event.preventDefault();
  field('pError').textContent = '';
  try {
    if (editingProduct) await callAdminApi(`/products/${editingProduct.id}`, { method: 'PUT', body: readForm() });
    else await callAdminApi('/products', { method: 'POST', body: readForm() });
    vibrateNotification('success');
    closeEditor();
    loadProducts();
  } catch (error) {
    field('pError').textContent = error.message;
  }
}

function deleteProduct() {
  const question = `Удалить «${editingProduct.name}» навсегда? Если букет временно закончился, лучше просто скрыть его 👁`;
  askConfirmation(question, async (confirmed) => {
    if (!confirmed) return;
    try {
      await callAdminApi(`/products/${editingProduct.id}`, { method: 'DELETE' });
      closeEditor();
      loadProducts();
    } catch (error) {
      field('pError').textContent = error.message;
    }
  });
}

export function listenToEditorInputs() {
  field('pForm').addEventListener('submit', saveProduct);
  field('p_file').addEventListener('change', uploadPhoto);
  ['p_photo', 'p_bg', 'p_emoji'].forEach((id) => field(id).addEventListener('input', showPhotoPreview));
  field('p_unit').addEventListener('change', (event) => {
    field('minBox').hidden = !event.target.checked;
  });
  field('p_sizes_on').addEventListener('change', (event) => {
    const hasSizes = event.target.checked;
    field('sizesBox').hidden = !hasSizes;
    field('p_price').disabled = hasSizes;
    if (hasSizes && !sizeState.sizes.length) suggestSizesFromPrice(Number(field('p_price').value) || 0);
    renderSizeRows();
  });
}

export const productEditorActions = {
  'new-product': () => openProductEditor(null),
  'edit-product': (element) => openProductEditor(Number(element.dataset.productId)),
  'close-editor': () => closeEditor(),
  'remove-product-photo': () => {
    field('p_photo').value = '';
    showPhotoPreview();
  },
  'delete-product': () => deleteProduct(),
};
