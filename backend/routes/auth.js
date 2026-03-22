const express = require('express');
const router = express.Router();
const db = require('../db');

const PASSCODE = '2013';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, passcode } = req.body;

  if (!email || !passcode) {
    return res.status(400).json({ error: 'email and passcode are required' });
  }
  if (String(passcode) !== PASSCODE) {
    return res.status(401).json({ error: 'Invalid passcode' });
  }

  // Check how many users exist (max 2)
  const existing = db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);

  if (!existing) {
    const count = db.get('SELECT COUNT(*) as c FROM users', []);
    if (count && count.c >= 2) {
      return res.status(403).json({ error: 'This chat is full (max 2 users)' });
    }
    // Create new user — derive nickname from email prefix
    const nickname = email.split('@')[0];
    db.run(
      'INSERT INTO users (email, nickname) VALUES (?, ?)',
      [email.toLowerCase(), nickname]
    );
  }

  const user = db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);

  req.session.userId = user.id;
  req.session.save();

  res.json({ user });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// GET /api/auth/me — restore session
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
});

// GET /api/auth/debug-users — show registered emails (temporary debug)
router.get('/debug-users', (req, res) => {
  const users = db.all('SELECT id, email, nickname FROM users');
  res.json({ users });
});

module.exports = router;
