const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'chat.db');

let db = null;

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  runMigrations();
  persist(); // initial save
  return db;
}

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function runMigrations() {
  // Set timezone to UTC+8
  db.run(`PRAGMA timezone = 480`); // 480 minutes = 8 hours

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT UNIQUE NOT NULL,
      nickname     TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#00a884',
      created_at   DATETIME DEFAULT (datetime('now', 'localtime', '+8 hours'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id   INTEGER NOT NULL,
      content     TEXT,
      type        TEXT DEFAULT 'text',
      media_url   TEXT,
      duration    INTEGER,
      sent_at     DATETIME DEFAULT (datetime('now', 'localtime', '+8 hours')),
      edited_at   DATETIME,
      is_deleted  INTEGER DEFAULT 0,
      is_recalled INTEGER DEFAULT 0,
      quote_id    INTEGER,
      FOREIGN KEY (sender_id) REFERENCES users(id),
      FOREIGN KEY (quote_id)  REFERENCES messages(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS read_receipts (
      user_id    INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      read_at    DATETIME DEFAULT (datetime('now', 'localtime', '+8 hours')),
      PRIMARY KEY (user_id, message_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_clear_history (
      user_id    INTEGER NOT NULL PRIMARY KEY,
      cleared_at DATETIME DEFAULT (datetime('now', 'localtime', '+8 hours'))
    )
  `);

  // Add columns if they don't exist (safe to run repeatedly)
  try { db.run(`ALTER TABLE users ADD COLUMN avatar_url TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`); } catch(e) {}
  try { db.run(`ALTER TABLE messages ADD COLUMN room TEXT DEFAULT '689'`); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      passcode   TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', 'localtime', '+8 hours'))
    )
  `);

  // Seed default rooms
  try { db.run(`INSERT OR IGNORE INTO rooms (passcode, name) VALUES ('689', 'Main Room')`); } catch(e) {}
}

// --- Query helpers ---

function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function runInsert(sql, params = []) {
  db.run(sql, params);
  const result = db.exec('SELECT last_insert_rowid()');
  persist();
  return result[0] ? result[0].values[0][0] : null;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const results = [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

module.exports = { initDb, run, runInsert, get, all, persist };
