// routes/auth-google.js — MySQL version
const express = require('express');
const router  = express.Router();
const https   = require('https');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { queryOne, run } = require('../db');

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '155764665177-j56rm5hisb0p4vocp49c1s4g26d236b9.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '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';
const JWT_SECRET           = process.env.JWT_SECRET           || 'raikkikki-secret-change-in-production';

router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state; // 'app' if request came from the Android APK
  if (!code) return res.redirect('/?error=no_code');

  try {
    const host = req.get('host');
    const origin = host.includes('localhost') ? `http://${host}` : `https://${host}`;
    const tokenData = await exchangeCode(code, origin);

    if (tokenData.error) {
      console.error('Google token error:', tokenData.error, tokenData.error_description);
      return res.redirect(buildRedirect(state, { error: 'google_failed', reason: tokenData.error_description||tokenData.error }));
    }

    const userInfo = await getGoogleUser(tokenData.access_token);
    const user = await findOrCreateGoogleUser(userInfo);

    const token = jwt.sign(
      { userId: user.id, id: user.id, email: user.email, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    const userPayload = JSON.stringify({
      id: user.id, email: user.email, username: user.username,
      name: user.name || user.first_name, avatar: user.avatar || ''
    });

    res.redirect(buildRedirect(state, { token, user: userPayload }));

  } catch (err) {
    console.error('Google OAuth error:', err.message);
    res.redirect(buildRedirect(state, { error: 'google_failed', reason: err.message }));
  }
});

// Build the final redirect — custom scheme for the Android app, normal path for web
function buildRedirect(state, params) {
  const qs = Object.entries(params)
    .map(([k,v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  if (state === 'app') {
    return `com.raikkikki.app://oauth-callback?${qs}`;
  }
  return `/?${qs}`;
}

function exchangeCode(code, origin) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${origin}/auth/google/callback`,
      grant_type:    'authorization_code'
    });
    const options = {
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    };
    const reqq = https.request(options, resp => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Token parse error')); } });
    });
    reqq.on('error', reject);
    reqq.write(body);
    reqq.end();
  });
}

function getGoogleUser(accessToken) {
  return new Promise((resolve, reject) => {
    https.get({ hostname:'www.googleapis.com', path:'/oauth2/v2/userinfo', headers:{ Authorization:`Bearer ${accessToken}` } }, resp => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('User info parse error')); } });
    }).on('error', reject);
  });
}

async function findOrCreateGoogleUser(googleUser) {
  const email    = googleUser.email;
  const name     = googleUser.name || email.split('@')[0];
  const avatar   = googleUser.picture || '';
  const username = email.split('@')[0].replace(/[^a-z0-9]/gi,'').toLowerCase();

  let user = await queryOne('SELECT * FROM users WHERE email=?', [email]);
  if (user) {
    await run('UPDATE users SET avatar=?, google_id=? WHERE id=?', [avatar, googleUser.id, user.id]);
    return await queryOne('SELECT * FROM users WHERE id=?', [user.id]);
  }
  const id = uuidv4();
  await run(
    `INSERT INTO users (id,username,email,password,first_name,last_name,avatar,google_id,name,bio,rating)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, username, email, 'GOOGLE_OAUTH_NO_PASSWORD', (name||'').split(' ')[0], (name||'').split(' ').slice(1).join(' '),
     avatar, googleUser.id, name, '', 0]
  );
  return await queryOne('SELECT * FROM users WHERE id=?', [id]);
}

module.exports = router;
