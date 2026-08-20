# Bryves TV — Mux + Firebase + Render

## Files

- `server.js` — secure backend; keeps Mux credentials on Render.
- `public/index.html` — public viewer.
- `public/admin.html` — admin control panel.
- `package.json` — Node dependencies.
- `.gitignore` — prevents secrets from being committed.

## Render Environment Variables

Set these in Render:

```text
MUX_TOKEN_ID=your_mux_token_id
MUX_TOKEN_SECRET=your_mux_token_secret
FIREBASE_DATABASE_URL=https://bryvestv-default-rtdb.firebaseio.com
ADMIN_PASSWORD=your_private_admin_password
```

Do NOT commit `.env` or Mux secrets to GitHub.

## Render

Build Command:
```text
npm install
```

Start Command:
```text
npm start
```

After deployment:

- Viewer: `/`
- Admin: `/admin.html`
- Health: `/health`

## How it works

1. Open `/admin.html`.
2. Login with `ADMIN_PASSWORD`.
3. Click `CREATE NEW LIVE STREAM`.
4. The Render backend calls Mux and automatically gets the Stream Key and Playback ID.
5. Copy the RTMPS server and Stream Key into OBS/your streaming app.
6. Start streaming.
7. Click `CHECK STATUS`.
8. When Mux reports `active`, the public viewer automatically starts showing the live stream.

## Firebase

The app stores channel/live metadata under:

```text
/config
```

For testing, your current public Firebase rules can work. Before production, secure the database and never store Mux API credentials in Firebase.
