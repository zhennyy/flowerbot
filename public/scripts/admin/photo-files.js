// Фото с телефона: сжимаем прямо в браузере, на сервер уходит лёгкий JPEG (data:image/jpeg;base64,…).

/** Файл из <input type="file"> → загруженная картинка */
export const readImageFile = (file) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = URL.createObjectURL(file);
});

/** Уменьшает до maxSide по большей стороне (не увеличивает) и кодирует в JPEG с качеством quality (0–1) */
export function resizeToJpeg(image, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}
