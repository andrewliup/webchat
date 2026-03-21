const express = require('express');
const router = express.Router();
const db = require('../db');

// Auth guard
router.use((req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
});

// PUT /api/profile
router.put('/', (req, res) => {
  const { nickname, status, avatar_url } = req.body;
  if (!nickname) return res.status(400).json({ error: 'Nickname required' });

  const validStatuses = ['active', 'inactive', 'sleep', 'dnd'];
  const safeStatus = validStatuses.includes(status) ? status : 'active';

  db.run(
    `UPDATE users SET nickname = ?, status = ?, avatar_url = ? WHERE id = ?`,
    [nickname, safeStatus, avatar_url || null, req.session.userId]
  );

  const user = db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);

  // Broadcast profile update so partner sees new nickname/avatar/status
  const io = req.app.get('io');
  if (io) io.emit('user_updated', { user });

  res.json({ user });
});

module.exports = router;
