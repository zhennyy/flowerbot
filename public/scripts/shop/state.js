// Общее состояние витрины: каталог, корзина, поиск, открытый экран и шторка товара.
// Один изменяемый объект: модули читают и меняют его поля, а после изменений сами вызывают нужную перерисовку.

export const ALL_CATEGORIES = 'Все';

export const state = {
  products: [], // товары с сервера (вместе с допами: ваза, шары…)
  categories: [], // категории витрины по порядку
  activeCategory: ALL_CATEGORIES,
  searchQuery: '',
  cart: {}, // ключ строки корзины ("12" или "12|M" — букет 12 размера M) → количество

  currentPage: null, // открытый экран поверх каталога: cartPage | checkoutPage | ordersPage | donePage, null — каталог
  stemQuantity: 0, // количество в шторке поштучного цветка
  selectedSize: null, // размер в шторке букета S / M / L
  myOrders: [], // «Мои заказы»
};
