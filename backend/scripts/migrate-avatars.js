// One-time migration: resize existing user avatars to 128×128 WebP
// Usage: node backend/scripts/migrate-avatars.js
'use strict';

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '../webchat.db');
const db = new Database(dbPath);
const uploadsDir = path.join(__dirname, '../uploads');

async function main() {
  const users = db.prepare(`SELECT id, avatar_url FROM users WHERE avatar_url IS NOT NULL`).all();

  if (users.length === 0) {
    console.log('No users with avatars found. Nothing to migrate.');
    return;
  }

  console.log(`Found ${users.length} user(s) with avatars.`);

  for (const user of users) {
    const filename = path.basename(user.avatar_url);

    // Skip already-migrated files
    if (filename.startsWith('avatar-') && filename.endsWith('.webp')) {
      console.log(`  [skip] user ${user.id}: ${filename} (already migrated)`);
      continue;
    }

    const srcPath = path.join(uploadsDir, filename);
    if (!fs.existsSync(srcPath)) {
      console.log(`  [skip] user ${user.id}: ${filename} (file not found on disk)`);
      continue;
    }

    const newFilename = `avatar-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`;
    const outPath = path.join(uploadsDir, newFilename);

    try {
      await sharp(srcPath)
        .resize(128, 128, { fit: 'cover', position: 'centre' })
        .webp({ quality: 80 })
        .toFile(outPath);

      const newUrl = `/uploads/${newFilename}`;
      db.prepare(`UPDATE users SET avatar_url = ? WHERE id = ?`).run(newUrl, user.id);
      console.log(`  [ok]   user ${user.id}: ${filename} → ${newFilename}`);
    } catch (err) {
      console.error(`  [err]  user ${user.id}: ${filename} — ${err.message}`);
    }
  }

  console.log('\nMigration complete.');
  console.log('Old original files remain in backend/uploads/ — safe to delete manually once confirmed.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
