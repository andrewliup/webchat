const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { run, runInsert, get, all } = db;

// Auth guard
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Multer setup
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video|audio)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});

// GET /api/messages?before=<id>&limit=50
router.get('/messages', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;

  // Respect cleared_at
  const clearRow = get('SELECT cleared_at FROM user_clear_history WHERE user_id = ?', [userId]);
  const clearedAt = clearRow ? clearRow.cleared_at : null;

  let sql = `SELECT * FROM messages WHERE is_deleted = 0`;
  const params = [];

  if (clearedAt) {
    sql += ` AND sent_at > ?`;
    params.push(clearedAt);
  }
  if (before) {
    sql += ` AND id < ?`;
    params.push(before);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);

  const rows = all(sql, params).reverse();
  
  // Convert datetime strings (UTC+8) to timestamps
  // The stored datetime is already UTC+8, parse it directly
  rows.forEach(m => {
    if (m.sent_at && typeof m.sent_at === 'string') {
      // Parse as UTC+8 without adding offset
      const [date, time] = m.sent_at.split(' ');
      const [year, month, day] = date.split('-').map(Number);
      const [hour, min, sec] = time.split(':').map(Number);
      // Create date in UTC+8 (which is Asia/Shanghai time)
      m.sent_at = new Date(Date.UTC(year, month - 1, day, hour, min, sec)).getTime() - (8 * 3600000);
    }
  });

  // Attach last read message id for current user
  const lastRead = get(
    `SELECT MAX(message_id) as id FROM read_receipts WHERE user_id = ?`,
    [userId]
  );

  res.json({ messages: rows, lastReadId: lastRead ? lastRead.id : null });
});

// POST /api/messages
router.post('/messages', requireAuth, (req, res) => {
  const { content, type = 'text', media_url, duration, quote_id } = req.body;
  const sender_id = req.session.userId;

  if (!content && !media_url) {
    return res.status(400).json({ error: 'content or media_url required' });
  }

  const newId = runInsert(
    `INSERT INTO messages (sender_id, content, type, media_url, duration, quote_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sender_id, content || null, type, media_url || null, duration || null, quote_id || null]
  );

  const msg = get('SELECT * FROM messages WHERE id = ?', [newId]);
  
  // Convert datetime (UTC+8) to timestamp
  if (msg.sent_at && typeof msg.sent_at === 'string') {
    const [date, time] = msg.sent_at.split(' ');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, min, sec] = time.split(':').map(Number);
    msg.sent_at = new Date(Date.UTC(year, month - 1, day, hour, min, sec)).getTime() - (8 * 3600000);
  }

  const io = req.app.get('io');
  io.emit('new_message', msg);

  res.json({ message: msg });
});

// PUT /api/messages/:id  (edit)
router.put('/messages/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;
  const { content } = req.body;

  const msg = get('SELECT * FROM messages WHERE id = ?', [id]);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (msg.sender_id !== userId) return res.status(403).json({ error: 'Forbidden' });
  if (msg.is_recalled) return res.status(400).json({ error: 'Cannot edit recalled message' });

  const sentAt = typeof msg.sent_at === 'string'
    ? (() => {
        const [date, time] = msg.sent_at.split(' ');
        const [year, month, day] = date.split('-').map(Number);
        const [hour, min, sec] = time.split(':').map(Number);
        return new Date(Date.UTC(year, month - 1, day, hour, min, sec)).getTime() - (8 * 3600000);
      })()
    : msg.sent_at;
  const age = Date.now() - sentAt;
  if (age > 10 * 60 * 1000) return res.status(400).json({ error: 'Edit window expired (10 min)' });

  run(
    `UPDATE messages SET content = ?, edited_at = datetime('now', 'localtime', '+8 hours') WHERE id = ?`,
    [content, id]
  );

  const updated = get('SELECT * FROM messages WHERE id = ?', [id]);
  if (updated && updated.edited_at && typeof updated.edited_at === 'string') {
    const [date, time] = updated.edited_at.split(' ');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, min, sec] = time.split(':').map(Number);
    updated.edited_at = new Date(Date.UTC(year, month - 1, day, hour, min, sec)).getTime() - (8 * 3600000);
  }
  req.app.get('io').emit('message_updated', updated);
  res.json({ message: updated });
});

// DELETE /api/messages/:id  (delete or recall)
router.delete('/messages/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId;
  const { action = 'delete' } = req.query; // ?action=recall

  const msg = get('SELECT * FROM messages WHERE id = ?', [id]);
  if (!msg) return res.status(404).json({ error: 'Not found' });
  if (msg.sender_id !== userId) return res.status(403).json({ error: 'Forbidden' });

  const sentAt = typeof msg.sent_at === 'string'
    ? (() => {
        const [date, time] = msg.sent_at.split(' ');
        const [year, month, day] = date.split('-').map(Number);
        const [hour, min, sec] = time.split(':').map(Number);
        return new Date(Date.UTC(year, month - 1, day, hour, min, sec)).getTime() - (8 * 3600000);
      })()
    : msg.sent_at;
  if (action === 'recall') {
    const age = Date.now() - sentAt;
    if (age > 10 * 60 * 1000) return res.status(400).json({ error: 'Recall window expired (10 min)' });
    run(`UPDATE messages SET is_recalled = 1 WHERE id = ?`, [id]);
  } else {
    run(`UPDATE messages SET is_deleted = 1 WHERE id = ?`, [id]);
  }

  req.app.get('io').emit('message_deleted', { id: Number(id), action });
  res.json({ ok: true });
});

// POST /api/messages/clear
router.post('/messages/clear', requireAuth, (req, res) => {
  const userId = req.session.userId;
  run(
    `INSERT OR REPLACE INTO user_clear_history (user_id, cleared_at) VALUES (?, datetime('now', 'localtime', '+8 hours'))`,
    [userId]
  );
  res.json({ ok: true });
});

// GET /api/messages/search?q=keyword
router.get('/messages/search', requireAuth, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ messages: [] });

  const userId = req.session.userId;
  const clearRow = get('SELECT cleared_at FROM user_clear_history WHERE user_id = ?', [userId]);
  const clearedAt = clearRow ? clearRow.cleared_at : null;

  let sql = `SELECT * FROM messages WHERE is_deleted = 0 AND is_recalled = 0 AND type = 'text' AND content LIKE ?`;
  const params = [`%${q}%`];

  if (clearedAt) {
    sql += ` AND sent_at > ?`;
    params.push(clearedAt);
  }
  sql += ` ORDER BY id DESC LIMIT 50`;

  const rows = all(sql, params);
  res.json({ messages: rows });
});

// PUT /api/messages/:id/read
router.put('/messages/:id/read', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const messageId = parseInt(req.params.id);

  run(
    `INSERT OR REPLACE INTO read_receipts (user_id, message_id) VALUES (?, ?)`,
    [userId, messageId]
  );

  req.app.get('io').emit('message_read', { userId, messageId });
  res.json({ ok: true });
});

// POST /api/upload
router.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// GET /api/users  (list both users + online status)
router.get('/users', requireAuth, (req, res) => {
  const users = all('SELECT id, email, nickname, avatar_color, avatar_url FROM users');
  const onlineUsers = req.app.get('onlineUsers');
  const result = users.map(u => ({ ...u, online: onlineUsers.has(u.id) }));
  res.json({ users: result });
});

module.exports = router;
