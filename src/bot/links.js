// Ссылки на витрину и админку (WEBAPP_URL из .env)

// Ссылка на витрину с параметром, например ?repeat=12
function shopUrl(parameters = {}) {
  const url = new URL(process.env.WEBAPP_URL);
  for (const [parameterName, parameterValue] of Object.entries(parameters))
    url.searchParams.set(parameterName, parameterValue);
  return url.toString();
}

// Ссылка на админку, например ?chat=123 — сразу открыть переписку
function adminUrl(parameters = {}) {
  const webAppUrl = process.env.WEBAPP_URL;
  const url = new URL('admin.html', webAppUrl.endsWith('/') ? webAppUrl : webAppUrl + '/');
  for (const [parameterName, parameterValue] of Object.entries(parameters))
    url.searchParams.set(parameterName, parameterValue);
  return url.toString();
}

module.exports = { shopUrl, adminUrl };
