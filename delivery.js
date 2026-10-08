// Расчёт стоимости доставки по расстоянию от магазина (пл. Восстания, Санкт-Петербург).
// Адрес → координаты через бесплатный геокодер OpenStreetMap (Nominatim), потом считаем километры.
const db = require('./db');

const SHOP = { lat: 59.9311, lon: 30.3609, name: 'пл. Восстания' };

// Тарифы по умолчанию — их можно поменять в админке (вкладка «Доставка»)
const DEFAULT_TARIFF = {
  city: [                       // Санкт-Петербург: «до N км — цена»
    { km: 3, price: 290 },
    { km: 7, price: 390 },
    { km: 12, price: 490 },
    { km: 20, price: 690 },
    { km: 999, price: 890 },    // всё, что дальше, но ещё в городе
  ],
  region: { base: 990, perKm: 40, fromKm: 20 }, // Ленобласть: 990 ₽ + 40 ₽ за каждый км дальше 20 км
  freeFrom: 0,                  // бесплатная доставка от суммы заказа (0 = выключено)
};
const getTariff = () => db.getSetting('delivery_tariff', DEFAULT_TARIFF);

// Проверяем и чистим тариф, который прислали из админки
function cleanTariff(t = {}) {
  const num = (v, min = 0) => Math.max(min, Math.round(Number(v)) || 0);
  const city = (Array.isArray(t.city) ? t.city : [])
    .map((r) => ({ km: num(r.km, 1), price: num(r.price) }))
    .filter((r) => r.km > 0)
    .sort((a, b) => a.km - b.km)
    .slice(0, 10);
  if (!city.length) throw new Error('Добавьте хотя бы одну зону по городу');
  return {
    city,
    region: { base: num(t.region?.base), perKm: num(t.region?.perKm), fromKm: num(t.region?.fromKm) },
    freeFrom: num(t.freeFrom),
  };
}

// Расстояние между двумя точками на Земле по прямой, км (формула гаверсинусов)
function distanceKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─── Геокодер ────────────────────────────────────────────
// Правила Nominatim: не чаще 1 запроса в секунду и обязательно «представиться» (User-Agent).
// Поэтому ставим запросы в очередь и запоминаем уже найденные адреса.
const cache = new Map();
let queue = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pending = 0;
function geocode(query) {
  const key = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  if (pending >= 15) return Promise.reject(new Error('Сервис адресов перегружен — попробуйте через минуту')); // очередь не растёт бесконечно
  pending++;
  const job = queue.then(async () => {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: query, format: 'jsonv2', addressdetails: '1', limit: '1', 'accept-language': 'ru', countrycodes: 'ru',
      viewbox: '27.8,61.4,35.7,58.4', bounded: '1', // только СПб и Ленобласть
    });
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FlerFlowerShopBot/1.0 (Telegram flower shop)' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error('geocoder ' + res.status);
    const [hit] = await res.json();
    const result = hit ? {
      lat: Number(hit.lat), lon: Number(hit.lon),
      state: hit.address?.state || hit.address?.city || '',
      label: hit.display_name.split(', ').slice(0, 4).join(', '),
    } : null;
    if (cache.size > 2000) cache.clear();
    cache.set(key, result);
    return result;
  });
  job.finally(() => { pending--; }).catch(() => {});
  queue = job.catch(() => {}).then(() => sleep(1100)); // пауза между запросами
  return job;
}

// ─── Главная функция: сколько стоит доставка ─────────────
// zone: 'city' (Санкт-Петербург) или 'region' (Ленинградская область) — выбирает покупатель
async function quote(address, zone, itemsTotal = 0) {
  const prefix = zone === 'region' ? 'Ленинградская область, ' : 'Санкт-Петербург, ';
  const place = await geocode(prefix + address);
  if (!place) return { ok: false, error: 'Не нашли такой адрес 🤔 Проверьте улицу и номер дома' };

  const inSpb = /Санкт-Петербург/i.test(place.state);
  const inRegion = /Ленинградская/i.test(place.state);
  if (!inSpb && !inRegion) return { ok: false, error: 'Доставляем только по Санкт-Петербургу и Ленобласти' };

  const km = Math.round(distanceKm(SHOP, place) * 10) / 10;
  const t = getTariff();
  let fee;
  if (inSpb) {
    fee = (t.city.find((r) => km <= r.km) || t.city[t.city.length - 1]).price;
  } else {
    fee = t.region.base + Math.ceil(Math.max(0, km - t.region.fromKm)) * t.region.perKm;
  }
  const free = t.freeFrom > 0 && itemsTotal >= t.freeFrom;
  return {
    ok: true,
    fee: free ? 0 : fee,
    fullFee: fee,
    free,
    freeFrom: t.freeFrom,
    km,
    zone: inSpb ? 'Санкт-Петербург' : 'Ленобласть',
    found: place.label,
  };
}

module.exports = { quote, getTariff, cleanTariff, distanceKm, SHOP, DEFAULT_TARIFF, _geocode: geocode };
