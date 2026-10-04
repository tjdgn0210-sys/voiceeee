// Shared helpers for the verify-*.cjs development checks (not a test file itself: the name does not match verify-*).
// Loads TypeScript modules from src/ without a bundler and gives each test a disposable, migrated in-memory SQLite database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

/** Returns a require-like loader for src/*.ts. Native or UI imports are rejected: only pure and database code may be tested this way. */
function createLoader() {
  const cache = new Map();
  const loaded = new Set();
  function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    loaded.add(path.relative(root, file).replaceAll('\\', '/'));
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName: file,
    }).outputText;
    const mod = { exports: {} };
    cache.set(file, mod);
    const localRequire = name => {
      assert(name.startsWith('.'), `This check must not import a native runtime: ${name} (from ${path.relative(root, file)})`);
      return load(path.resolve(path.dirname(file), name) + '.ts');
    };
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename: file })(localRequire, mod, mod.exports);
    return mod.exports;
  }
  return { load, loaded };
}

/** In-memory database with the same surface as the app's ApplicationDatabase, migrated to the latest version. */
async function openMigratedDatabase(load) {
  const db = new DatabaseSync(':memory:');
  const api = {
    raw: db,
    execAsync: async sql => { db.exec(sql); },
    runAsync: async (sql, ...params) => db.prepare(sql).run(...params),
    getFirstAsync: async (sql, ...params) => db.prepare(sql).get(...params) ?? null,
    getAllAsync: async (sql, ...params) => db.prepare(sql).all(...params),
    withExclusiveTransactionAsync: async work => {
      db.exec('BEGIN');
      try { await work(api); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  await load('src/database/migrations/migrate.ts').migrateDatabase(api);
  return api;
}

module.exports = { assert, createLoader, openMigratedDatabase, root };
