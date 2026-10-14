// Миграции схемы: SQL-файлы из prisma/migrations применяются по порядку, каждый один раз.
// Применённые записываются в служебную таблицу _app_migrations.
// Работает синхронно и до подключения Prisma — чтобы к старту приложения схема уже была актуальной.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIRECTORY = path.join(__dirname, '..', '..', 'prisma', 'migrations');
// Версия базы, до которой её доводил старый db.js (PRAGMA user_version). 001_baseline.sql — ровно эта схема.
const LAST_LEGACY_VERSION = 10;

// База от очень старой версии бота (до v10) — baseline не добавит недостающие колонки, лучше остановиться с понятной ошибкой
function assertNotOutdatedLegacyDatabase(connection) {
  const hasProducts = connection.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'products'").get();
  const legacyVersion = connection.pragma('user_version', { simple: true });
  if (hasProducts && legacyVersion < LAST_LEGACY_VERSION) {
    throw new Error(`База старой версии (${legacyVersion}): сначала один раз запустите прежнюю версию бота, она обновит базу до версии ${LAST_LEGACY_VERSION}`);
  }
}

function runMigrations(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const connection = new Database(databasePath);
  try {
    connection.exec('CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
    const appliedNames = new Set(connection.prepare('SELECT name FROM _app_migrations').all().map((migration) => migration.name));
    if (!appliedNames.size) assertNotOutdatedLegacyDatabase(connection);
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIRECTORY).filter((fileName) => fileName.endsWith('.sql')).sort();
    for (const fileName of migrationFiles) {
      if (appliedNames.has(fileName)) continue;
      const migrationSql = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, fileName), 'utf8');
      connection.transaction(() => {
        connection.exec(migrationSql);
        connection.prepare('INSERT INTO _app_migrations (name) VALUES (?)').run(fileName);
      })();
      console.log(`База: применена миграция ${fileName}`);
    }
  } finally {
    connection.close();
  }
}

module.exports = { runMigrations, LAST_LEGACY_VERSION };
