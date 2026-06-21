// routes/auth.js — MySQL version
const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, queryOne, run } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

function makeToken(user) {
  return jwt.sign({ userId: user.id, id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function safeUser(u) {
  if (!u) return null;
  const { password, ...s } = u;
  return s;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, first_name, last_name, city, country, mobile } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'username, email and password are required' });

    const exists = await queryOne('SELECT id FROM users WHERE email=? OR username=?', [email, username]);
    if (exists) return res.status(409).json({ error: 'Email or username already taken' });

    const hashed = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await run(
      `INSERT INTO users (id,username,email,password,first_name,last_name,city,country,mobile,bio,rating)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, username, email, hashed, first_name||'', last_name||'', city||'', country||'', mobile||'', '', 0]
    );
    const user = await queryOne('SELECT * FROM users WHERE id=?', [id]);
    res.status(201).json({ token: makeToken(user), user: safeUser(user) });
  } catch(e) {
    console.error('Register error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await queryOne('SELECT * FROM users WHERE email=?', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: makeToken(user), user: safeUser(user) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/facebook
router.post('/facebook', async (req, res) => {
  try {
    const { user_id, name, email } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    let user = await queryOne('SELECT * FROM users WHERE fb_id=?', [user_id]);
    if (!user) {
      const id = uuidv4();
      await run(
        `INSERT INTO users (id,username,email,password,first_name,last_name,fb_id,bio,rating)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, `fb_${user_id}`, email||'', '', (name||'').split(' ')[0], (name||'').split(' ').slice(1).join(' '), user_id, '', 0]
      );
      user = await queryOne('SELECT * FROM users WHERE id=?', [id]);
    }
    res.json({ token: makeToken(user), user: safeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { google_id, email, name } = req.body;
    if (!google_id) return res.status(400).json({ error: 'google_id required' });
    let user = await queryOne('SELECT * FROM users WHERE google_id=?', [google_id]);
    if (!user) {
      const id = uuidv4();
      await run(
        `INSERT INTO users (id,username,email,password,first_name,last_name,google_id,bio,rating)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, `g_${google_id.slice(0,10)}`, email||'', '', (name||'').split(' ')[0], (name||'').split(' ').slice(1).join(' '), google_id, '', 0]
      );
      user = await queryOne('SELECT * FROM users WHERE id=?', [id]);
    }
    res.json({ token: makeToken(user), user: safeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/logout', (req, res) => res.json({ success: true }));

module.exports = router;
