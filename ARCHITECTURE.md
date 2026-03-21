# WebChat Architecture Design

## Overview
Mobile-first, real-time 1-on-1 web chat for 2 users with rich media messaging.

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | Vanilla HTML/CSS/JS | No build step, fast mobile load |
| Backend | Node.js + Express | Lightweight, JS ecosystem |
| Real-time | Socket.io | WebSocket with automatic fallback |
| Database | SQLite (better-sqlite3) | Zero config, perfect for 2-user scale |
| File Storage | Local disk (Multer) | Simple for this scale |
| Auth | express-session | Simple session management |

## System Diagram

```
┌──────────────────────────────────────────────┐
│           Mobile Browser (Client)             │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Login   │  │   Chat   │  │  Search  │  │
│  │  Screen  │  │  Screen  │  │ Overlay  │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                                              │
│     REST API (fetch) + Socket.io WS          │
└──────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│              Node.js Backend                  │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Express  │  │Socket.io │  │  Multer  │  │
│  │   API    │  │  Server  │  │ Uploads  │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│                      │                       │
│  ┌───────────────────────────────────────┐  │
│  │           SQLite Database             │  │
│  │  users | messages | read_receipts     │  │
│  └───────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## Project Structure

```
WebChat/
├── frontend/
│   ├── index.html       # Single-page app (login + chat)
│   ├── style.css        # Light/dark theme styles
│   └── app.js           # Client-side logic + Socket.io
├── backend/
│   ├── server.js        # Express + Socket.io entry point
│   ├── db.js            # SQLite setup & query helpers
│   ├── routes/
│   │   ├── auth.js      # Login / logout
│   │   └── messages.js  # CRUD, search, upload
│   └── uploads/         # Stored media files
├── package.json
└── README.md
```

## Database Schema

```sql
CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT UNIQUE NOT NULL,
  nickname     TEXT NOT NULL,
  avatar_color TEXT DEFAULT '#00a884',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id   INTEGER NOT NULL,
  content     TEXT,
  type        TEXT DEFAULT 'text',   -- text | image | video | voice
  media_url   TEXT,
  duration    INTEGER,               -- voice seconds
  sent_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  edited_at   DATETIME,
  is_deleted  INTEGER DEFAULT 0,
  is_recalled INTEGER DEFAULT 0,
  quote_id    INTEGER,               -- id of quoted/replied message (nullable)
  FOREIGN KEY (sender_id) REFERENCES users(id),
  FOREIGN KEY (quote_id)  REFERENCES messages(id)
);

CREATE TABLE read_receipts (
  user_id    INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  read_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE user_clear_history (
  user_id    INTEGER NOT NULL,
  cleared_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login (email, nickname, passcode=2013) |
| POST | /api/auth/logout | Logout |
| GET | /api/messages | Get messages (paginated) |
| POST | /api/messages | Send message |
| PUT | /api/messages/:id | Edit message (within 10 min) |
| DELETE | /api/messages/:id | Delete / recall |
| POST | /api/messages/clear | Clear locally (keep in DB) |
| GET | /api/messages/search?q= | Full-text search |
| POST | /api/upload | Upload image / video / voice |
| PUT | /api/messages/:id/read | Mark as read |

## Socket.io Events

**Client → Server**
- `send_message` — new message payload
- `typing` — user is typing indicator
- `read_message` — user scrolled to message_id

**Server → Client**
- `new_message` — broadcast to both users
- `message_updated` — edited message
- `message_deleted` — recalled / deleted
- `user_status` — online / offline
- `user_typing` — partner typing indicator

## Security Notes
- Passcode `2013` validated server-side only, never exposed to client
- Sessions expire after 7 days of inactivity
- File uploads: MIME type validation, 50 MB size limit
- Voice messages: 60-second max enforced client-side via MediaRecorder
- Edit/recall window: 10-minute check enforced server-side
- Quote/reply: `quote_id` on message references original; client renders inline preview block; tapping jumps to original with highlight animation
- Context menu: long-press (mobile) or right-click (desktop) shows Copy / Quote / Edit / Recall / Delete / Clear; only own-message actions shown for self
- Eye icon: shown only on sender's own last message that the partner has read
- Timestamp separators: displayed only when gap between consecutive messages exceeds 2 hours; no per-message timestamp
