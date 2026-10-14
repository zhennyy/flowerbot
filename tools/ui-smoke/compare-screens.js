// Попиксельное сравнение скриншотов двух прогонов (PNG разбираем в canvas того же Chromium).
const fs = require('node:fs');
const path = require('node:path');

// разница цвета в 1–2 единицы — шум растеризации Chromium (бывает и между двумя прогонами без изменений)
const NOISE_LEVEL = 2;
// несколько пикселей на краях теней и размытия иногда отличаются и между двумя прогонами одной версии
const MAX_NOISE_PIXELS = 16;

/** Сколько пикселей отличается (или строка «размер …», если картинки разного размера) */
function countDifferentPixels(page, beforePng, afterPng) {
  return page.evaluate(async ([beforeBase64, afterBase64, noiseLevel]) => {
    const loadImage = (base64) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.src = 'data:image/png;base64,' + base64;
    });
    const [beforeImage, afterImage] = await Promise.all([loadImage(beforeBase64), loadImage(afterBase64)]);
    if (beforeImage.width !== afterImage.width || beforeImage.height !== afterImage.height) {
      return `размер ${beforeImage.width}×${beforeImage.height} → ${afterImage.width}×${afterImage.height}`;
    }
    const readPixels = (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const beforePixels = readPixels(beforeImage);
    const afterPixels = readPixels(afterImage);
    let differentCount = 0;
    for (let offset = 0; offset < beforePixels.length; offset += 4) {
      const channelDifference = Math.max(...[0, 1, 2].map((channel) => Math.abs(beforePixels[offset + channel] - afterPixels[offset + channel])));
      if (channelDifference > noiseLevel) differentCount++;
    }
    return differentCount;
  }, [beforePng.toString('base64'), afterPng.toString('base64'), NOISE_LEVEL]);
}

async function compareScreens(browser, outputDir, compareDir) {
  const results = [];
  const page = await browser.newPage();
  for (const file of fs.readdirSync(outputDir).filter((name) => name.endsWith('.png')).sort()) {
    const beforeFile = path.join(compareDir, file);
    if (!fs.existsSync(beforeFile)) { results.push({ file, status: 'нет пары' }); continue; }
    const afterPng = fs.readFileSync(path.join(outputDir, file));
    const beforePng = fs.readFileSync(beforeFile);
    if (afterPng.equals(beforePng)) { results.push({ file, status: 'совпадает' }); continue; }
    const differentPixels = await countDifferentPixels(page, beforePng, afterPng);
    if (typeof differentPixels === 'number' && differentPixels <= MAX_NOISE_PIXELS) results.push({ file, status: 'совпадает', noisePixels: differentPixels });
    else results.push({ file, status: `отличается: ${differentPixels}${typeof differentPixels === 'number' ? ' пикс.' : ''}` });
  }
  await page.close();
  // состояние Telegram на каждом экране: кнопка «Назад», окна-сообщения, открытые ссылки
  const beforeScreens = JSON.parse(fs.readFileSync(path.join(compareDir, 'report.json'), 'utf8')).screens;
  const afterScreens = JSON.parse(fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8')).screens;
  for (const screen of afterScreens) {
    const pair = beforeScreens.find((item) => item.name === screen.name);
    if (pair && JSON.stringify(pair) !== JSON.stringify(screen)) results.push({ file: screen.name, status: `Telegram: ${JSON.stringify(pair)} → ${JSON.stringify(screen)}` });
  }
  return results;
}

module.exports = { compareScreens };
