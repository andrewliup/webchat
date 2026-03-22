const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
// Use bundled ffmpeg-static binary if available, otherwise fall back to system ffmpeg
try {
  const ffmpegStatic = require('ffmpeg-static');
  if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
} catch (e) { /* use system ffmpeg */ }
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

// GET /api/messages/initial - Load messages around last read
router.get('/messages/initial', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const limit = 50;

  const clearRow = get('SELECT cleared_at FROM user_clear_history WHERE user_id = ?', [userId]);
  const clearedAt = clearRow ? clearRow.cleared_at : null;

  const lastRead = get(`SELECT MAX(message_id) as id FROM read_receipts WHERE user_id = ?`, [userId]);
  const lastReadId = lastRead ? lastRead.id : null;

  let messages = [];
  if (lastReadId) {
    // Load 50 before + 50 after last read
    let sql = `SELECT * FROM messages WHERE is_deleted = 0`;
    const params = [];
    if (clearedAt) {
      sql += ` AND sent_at > ?`;
      params.push(clearedAt);
    }
    sql += ` AND id <= ? ORDER BY id DESC LIMIT ?`;
    params.push(lastReadId, limit);
    const before = all(sql, params);

    sql = `SELECT * FROM messages WHERE is_deleted = 0`;
    const params2 = [];
    if (clearedAt) {
      sql += ` AND sent_at > ?`;
      params2.push(clearedAt);
    }
    sql += ` AND id > ? ORDER BY id ASC LIMIT ?`;
    params2.push(lastReadId, limit);
    const after = all(sql, params2);

    messages = [...before.reverse(), ...after];
  } else {
    // No last read, load latest 50
    let sql = `SELECT * FROM messages WHERE is_deleted = 0`;
    const params = [];
    if (clearedAt) {
      sql += ` AND sent_at > ?`;
      params.push(clearedAt);
    }
    sql += ` ORDER BY id DESC LIMIT ?`;
    params.push(limit);
    messages = all(sql, params).reverse();
  }

  messages.forEach(m => {
    if (m.sent_at && typeof m.sent_at === 'string') {
      const [date, time] = m.sent_at.split(' ');
      const [year, month, day] = date.split('-').map(Number);
      const [hour, min, sec] = time.split(':').map(Number);
      m.sent_at = Date.UTC(year, month - 1, day, hour, min, sec);
    }
  });

  res.json({ messages, lastReadId });
});

// GET /api/messages?before_id=<id>&after_id=<id>&limit=50
router.get('/messages', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const beforeId = req.query.before_id ? parseInt(req.query.before_id) : null;
  const afterId = req.query.after_id ? parseInt(req.query.after_id) : null;

  const clearRow = get('SELECT cleared_at FROM user_clear_history WHERE user_id = ?', [userId]);
  const clearedAt = clearRow ? clearRow.cleared_at : null;

  let sql = `SELECT * FROM messages WHERE is_deleted = 0`;
  const params = [];

  if (clearedAt) {
    sql += ` AND sent_at > ?`;
    params.push(clearedAt);
  }
  if (beforeId) {
    sql += ` AND id < ?`;
    params.push(beforeId);
  }
  if (afterId) {
    sql += ` AND id > ?`;
    params.push(afterId);
  }
  sql += afterId ? ` ORDER BY id ASC LIMIT ?` : ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);

  const rows = all(sql, params);
  const messages = afterId ? rows : rows.reverse();

  messages.forEach(m => {
    if (m.sent_at && typeof m.sent_at === 'string') {
      const [date, time] = m.sent_at.split(' ');
      const [year, month, day] = date.split('-').map(Number);
      const [hour, min, sec] = time.split(':').map(Number);
      m.sent_at = Date.UTC(year, month - 1, day, hour, min, sec);
    }
  });

  res.json({ messages });
});

// POST /api/messages
router.post('/messages', requireAuth, (req, res) => {
  const { content, type = 'text', media_url, thumb_url, duration, quote_id } = req.body;
  const sender_id = req.session.userId;

  if (!content && !media_url) {
    return res.status(400).json({ error: 'content or media_url required' });
  }

  const newId = runInsert(
    `INSERT INTO messages (sender_id, content, type, media_url, thumb_url, duration, quote_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sender_id, content || null, type, media_url || null, thumb_url || null, duration || null, quote_id || null]
  );

  const msg = get('SELECT * FROM messages WHERE id = ?', [newId]);
  
  // Convert UTC datetime to timestamp
  if (msg.sent_at && typeof msg.sent_at === 'string') {
    const [date, time] = msg.sent_at.split(' ');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, min, sec] = time.split(':').map(Number);
    msg.sent_at = Date.UTC(year, month - 1, day, hour, min, sec);
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
        return Date.UTC(year, month - 1, day, hour, min, sec);
      })()
    : msg.sent_at;
  const age = Date.now() - sentAt;
  if (age > 10 * 60 * 1000) return res.status(400).json({ error: 'Edit window expired (10 min)' });

  run(
    `UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [content, id]
  );

  const updated = get('SELECT * FROM messages WHERE id = ?', [id]);
  if (updated && updated.edited_at && typeof updated.edited_at === 'string') {
    const [date, time] = updated.edited_at.split(' ');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, min, sec] = time.split(':').map(Number);
    updated.edited_at = Date.UTC(year, month - 1, day, hour, min, sec);
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
        return Date.UTC(year, month - 1, day, hour, min, sec);
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
    `INSERT OR REPLACE INTO user_clear_history (user_id, cleared_at) VALUES (?, CURRENT_TIMESTAMP)`,
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

// POST /api/upload/avatar — upload and resize profile picture to 128×128 WebP
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Images only'));
  }
});
router.post('/upload/avatar', requireAuth, avatarUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const filename = `avatar-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
    const outPath = path.join(__dirname, '../uploads', filename);
    await sharp(req.file.buffer)
      .rotate()
      .resize(128, 128, { fit: 'cover', position: 'centre' })
      .webp({ quality: 80 })
      .toFile(outPath);
    res.json({ url: `/uploads/${filename}` });
  } catch (err) {
    res.status(500).json({ error: 'Image processing failed' });
  }
});

// POST /api/upload
function extractVideoThumb(videoPath, thumbPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({ timestamps: ['0.5'], filename: path.basename(thumbPath), folder: path.dirname(thumbPath), size: '400x?' })
      .on('end', resolve)
      .on('error', reject);
  });
}

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;

  if (req.file.mimetype.startsWith('image/')) {
    try {
      const thumbName = req.file.filename.replace(/(\.[^.]+)?$/, '-thumb.webp');
      const thumbPath = path.join(__dirname, '../uploads', thumbName);
      await sharp(req.file.path)
        .rotate()
        .resize(400, 300, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(thumbPath);
      return res.json({ url, thumb_url: `/uploads/${thumbName}` });
    } catch (err) { /* fall through */ }
  }

  if (req.file.mimetype.startsWith('video/')) {
    try {
      const thumbName = req.file.filename.replace(/(\.[^.]+)?$/, '-thumb.jpg');
      const thumbPath = path.join(__dirname, '../uploads', thumbName);
      await extractVideoThumb(req.file.path, thumbPath);
      return res.json({ url, thumb_url: `/uploads/${thumbName}` });
    } catch (err) { /* fall through */ }
  }

  res.json({ url });
});

// POST /api/messages/seed — generate test messages
router.post('/messages/seed', requireAuth, (req, res) => {
  const users = all('SELECT id FROM users');
  if (users.length < 2) return res.status(400).json({ error: 'Need 2 users' });
  const [u1, u2] = users;
  const samples = [
    'Hey there!', 'How are you?', 'What are you up to?', 'That sounds great!',
    'I agree with you', 'Let me check that', 'Sure, no problem', 'Sounds good to me',
    'Have you seen this?', 'What do you think?', 'I was just thinking about that',
    'That makes sense', 'Can you help me with something?', 'Of course!',
    'Thanks a lot', 'No worries', 'Talk later?', 'Sure thing!',
  ];
  const count = parseInt(req.query.count) || 500;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const sender = i % 3 === 0 ? u2.id : u1.id;
    const text = samples[i % samples.length] + ` #${i + 1}`;
    const ts = new Date(now - (count - i) * 60000).toISOString().replace('T', ' ').slice(0, 19);
    run(
      `INSERT INTO messages (sender_id, content, type, sent_at) VALUES (?, ?, 'text', ?)`,
      [sender, text, ts]
    );
  }
  res.json({ ok: true, inserted: count });
});

// GET /api/users  (list both users + online status)
router.get('/users', requireAuth, (req, res) => {
  const users = all('SELECT id, email, nickname, avatar_color, avatar_url, last_seen FROM users');
  const onlineUsers = req.app.get('onlineUsers');
  const result = users.map(u => ({ ...u, online: onlineUsers.has(u.id) }));
  res.json({ users: result });
});

module.exports = router;
