# Raikkikki Backend — MySQL Edition (Render + HostGator)

This backend stores all data in **your HostGator MySQL database** and runs for
free on **Render**. The web app and Android APK both connect to the same
public Render URL — no desktop required, works from anywhere.

---

## 1. Create the MySQL database on HostGator

In cPanel:
1. **MySQL Databases** → create database named `raikkikki`
2. Create a user `raikkikki_user` with a strong password
3. Add that user to the database with **ALL PRIVILEGES**
4. **Remote MySQL** → add host `%.render.com` (allows Render to connect)
5. Note down: database host, database name (will be prefixed like
   `youraccount_raikkikki`), username, password

The database tables are created automatically the first time the server
starts — you don't need to create any tables manually.

---

## 2. Push this code to GitHub

1. Create a new **private** GitHub repository (e.g. `raikkikki-backend`)
2. Upload all files in this folder to that repo (drag and drop on
   github.com works fine, or use git if you're comfortable with it)

---

## 3. Deploy on Render

1. Go to **render.com** and sign up (free, no credit card needed)
2. Click **New +** → **Web Service**
3. Connect your GitHub account and select the `raikkikki-backend` repo
4. Settings:
   - **Name:** raikkikki
   - **Region:** closest to you
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Scroll to **Environment Variables** and add each one from `.env.example`
   with your real HostGator MySQL values:
   - `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, `DB_PORT`
   - `JWT_SECRET` (any long random string)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
6. Click **Create Web Service**

Render will build and deploy — takes a few minutes. You'll get a URL like:
```
https://raikkikki.onrender.com
```

---

## 4. Update Google OAuth redirect URI

In Google Cloud Console → Credentials → your OAuth client → Authorized
redirect URIs, add:
```
https://raikkikki.onrender.com/auth/google/callback
```
(Use your actual Render URL.)

---

## 5. Point the web app and APK to your Render URL

**Web app** (`public/index.html`) — already configured to use the same
origin automatically, no changes needed once deployed.

**Android APK** — edit the config block near the top of `index.html` in
`raikkikki-apk/www/`:
```js
window.RAKKI_API_HOST = "raikkikki.onrender.com";
window.RAKKI_API_PORT = 443; // HTTPS
```
You'll also need to change `http://` to `https://` in the `API_BASE`
function and the WebSocket URL — ask Claude to make this change once you
have your Render URL.

Then `npx cap sync android` and rebuild the APK.

---

## Notes

- **Free tier sleeps after 15 min of inactivity** — first request after
  sleeping takes ~30 seconds to wake up. Fine for testing, consider a paid
  tier later if this matters for real users.
- **Demo data** seeds automatically on first run: 5 demo users (all
  password `demo123`), 5 demo parties in Singapore, sample chat messages.
- All passwords are hashed with bcrypt; never stored in plain text.
