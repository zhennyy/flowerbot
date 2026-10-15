// Корзина на экране: плашка внизу каталога и значок в шапке, экран корзины со строками и допами «Добавить к заказу».
import { state } from '../state.js';
import { getElement, escapeHtml } from '../../shared/dom.js';
import { formatRubles, pluralize } from '../../shared/format.js';
import { isSoldByStem, productPhotoHtml } from '../catalog/product-helpers.js';
import { quantityStepperHtml } from '../catalog/catalog-view.js';
import { cartItems, cartTotal, cartBadgeCount, saveCart } from './cart-model.js';

/** Плашка «Корзина · N товаров» и значок в шапке (виден всегда, когда в корзине что-то есть) */
export function renderCartBar() {
  const count = cartItems().length;
  getElement('cartCount').textContent = `🛒 Корзина · ${count} ${pluralize(count, ['товар', 'товара', 'товаров'])}`;
  getElement('cartSum').textContent = formatRubles(cartTotal());
  getElement('cartbar').classList.toggle('show', count > 0);
  const badgeCount = cartBadgeCount();
  getElement('hbadge').hidden = !badgeCount;
  getElement('hbadge').textContent = badgeCount;
  saveCart();
}

export function renderCartPage() {
  const items = cartItems();
  const isEmpty = !items.length;
  getElement('cartEmpty').hidden = !isEmpty;
  ['cartLines', 'cartSummary', 'cartFooter'].forEach((id) => {
    getElement(id).hidden = isEmpty;
  });
  getElement('cartLines').innerHTML = items
    .map(
      (item) => `
    <div class="line">
      <div class="pic" style="background:${escapeHtml(item.bg)}">${productPhotoHtml(item)}</div>
      <div class="mid"><div class="name">${escapeHtml(item.title)}</div><div class="sub">${formatRubles(item.price)} × ${item.qty}${isSoldByStem(item) ? ' шт' : ''} = ${formatRubles(item.price * item.qty)}</div></div>
      ${quantityStepperHtml(item.key, state.cart[item.key] || 0)}
    </div>`,
    )
    .join('');
  getElement('cartTotal').textContent = formatRubles(cartTotal());
  renderAddons(isEmpty);
}

// «Добавить к заказу»: ваза, шары, шоколад…
function renderAddons(isCartEmpty) {
  const addons = state.products.filter((product) => product.addon);
  getElement('addonsBox').classList.toggle('hidden', !addons.length || isCartEmpty);
  getElement('addons').innerHTML = addons
    .map(
      (addon) => `
    <div class="addon ${state.cart[addon.id] ? 'on' : ''}">
      <div class="apic" style="background:${escapeHtml(addon.bg)}">${productPhotoHtml(addon)}</div>
      <div class="aname">${escapeHtml(addon.name)}</div>
      <div class="arow"><b>${formatRubles(addon.price)}</b>${
        state.cart[addon.id]
          ? quantityStepperHtml(addon.id, state.cart[addon.id], ' sm')
          : `<button class="add sm" data-action="change-quantity" data-key="${addon.id}" data-delta="1" aria-label="Добавить">+</button>`
      }</div>
    </div>`,
    )
    .join('');
}
