// routes/social.js — messages + friends, MySQL version
const express = require('express');
const messagesRouter = express.Router();
const friendsRouter  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, queryOne, run } = require('../db');
const { authMiddleware } = require('../middleware/auth');

function safeUser(u) {
  if (!u) return null;
  const { password, ...s } = u;
  return s;
}

// ════════════════════════════════════
// MESSAGES
// ════════════════════════════════════

// GET /api/messages/conversations — list of conversation partners with last message
messagesRouter.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM messages WHERE sender_id=? OR recipient_id=? ORDER BY sent_at DESC`,
      [req.userId, req.userId]
    );
    const seen = new Map();
    for (const m of rows) {
      const otherId = m.sender_id === req.userId ? m.recipient_id : m.sender_id;
      if (!seen.has(otherId)) {
        seen.set(otherId, { last: m, unread: 0 });
      }
      if (m.recipient_id === req.userId && !m.is_read) {
        seen.get(otherId).unread++;
      }
    }
    const conversations = [];
    for (const [otherId, info] of seen) {
      const user = await queryOne('SELECT * FROM users WHERE id=?', [otherId]);
      if (!user) continue;
      conversations.push({
        user: safeUser(user),
        last_message: info.last.body,
        last_sent_at: info.last.sent_at,
        unread_count: info.unread
      });
    }
    conversations.sort((a,b) => new Date(b.last_sent_at) - new Date(a.last_sent_at));
    res.json(conversations);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/messages/:userId — full thread with one user
messagesRouter.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const otherId = req.params.userId;
    const msgs = await query(
      `SELECT * FROM messages
       WHERE (sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)
       ORDER BY sent_at ASC`,
      [req.userId, otherId, otherId, req.userId]
    );
    // Mark messages from the other user as read
    await run('UPDATE messages SET is_read=1 WHERE sender_id=? AND recipient_id=?', [otherId, req.userId]);
    res.json(msgs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/messages — send a message
messagesRouter.post('/', authMiddleware, async (req, res) => {
  try {
    const { recipient_id, body } = req.body;
    if (!recipient_id || !body) return res.status(400).json({ error: 'recipient_id and body required' });

    const recipient = await queryOne('SELECT id FROM users WHERE id=?', [recipient_id]);
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const id = uuidv4();
    await run('INSERT INTO messages (id,sender_id,recipient_id,body,is_read) VALUES (?,?,?,?,?)',
      [id, req.userId, recipient_id, body, 0]);
    const message = await queryOne('SELECT * FROM messages WHERE id=?', [id]);

    // Real-time push if recipient is connected via WebSocket
    const pushToUser = req.app.get('pushToUser');
    if (pushToUser) {
      const sender = await queryOne('SELECT * FROM users WHERE id=?', [req.userId]);
      pushToUser(recipient_id, {
        type: 'message',
        data: { ...message, sender_name: sender ? (sender.first_name || sender.username) : 'Someone' }
      });
    }

    res.status(201).json(message);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════
// FRIENDS
// ════════════════════════════════════

// GET /api/friends — list of friends
friendsRouter.get('/', authMiddleware, async (req, res) => {
  try {
    const rows = await query('SELECT * FROM friendships WHERE user_a=?', [req.userId]);
    const friends = [];
    for (const r of rows) {
      const u = await queryOne('SELECT * FROM users WHERE id=?', [r.user_b]);
      if (u) friends.push(safeUser(u));
    }
    res.json(friends);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/friends/requests — pending requests received
friendsRouter.get('/requests', authMiddleware, async (req, res) => {
  try {
    const rows = await query(`SELECT * FROM friend_requests WHERE to_id=? AND status='pending'`, [req.userId]);
    const requests = [];
    for (const r of rows) {
      const u = await queryOne('SELECT * FROM users WHERE id=?', [r.from_id]);
      if (u) requests.push({ id: r.id, from: safeUser(u), created_at: r.created_at });
    }
    res.json(requests);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/friends/requests — send a friend request
friendsRouter.post('/requests', authMiddleware, async (req, res) => {
  try {
    const { to_id } = req.body;
    if (!to_id) return res.status(400).json({ error: 'to_id required' });
    if (to_id === req.userId) return res.status(400).json({ error: "Can't friend yourself" });

    const already = await queryOne('SELECT id FROM friendships WHERE user_a=? AND user_b=?', [req.userId, to_id]);
    if (already) return res.status(409).json({ error: 'Already friends' });

    const existing = await queryOne(`SELECT id FROM friend_requests WHERE from_id=? AND to_id=? AND status='pending'`, [req.userId, to_id]);
    if (existing) return res.status(409).json({ error: 'Request already sent' });

    const id = uuidv4();
    await run('INSERT INTO friend_requests (id,from_id,to_id,status) VALUES (?,?,?,?)', [id, req.userId, to_id, 'pending']);
    res.status(201).json({ success: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/friends/requests/:id/accept
friendsRouter.post('/requests/:id/accept', authMiddleware, async (req, res) => {
  try {
    const reqRow = await queryOne('SELECT * FROM friend_requests WHERE id=?', [req.params.id]);
    if (!reqRow || reqRow.to_id !== req.userId) return res.status(404).json({ error: 'Request not found' });

    await run(`UPDATE friend_requests SET status='accepted' WHERE id=?`, [req.params.id]);
    await run('INSERT IGNORE INTO friendships (id,user_a,user_b) VALUES (?,?,?)', [uuidv4(), reqRow.from_id, reqRow.to_id]);
    await run('INSERT IGNORE INTO friendships (id,user_a,user_b) VALUES (?,?,?)', [uuidv4(), reqRow.to_id, reqRow.from_id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/friends/requests/:id/decline
friendsRouter.post('/requests/:id/decline', authMiddleware, async (req, res) => {
  try {
    await run(`UPDATE friend_requests SET status='declined' WHERE id=? AND to_id=?`, [req.params.id, req.userId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/friends/:userId — unfriend
friendsRouter.delete('/:userId', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM friendships WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)',
      [req.userId, req.params.userId, req.params.userId, req.userId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = { messagesRouter, friendsRouter };
