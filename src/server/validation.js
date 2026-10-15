// Общие помощники для validation.js маршрутов.
// Проверка — это middleware перед маршрутом: разбирает запрос, кладёт готовые значения в request.validated
// или сразу отвечает ошибкой, и тогда маршрут не вызывается.
class ValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// validate(request) возвращает объект проверенных значений (или Promise с ним) либо бросает ValidationError.
// Остальные ошибки с expose = true (например, из cleanTariff) тоже показываем пользователю как 400.
function createValidator(validate) {
  return async (request, response, next) => {
    try {
      request.validated = { ...(request.validated || {}), ...((await validate(request)) || {}) };
    } catch (validationError) {
      if (!(validationError instanceof ValidationError) && !validationError.expose) return next(validationError);
      return response.status(validationError.statusCode || 400).json({ error: validationError.message });
    }
    return next();
  };
}

const parsePositiveId = (value) => {
  const parsedId = Number(value);
  return Number.isSafeInteger(parsedId) && parsedId > 0 ? parsedId : 0;
};
const cleanText = (value, maxLength) =>
  String(value ?? '')
    .trim()
    .slice(0, maxLength);
const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

// :id в адресе → request.validated[fieldName] (0, если не число — маршрут ответит «не найдено»)
const idParamValidator = (fieldName, parameterName = 'id') =>
  createValidator((request) => ({ [fieldName]: parsePositiveId(request.params[parameterName]) }));

module.exports = { ValidationError, createValidator, parsePositiveId, cleanText, isIsoDate, idParamValidator };
