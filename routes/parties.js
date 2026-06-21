// routes/parties.js — MySQL version
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, queryOne, run } = require('../db');
const { authMiddleware } = require('../middleware/auth');

function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function safeUser(u) {
  if (!u) return null;
  const { password, ...s } = u;
  return s;
}

async function enrichParty(party, userId) {
  const host = await queryOne('SELECT * FROM users WHERE id=?', [party.host_id]);
  const attendees = await query('SELECT * FROM party_attendees WHERE party_id=?', [party.id]);
  const isAttending = attendees.some(a => a.user_id === userId);
  let photos = [];
  try { photos = typeof party.photos === 'string' ? JSON.parse(party.photos) : (party.photos || []); } catch(e) {}
  return { ...party, photos, host: safeUser(host), attendee_count: attendees.length, is_attending: isAttending };
}

// GET /api/parties
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { type, lat, lng, radius = 50 } = req.query;
    let parties = await query('SELECT * FROM parties ORDER BY start_time ASC');

    if (type) parties = parties.filter(p => p.type === type);

    if (lat && lng) {
      const userLat = parseFloat(lat), userLng = parseFloat(lng);
      const withDist = parties
        .filter(p => p.latitude != null && p.longitude != null)
        .map(p => ({ ...p, distance_miles: distanceMiles(userLat, userLng, p.latitude, p.longitude) }))
        .filter(p => p.distance_miles <= parseFloat(radius))
        .sort((a,b) => a.distance_miles - b.distance_miles);
      const virtual = parties.filter(p => p.type === 'virtual' && !withDist.find(w => w.id === p.id));
      parties = [...withDist, ...virtual];
    }

    const enriched = await Promise.all(parties.map(p => enrichParty(p, req.userId)));
    res.json(enriched);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/parties/mine
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const hosted = await query('SELECT * FROM parties WHERE host_id=?', [req.userId]);
    const attendedRows = await query('SELECT party_id FROM party_attendees WHERE user_id=?', [req.userId]);
    const attendedIds = attendedRows.map(r => r.party_id);
    let attended = [];
    if (attendedIds.length) {
      const placeholders = attendedIds.map(()=>'?').join(',');
      attended = await query(`SELECT * FROM parties WHERE id IN (${placeholders}) AND host_id != ?`, [...attendedIds, req.userId]);
    }
    res.json({
      hosting:   await Promise.all(hosted.map(p => enrichParty(p, req.userId))),
      attending: await Promise.all(attended.map(p => enrichParty(p, req.userId)))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/parties/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const party = await queryOne('SELECT * FROM parties WHERE id=?', [req.params.id]);
    if (!party) return res.status(404).json({ error: 'Party not found' });
    res.json(await enrichParty(party, req.userId));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/parties
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, description, type, address, latitude, longitude, start_time, end_time, max_guests, invitees, byo, is_private, photos } = req.body;
    if (!title || !start_time) return res.status(400).json({ error: 'title and start_time required' });

    const id = uuidv4();
    await run(
      `INSERT INTO parties (id,host_id,title,description,type,address,latitude,longitude,start_time,end_time,max_guests,invitees,byo,is_private,photos)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, req.userId, title, description||'', type||'private', address||'',
       latitude?parseFloat(latitude):null, longitude?parseFloat(longitude):null,
       start_time, end_time||null, max_guests?parseInt(max_guests):null,
       invitees||'mix', byo?1:0, is_private?1:0, JSON.stringify(photos||[])]
    );
    await run('INSERT INTO party_attendees (id,party_id,user_id,status) VALUES (?,?,?,?)',
      [uuidv4(), id, req.userId, 'attending']);

    const party = await queryOne('SELECT * FROM parties WHERE id=?', [id]);
    res.status(201).json(await enrichParty(party, req.userId));
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// PATCH /api/parties/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const party = await queryOne('SELECT * FROM parties WHERE id=?', [req.params.id]);
    if (!party) return res.status(404).json({ error: 'Party not found' });
    if (party.host_id !== req.userId) return res.status(403).json({ error: 'Only the host can edit this party' });

    const allowed = ['title','description','address','latitude','longitude','start_time','end_time','max_guests','invitees','byo','is_private','photos'];
    const sets = [], vals = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        sets.push(`${k}=?`);
        vals.push(k === 'photos' ? JSON.stringify(req.body[k]) : req.body[k]);
      }
    }
    if (sets.length) {
      vals.push(req.params.id);
      await run(`UPDATE parties SET ${sets.join(', ')} WHERE id=?`, vals);
    }
    const updated = await queryOne('SELECT * FROM parties WHERE id=?', [req.params.id]);
    res.json(await enrichParty(updated, req.userId));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/parties/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const party = await queryOne('SELECT * FROM parties WHERE id=?', [req.params.id]);
    if (!party) return res.status(404).json({ error: 'Party not found' });
    if (party.host_id !== req.userId) return res.status(403).json({ error: 'Only the host can delete this party' });
    await run('DELETE FROM parties WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/parties/:id/join
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const party = await queryOne('SELECT * FROM parties WHERE id=?', [req.params.id]);
    if (!party) return res.status(404).json({ error: 'Party not found' });
    const existing = await queryOne('SELECT * FROM party_attendees WHERE party_id=? AND user_id=?', [req.params.id, req.userId]);
    if (existing) return res.status(409).json({ error: 'Already attending' });
    await run('INSERT INTO party_attendees (id,party_id,user_id,status) VALUES (?,?,?,?)',
      [uuidv4(), req.params.id, req.userId, 'attending']);
    res.json({ success: true, message: 'You joined the party!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/parties/:id/leave
router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    await run('DELETE FROM party_attendees WHERE party_id=? AND user_id=?', [req.params.id, req.userId]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/parties/:id/attendees
router.get('/:id/attendees', authMiddleware, async (req, res) => {
  try {
    const attendees = await query('SELECT * FROM party_attendees WHERE party_id=?', [req.params.id]);
    const users = [];
    for (const a of attendees) {
      const u = await queryOne('SELECT * FROM users WHERE id=?', [a.user_id]);
      if (u) users.push({ ...safeUser(u), joined_at: a.joined_at });
    }
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
