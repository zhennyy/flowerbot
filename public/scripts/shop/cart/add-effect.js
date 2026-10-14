// Эффект «в корзину»: картинка товара улетает к корзине, корзина подпрыгивает, вылетают «+1» и лепестки.
// В корзине (допы) — просто «подпрыгивает» карточка допа.
import { getElement, restartAnimation } from '../../shared/dom.js';

const PETALS = ['🌸', '🌷', '✨', '🌸', '💮', '✨'];
const FLYER_MAX_SIZE = 140;
let lastTappedElement = null;

/** Запоминаем, по чему нажали: эффект вылетает из этой карточки */
export function trackTaps() {
  document.addEventListener('pointerdown', (event) => { lastTappedElement = event.target; }, true);
}

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Вызывается до перерисовки, пока карточка ещё на месте */
export function playAddToCartEffect() {
  const sourceCard = lastTappedElement?.closest?.('.card, .addon, .sheet');
  if (!sourceCard || prefersReducedMotion()) return;
  if (getElement('cartPage').classList.contains('show')) {
    const addonCard = lastTappedElement.closest('.addon');
    if (addonCard) restartAnimation(addonCard, 'pop');
    return;
  }
  const picture = sourceCard.querySelector('.pic, .apic');
  if (!picture) return;
  flyToCart(picture);
  showPlusOne(lastTappedElement.getBoundingClientRect());
}

function flyToCart(picture) {
  const pictureBox = picture.getBoundingClientRect();
  const size = Math.min(pictureBox.width, pictureBox.height, FLYER_MAX_SIZE);
  const flyer = document.createElement('div');
  flyer.className = 'flyer';
  flyer.style.cssText = `left:${pictureBox.left + (pictureBox.width - size) / 2}px;top:${pictureBox.top + (pictureBox.height - size) / 2}px;width:${size}px;height:${size}px;background:${picture.style.background}`;
  flyer.innerHTML = picture.querySelector('img')?.outerHTML || picture.textContent.trim().slice(0, 2);
  if (!flyer.querySelector('img')) flyer.style.fontSize = size * 0.5 + 'px';
  document.body.appendChild(flyer);
  // Куда летим — в центр корзины внизу экрана
  const shiftX = innerWidth / 2 - (pictureBox.left + pictureBox.width / 2);
  const shiftY = innerHeight - 40 - (pictureBox.top + pictureBox.height / 2);
  flyer.animate([
    { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
    { transform: `translate(${shiftX * 0.45}px, ${shiftY * 0.25 - 60}px) scale(.6) rotate(-8deg)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${shiftX}px, ${shiftY}px) scale(.15) rotate(12deg)`, opacity: 0.4 },
  ], { duration: 650, easing: 'cubic-bezier(.5,0,.4,1)' }).onfinish = () => {
    flyer.remove();
    restartAnimation(getElement('cartbar'), 'bump');
    restartAnimation(getElement('hcart'), 'bump');
    burstPetals(innerWidth / 2, innerHeight - 60);
  };
}

// «+1» над кнопкой
function showPlusOne(buttonBox) {
  const plusOne = document.createElement('div');
  plusOne.className = 'plus1';
  plusOne.textContent = '+1';
  plusOne.style.cssText = `left:${buttonBox.left + buttonBox.width / 2 - 10}px;top:${buttonBox.top - 6}px`;
  document.body.appendChild(plusOne);
  plusOne.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-34px)', opacity: 0 }], { duration: 700, easing: 'ease-out' })
    .onfinish = () => plusOne.remove();
}

// Маленький «салют» из лепестков у корзины
function burstPetals(centerX, centerY) {
  PETALS.forEach((petalEmoji, petalIndex) => {
    const petal = document.createElement('div');
    petal.className = 'petal';
    petal.textContent = petalEmoji;
    petal.style.cssText = `left:${centerX}px;top:${centerY}px`;
    document.body.appendChild(petal);
    const angle = (-150 + petalIndex * 24) * Math.PI / 180;
    const distance = 50 + Math.random() * 30;
    petal.animate([
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
      { transform: `translate(${Math.cos(angle) * distance - 8}px, ${Math.sin(angle) * distance - 8}px) scale(1) rotate(${petalIndex * 40}deg)`, opacity: 0 },
    ], { duration: 650, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => petal.remove();
  });
}
