// db.js — MySQL connection + auto-create tables + seed demo data
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port:     process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit:    10,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

// ── Schema ──────────────────────────────────────────────
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           VARCHAR(36) PRIMARY KEY,
  username     VARCHAR(50) UNIQUE NOT NULL,
  email        VARCHAR(100) UNIQUE NOT NULL,
  password     VARCHAR(255) NOT NULL,
  first_name   VARCHAR(50) DEFAULT '',
  last_name    VARCHAR(50) DEFAULT '',
  city         VARCHAR(100) DEFAULT '',
  country      VARCHAR(100) DEFAULT '',
  mobile       VARCHAR(30) DEFAULT '',
  avatar       TEXT DEFAULT NULL,
  bio          TEXT DEFAULT '',
  rating       FLOAT DEFAULT 0,
  fcm_token    TEXT DEFAULT NULL,
  fb_id        VARCHAR(50) DEFAULT NULL,
  google_id    VARCHAR(50) DEFAULT NULL,
  name         VARCHAR(100) DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parties (
  id           VARCHAR(36) PRIMARY KEY,
  host_id      VARCHAR(36) NOT NULL,
  title        VARCHAR(200) NOT NULL,
  description  TEXT DEFAULT '',
  type         VARCHAR(30) DEFAULT 'private',
  address      VARCHAR(300) DEFAULT '',
  latitude     DOUBLE DEFAULT NULL,
  longitude    DOUBLE DEFAULT NULL,
  start_time   DATETIME NOT NULL,
  end_time     DATETIME DEFAULT NULL,
  max_guests   INT DEFAULT NULL,
  invitees     VARCHAR(20) DEFAULT 'mix',
  byo          TINYINT(1) DEFAULT 0,
  is_private   TINYINT(1) DEFAULT 0,
  photos       JSON DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS party_attendees (
  id         VARCHAR(36) PRIMARY KEY,
  party_id   VARCHAR(36) NOT NULL,
  user_id    VARCHAR(36) NOT NULL,
  status     VARCHAR(20) DEFAULT 'attending',
  joined_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_attend (party_id, user_id),
  FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id)   ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id           VARCHAR(36) PRIMARY KEY,
  sender_id    VARCHAR(36) NOT NULL,
  recipient_id VARCHAR(36) NOT NULL,
  body         TEXT NOT NULL,
  is_read      TINYINT(1) DEFAULT 0,
  sent_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id)    REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friendships (
  id         VARCHAR(36) PRIMARY KEY,
  user_a     VARCHAR(36) NOT NULL,
  user_b     VARCHAR(36) NOT NULL,
  status     VARCHAR(20) DEFAULT 'accepted',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_friend (user_a, user_b),
  FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id          VARCHAR(36) PRIMARY KEY,
  from_id     VARCHAR(36) NOT NULL,
  to_id       VARCHAR(36) NOT NULL,
  status      VARCHAR(20) DEFAULT 'pending',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_req (from_id, to_id),
  FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_id)   REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id         VARCHAR(36) PRIMARY KEY,
  user_id    VARCHAR(36) NOT NULL,
  type       VARCHAR(50) NOT NULL,
  message    TEXT NOT NULL,
  is_read    TINYINT(1) DEFAULT 0,
  data       JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// ── Helper query functions ──────────────────────────────
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

// ── Init: create tables + seed ──────────────────────────
async function init() {
  console.log('🔌 Connecting to MySQL...');
  try {
    // Create tables (split on double newline between statements)
    const statements = SCHEMA.split(/;\s*\n/).filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) await pool.execute(stmt.trim());
    }
    console.log('✅ MySQL tables ready');
    await seedDemo();
  } catch(e) {
    console.error('❌ MySQL init error:', e.message);
    throw e;
  }
}

// ── Demo data seeding ───────────────────────────────────
async function seedDemo() {
  const { v4: uuidv4 } = require('uuid');
  const bcrypt = require('bcryptjs');

  const existing = await queryOne('SELECT id FROM users WHERE email = ?', ['jimmyj@gmail.com']);
  if (existing) { console.log('ℹ️  Demo data already seeded'); return; }

  console.log('🌱 Seeding demo data...');

  const hash = await bcrypt.hash('demo123', 10);
  const now  = new Date().toISOString().slice(0,19).replace('T',' ');

  // Demo users
  const users = [
    { id: uuidv4(), username:'jimmyj',   email:'jimmyj@gmail.com',   password:hash, first_name:'Jimmy', last_name:'J',     city:'Singapore', country:'Singapore', avatar:null, bio:'Party animal 🎉', rating:4.8 },
    { id: uuidv4(), username:'linda_sg', email:'linda@example.com',  password:hash, first_name:'Linda', last_name:'Tan',   city:'Singapore', country:'Singapore', avatar:null, bio:'Love rooftop bars', rating:4.9 },
    { id: uuidv4(), username:'donna_sg', email:'donna@example.com',  password:hash, first_name:'Donna', last_name:'Lee',   city:'Singapore', country:'Singapore', avatar:null, bio:'Coffee addict ☕', rating:4.7 },
    { id: uuidv4(), username:'henry_sg', email:'henry@example.com',  password:hash, first_name:'Henry', last_name:'Wong',  city:'Singapore', country:'Singapore', avatar:null, bio:'Craft beer lover', rating:4.6 },
    { id: uuidv4(), username:'marco_sg', email:'marco@example.com',  password:hash, first_name:'Marco', last_name:'Rossi', city:'Singapore', country:'Singapore', avatar:null, bio:'Always up for fun', rating:4.9 },
  ];

  for (const u of users) {
    await run(
      `INSERT IGNORE INTO users (id,username,email,password,first_name,last_name,city,country,avatar,bio,rating,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [u.id,u.username,u.email,u.password,u.first_name,u.last_name,u.city,u.country,u.avatar,u.bio,u.rating,now]
    );
  }

  const [jimmy, linda, donna, henry, marco] = users;
  const nextFri = new Date(); nextFri.setDate(nextFri.getDate() + (5 - nextFri.getDay() + 7) % 7 || 7);
  const fri = nextFri.toISOString().slice(0,19).replace('T',' ');
  const sat = new Date(nextFri.getTime() + 86400000).toISOString().slice(0,19).replace('T',' ');

  // Demo parties — Singapore locations
  const parties = [
    { id:uuidv4(), host_id:linda.id,  title:'Rooftop Sundowners',     description:'Sunset drinks at Loof! Best views in the city.',       type:'bar',       address:'Odeon Towers Rooftop, 331 North Bridge Rd, Singapore', latitude:1.2966,  longitude:103.8520, start_time:fri, max_guests:20,  is_private:0 },
    { id:uuidv4(), host_id:jimmy.id,  title:'Friday Night Karaoke',   description:'Sing your heart out at Teo Heng! All welcome.',        type:'private',   address:'Teo Heng KTV, Jurong Point, Singapore',               latitude:1.3404,  longitude:103.7057, start_time:fri, max_guests:10,  is_private:0 },
    { id:uuidv4(), host_id:donna.id,  title:'Saturday Brunch Crew',   description:'Lazy brunch at PS.Cafe. BYO good vibes ☕',            type:'community', address:'PS.Cafe, 28B Harding Rd, Singapore',                  latitude:1.3042,  longitude:103.8194, start_time:sat, max_guests:8,   is_private:0 },
    { id:uuidv4(), host_id:henry.id,  title:'Craft Beer Tasting',     description:'New taps at Smith Street Taps. Nerds welcome 🍺',     type:'bar',       address:'Smith Street Taps, Chinatown Complex, Singapore',     latitude:1.2817,  longitude:103.8442, start_time:sat, max_guests:15,  is_private:0 },
    { id:uuidv4(), host_id:marco.id,  title:'Night Cycling @ ECP',    description:'Easy 20km ride followed by supper. Bikes provided!',  type:'community', address:'East Coast Park, Singapore',                          latitude:1.3008,  longitude:103.9124, start_time:sat, max_guests:30,  is_private:0 },
  ];

  for (const p of parties) {
    await run(
      `INSERT IGNORE INTO parties (id,host_id,title,description,type,address,latitude,longitude,start_time,max_guests,is_private,photos,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.id,p.host_id,p.title,p.description,p.type,p.address,p.latitude,p.longitude,p.start_time,p.max_guests,p.is_private,JSON.stringify([]),now]
    );
    // Host auto-attends
    await run('INSERT IGNORE INTO party_attendees (id,party_id,user_id,status) VALUES (?,?,?,?)',
      [uuidv4(), p.id, p.host_id, 'attending']);
  }

  // Friendships
  const friendPairs = [[jimmy.id,linda.id],[jimmy.id,donna.id],[jimmy.id,henry.id],[linda.id,marco.id]];
  for (const [a,b] of friendPairs) {
    await run('INSERT IGNORE INTO friendships (id,user_a,user_b) VALUES (?,?,?)', [uuidv4(),a,b]);
    await run('INSERT IGNORE INTO friendships (id,user_a,user_b) VALUES (?,?,?)', [uuidv4(),b,a]);
  }

  // Demo messages
  const msgs = [
    [jimmy.id, linda.id, 'Hey! Wanna come to my party this Friday? 🎉'],
    [linda.id, jimmy.id, 'YES!! What time does it start?'],
    [jimmy.id, linda.id, '9pm at Neon Bar. Should be epic!'],
    [linda.id, jimmy.id, "I'll be there! 🙌"],
    [donna.id, jimmy.id, 'Are you going to the karaoke night?'],
    [jimmy.id, donna.id, 'Of course! See you there 🎤'],
    [henry.id, jimmy.id, 'Loved the last party bro! When\'s the next one?'],
  ];
  for (const [s,r,body] of msgs) {
    await run('INSERT INTO messages (id,sender_id,recipient_id,body,is_read) VALUES (?,?,?,?,?)',
      [uuidv4(),s,r,body,1]);
  }

  console.log('✅ Demo data seeded — login: jimmyj@gmail.com / demo123');
}

module.exports = { pool, query, queryOne, run, init };
