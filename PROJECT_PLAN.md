# WebChat Project Plan

## Phase 1 — Foundation
- [ ] `npm init` and install dependencies: `express socket.io better-sqlite3 multer express-session cors`
- [ ] Create `backend/db.js` — SQLite setup, run schema migrations on startup
- [ ] Create `backend/server.js` — Express app, static file serving, session middleware
- [ ] Create `backend/routes/auth.js` — POST `/api/auth/login` (validate passcode=2013, create/find user), POST `/api/auth/logout`
- [ ] Wire up Socket.io server, emit `user_status` on connect/disconnect

## Phase 2 — Core Messaging
- [ ] Create `backend/routes/messages.js` — GET `/api/messages` (paginated, respect `cleared_at`), POST `/api/messages`
- [ ] Socket.io: on `send_message` → save to DB → broadcast `new_message` to both users
- [ ] Frontend `app.js`: connect Socket.io, listen for `new_message`, append to DOM without full re-render
- [ ] Implement timestamp separator logic (2-hour gap rule, Today/Yesterday/Weekday display)
- [ ] Auto-scroll to last read message on page load; show unread count badge

## Phase 3 — Rich Media
- [ ] Create `POST /api/upload` — Multer middleware, validate MIME type (image/*, video/*, audio/*), 50 MB limit
- [ ] Frontend: image attach → upload → send message with `type:'image'`
- [ ] Frontend: video attach → upload → send message with `type:'video'`
- [ ] Frontend: emoji picker (built-in, no library needed)
- [ ] Frontend: voice recording via `MediaRecorder` API, max 60s enforced client-side, upload blob on release

## Phase 4 — Message Management
- [ ] `PUT /api/messages/:id` — edit text content, enforce 10-minute window server-side, set `edited_at`
- [ ] `DELETE /api/messages/:id` — soft delete (`is_deleted=1`) or recall (`is_recalled=1`), enforce 10-minute window
- [ ] Socket.io: broadcast `message_updated` / `message_deleted` to both users
- [ ] Frontend: long-press (mobile) or right-click (desktop) context menu with **Copy / Quote / Edit / Recall / Delete / Clear**
- [ ] Quote/reply: tapping "Quote" sets `quoteMsg` state, renders preview bar above input with cancel button; message sent with `quote_id`
- [ ] Frontend: render quoted message as inline reference block inside bubble; tap block to jump to original message with highlight animation (`scrollIntoView` + CSS keyframe)
- [ ] `POST /api/messages/clear` — save `cleared_at` timestamp for requesting user; messages stay in DB

## Phase 5 — Read Receipts & Search
- [ ] `PUT /api/messages/:id/read` — upsert `read_receipts` row
- [ ] Socket.io: on `read_message` event → update DB → broadcast `message_read` so partner sees eye icon move
- [ ] Frontend: `IntersectionObserver` on message bubbles to auto-mark as read when scrolled into view
- [ ] `GET /api/messages/search?q=` — SQLite `LIKE` query on `content`, return matching messages with context
- [ ] Frontend: search overlay, highlight keyword in results, click to scroll chat to that message

## Phase 6 — Sync & Polish
- [ ] Use `Page Visibility API` (`document.visibilitychange`) to pause/resume Socket.io connection when tab is hidden
- [ ] Light / dark theme toggle persisted in `localStorage`
- [ ] Typing indicator: emit `typing` event, show "Partner is typing…" in header status
- [ ] Mobile QA: test on iOS Safari and Android Chrome (safe-area insets, keyboard resize, touch events)
- [ ] Add `manifest.json` and meta tags for PWA installability (optional)

## Dependencies
```json
{
  "express": "^4.18",
  "socket.io": "^4.7",
  "better-sqlite3": "^9.4",
  "multer": "^1.4",
  "express-session": "^1.17",
  "cors": "^2.8"
}
```

## Key Decisions
- **No frontend framework** — vanilla JS keeps bundle tiny for mobile
- **SQLite** — zero config, perfect for 2-user scale; swap to Postgres later if needed
- **Socket.io** — handles WebSocket + long-polling fallback for spotty mobile networks
- **Soft deletes** — `is_deleted` / `is_recalled` flags keep data in DB per Feature 5
- **Page Visibility API** — pauses sync when user switches apps per Feature 8
