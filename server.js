require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const http    = require('http');
const { WebSocketServer } = require('ws');

const db = require('./db');
const { authMiddleware, verifyToken } = require('./middleware/auth');

const authRoutes   = require('./routes/auth');
const googleAuth   = require('./routes/auth-google');
const partyRoutes  = require('./routes/parties');
const { messagesRouter, friendsRouter } = require('./routes/social');

const app  = express();
app.set('trust proxy', 1); // Render sits behind a proxy — needed for req.protocol to report https correctly
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──
app.use('/api/auth',     authRoutes);
app.use('/auth',         googleAuth);
app.use('/api/parties',  partyRoutes);
app.use('/api/messages', messagesRouter);
app.use('/api/friends',  friendsRouter);

// ── Get all users (for people discovery) ──
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const users = await db.query(
      'SELECT id,username,email,first_name,last_name,city,country,avatar,bio,rating FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 100',
      [req.userId]
    );
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Search ──
app.get('/api/search', authMiddleware, async (req, res) => {
  try {
    const q = `%${(req.query.q || '').toLowerCase()}%`;
    if (!req.query.q) return res.json({ users: [], parties: [] });
    const users = await db.query(
      `SELECT * FROM users WHERE LOWER(username) LIKE ? OR LOWER(CONCAT(first_name,' ',last_name)) LIKE ?`,
      [q, q]
    );
    const parties = await db.query(
      `SELECT * FROM parties WHERE LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(address) LIKE ?`,
      [q, q, q]
    );
    res.json({
      users: users.map(u => { const { password, ...s } = u; return s; }),
      parties
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Push token (stub) ──
app.post('/api/notifications/token', authMiddleware, async (req, res) => {
  try {
    const { fcm_token } = req.body;
    if (fcm_token) await db.run('UPDATE users SET fcm_token=? WHERE id=?', [fcm_token, req.userId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Health check ──
app.get('/api/health', async (req, res) => {
  try {
    const users   = (await db.queryOne('SELECT COUNT(*) c FROM users')).c;
    const parties = (await db.queryOne('SELECT COUNT(*) c FROM parties')).c;
    const msgs    = (await db.queryOne('SELECT COUNT(*) c FROM messages')).c;
    res.json({ status: 'ok', users, parties, messages: msgs, uptime: process.uptime() });
  } catch(e) { res.status(500).json({ status: 'error', error: e.message }); }
});

// ── Catch-all → serve frontend ──
app.get('/{*path}', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (require('fs').existsSync(indexPath)) res.sendFile(indexPath);
  else res.json({ error: 'Frontend not found. Place index.html in /public/' });
});

// ── WebSocket server for real-time chat ──
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/ws' });
const clients = new Map();

wss.on('connection', (ws, req) => {
  const url   = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  let userId;
  try { userId = verifyToken(token).userId || verifyToken(token).id; }
  catch(e) { ws.close(1008, 'Unauthorized'); return; }

  clients.set(userId, ws);
  console.log(`WS connected: ${userId} (${clients.size} total)`);

  ws.on('message', raw => {
    try { const msg = JSON.parse(raw); if (msg.type === 'ping') ws.send(JSON.stringify({ type:'pong' })); }
    catch(e) {}
  });
  ws.on('close', () => { clients.delete(userId); console.log(`WS disconnected: ${userId}`); });
  ws.on('error', () => clients.delete(userId));
});

function pushToUser(userId, payload) {
  const client = clients.get(String(userId));
  if (client && client.readyState === 1) client.send(JSON.stringify(payload));
}
app.set('pushToUser', pushToUser);

// ── Start ──
async function start() {
  await db.init();
  server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║   🎉  raikkikki backend running        ║
║   MySQL edition (HostGator + Render)   ║
║   port: ${PORT}                            ║
╚════════════════════════════════════════╝
  Demo login: jimmyj@gmail.com / demo123
    `);
  });
}
start().catch(e => { console.error('Failed to start:', e); process.exit(1); });

module.exports = app;
