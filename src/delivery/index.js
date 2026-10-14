// Расчёт стоимости доставки по расстоянию от магазина (пл. Восстания, Санкт-Петербург).
// Адрес → координаты через бесплатный геокодер OpenStreetMap (Nominatim), потом считаем километры.
const { getSetting } = require('../settings');

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
const MAX_CITY_ZONES = 10;
const getTariff = () => getSetting('delivery_tariff', DEFAULT_TARIFF);

// Проверяем и чистим тариф, который прислали из админки
function cleanTariff(tariffForm = {}) {
  const toWholeNumber = (value, minimum = 0) => Math.max(minimum, Math.round(Number(value)) || 0);
  const city = (Array.isArray(tariffForm.city) ? tariffForm.city : [])
    .map((zone) => ({ km: toWholeNumber(zone?.km, 1), price: toWholeNumber(zone?.price) }))
    .filter((zone) => zone.km > 0)
    .sort((firstZone, secondZone) => firstZone.km - secondZone.km)
    .slice(0, MAX_CITY_ZONES);
  if (!city.length) throw Object.assign(new Error('Добавьте хотя бы одну зону по городу'), { expose: true });
  return {
    city,
    region: { base: toWholeNumber(tariffForm.region?.base), perKm: toWholeNumber(tariffForm.region?.perKm), fromKm: toWholeNumber(tariffForm.region?.fromKm) },
    freeFrom: toWholeNumber(tariffForm.freeFrom),
  };
}

// Расстояние между двумя точками на Земле по прямой, км (формула гаверсинусов)
function distanceKm(fromPoint, toPoint) {
  const EARTH_RADIUS_KM = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(toPoint.lat - fromPoint.lat);
  const longitudeDelta = toRadians(toPoint.lon - fromPoint.lon);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(fromPoint.lat)) * Math.cos(toRadians(toPoint.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(haversine));
}

// ─── Геокодер ────────────────────────────────────────────
// Правила Nominatim: не чаще 1 запроса в секунду и обязательно «представиться» (User-Agent).
// Поэтому ставим запросы в очередь и запоминаем уже найденные адреса.
const GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';
const GEOCODER_PAUSE_MS = 1100;
const GEOCODER_TIMEOUT_MS = 7000;
const MAX_QUEUED_REQUESTS = 15;
const MAX_CACHED_ADDRESSES = 2000;

const foundPlaces = new Map();
let geocoderQueue = Promise.resolve();
let queuedRequests = 0;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function geocode(query) {
  const cacheKey = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (foundPlaces.has(cacheKey)) return Promise.resolve(foundPlaces.get(cacheKey));
  // очередь не растёт бесконечно
  if (queuedRequests >= MAX_QUEUED_REQUESTS) return Promise.reject(new Error('Сервис адресов перегружен — попробуйте через минуту'));
  queuedRequests++;
  const geocoderJob = geocoderQueue.then(async () => {
    const url = GEOCODER_URL + '?' + new URLSearchParams({
      q: query, format: 'jsonv2', addressdetails: '1', limit: '1', 'accept-language': 'ru', countrycodes: 'ru',
      viewbox: '27.8,61.4,35.7,58.4', bounded: '1', // только СПб и Ленобласть
    });
    const geocoderResponse = await fetch(url, {
      headers: { 'User-Agent': 'FlerFlowerShopBot/1.0 (Telegram flower shop)' },
      signal: AbortSignal.timeout(GEOCODER_TIMEOUT_MS),
    });
    if (!geocoderResponse.ok) throw new Error('geocoder ' + geocoderResponse.status);
    const [bestMatch] = await geocoderResponse.json();
    const place = bestMatch ? {
      lat: Number(bestMatch.lat), lon: Number(bestMatch.lon),
      state: bestMatch.address?.state || bestMatch.address?.city || '',
      label: bestMatch.display_name.split(', ').slice(0, 4).join(', '),
    } : null;
    if (foundPlaces.size > MAX_CACHED_ADDRESSES) foundPlaces.clear();
    foundPlaces.set(cacheKey, place);
    return place;
  });
  geocoderJob.finally(() => { queuedRequests--; }).catch(() => {});
  geocoderQueue = geocoderJob.catch(() => {}).then(() => sleep(GEOCODER_PAUSE_MS)); // пауза между запросами
  return geocoderJob;
}

// ─── Главная функция: сколько стоит доставка ─────────────
// zone: 'city' (Санкт-Петербург) или 'region' (Ленинградская область) — выбирает покупатель
async function quote(address, zone, goodsTotal = 0) {
  const prefix = zone === 'region' ? 'Ленинградская область, ' : 'Санкт-Петербург, ';
  const place = await geocode(prefix + address);
  if (!place) return { ok: false, error: 'Не нашли такой адрес 🤔 Проверьте улицу и номер дома' };

  const inSaintPetersburg = /Санкт-Петербург/i.test(place.state);
  const inLeningradRegion = /Ленинградская/i.test(place.state);
  if (!inSaintPetersburg && !inLeningradRegion) return { ok: false, error: 'Доставляем только по Санкт-Петербургу и Ленобласти' };

  const km = Math.round(distanceKm(SHOP, place) * 10) / 10;
  const tariff = await getTariff();
  let fee;
  if (inSaintPetersburg) {
    fee = (tariff.city.find((zoneTariff) => km <= zoneTariff.km) || tariff.city[tariff.city.length - 1]).price;
  } else {
    fee = tariff.region.base + Math.ceil(Math.max(0, km - tariff.region.fromKm)) * tariff.region.perKm;
  }
  const free = tariff.freeFrom > 0 && goodsTotal >= tariff.freeFrom;
  return {
    ok: true,
    fee: free ? 0 : fee,
    fullFee: fee,
    free,
    freeFrom: tariff.freeFrom,
    km,
    zone: inSaintPetersburg ? 'Санкт-Петербург' : 'Ленобласть',
    found: place.label,
  };
}

module.exports = { quote, getTariff, cleanTariff, distanceKm, geocode, SHOP, DEFAULT_TARIFF };
