// Умный поиск: «Розы», «роз», «розовый» → находим по основе слова; регистр и ё/е не важны.
import { state } from '../state.js';
import { escapeHtml } from '../../shared/dom.js';

const normalize = (text) => String(text).toLowerCase().replace(/ё/g, 'е');
// Основа слова: у длинных слов отрезаем окончание
const wordStem = (word) => {
  if (word.length > 5) return word.slice(0, -2);
  if (word.length > 3) return word.slice(0, -1);
  return word;
};
const splitWords = (text) =>
  normalize(text)
    .split(/[^a-zа-я0-9]+/i)
    .filter(Boolean);

export function matchesSearch(product) {
  const queryWords = splitWords(state.searchQuery);
  if (!queryWords.length) return true;
  const searchableText = normalize(`${product.name} ${product.description} ${product.category} ${product.badge || ''}`);
  return queryWords.every((word) => searchableText.includes(wordStem(word)));
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Текст для HTML с подсвеченными (<mark>) найденными словами */
export function highlightMatches(text) {
  const stems = splitWords(state.searchQuery)
    .map(wordStem)
    .filter((stem) => stem.length > 1);
  const escapedText = escapeHtml(text);
  if (!stems.length) return escapedText;
  const pattern = new RegExp('(' + stems.map((stem) => escapeRegExp(stem).replace(/е/g, '[её]')).join('|') + ')', 'gi');
  return escapedText.replace(pattern, '<mark>$1</mark>');
}
