const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'webchat-secret-2013',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

// Track connected sockets by userId
const onlineUsers = new Map(); // userId -> socketId

// Make io available to routes
app.set('io', io);
app.set('onlineUsers', onlineUsers);

// Routes (loaded after db init)
async function start() {
  await initDb();

  const authRouter = require('./routes/auth');
  const messagesRouter = require('./routes/messages');
  const profileRouter = require('./routes/profile');

  app.use('/api/auth', authRouter);
  app.use('/api', messagesRouter);
  app.use('/api/profile', profileRouter);

  // Fallback to frontend
  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  });

  // Socket.io
  io.on('connection', (socket) => {
    const userId = socket.handshake.auth.userId;
    if (userId) {
      onlineUsers.set(Number(userId), socket.id);
      io.emit('user_status', { userId: Number(userId), online: true });
    }

    socket.on('typing', ({ userId: uid }) => {
      socket.broadcast.emit('user_typing', { userId: uid });
    });

    socket.on('read_message', ({ userId: uid, messageId }) => {
      const db = require('./db');
      try {
        db.run(
          `INSERT OR REPLACE INTO read_receipts (user_id, message_id) VALUES (?, ?)`,
          [uid, messageId]
        );
        io.emit('message_read', { userId: uid, messageId });
      } catch (e) { /* ignore */ }
    });

    socket.on('disconnect', () => {
      if (userId) {
        onlineUsers.delete(Number(userId));
        const lastSeen = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const db = require('./db');
        try { db.run(`UPDATE users SET last_seen = ? WHERE id = ?`, [lastSeen, Number(userId)]); } catch(e) {}
        io.emit('user_status', { userId: Number(userId), online: false, lastSeen });
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`WebChat running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
