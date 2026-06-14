# Kleegr Voice Comments

A mic button for **GoHighLevel internal comments**. The user records a voice note
inside a conversation; it's uploaded and posted as an `InternalComment` (the
yellow note in the conversation feed) with the audio attached.

Standalone Next.js app on Vercel — **no dependency on the WhatsApp droplet**.
Every push auto-deploys.

## How it works

```
GHL custom JS (mic + MediaRecorder)
      │  POST audio (multipart)
      ▼
Vercel: POST /api/internal-comment
      │  1. upload audio → GHL media library
      │  2. POST /conversations/messages  { type: "InternalComment", attachments:[url] }
      ▼
GHL conversation feed shows the voice note as an internal comment
```

The browser never sees the GHL token. Auth is a server-side Private Integration
Token (PIT).

## Setup (one time)

### 1. Generate a GHL Private Integration Token
In the pilot subaccount (`qfbPEd8130ccGKpJuL8j`):
Settings → **Private Integrations** → Create. Grant scopes:
- `conversations/message.write`
- `conversations.readonly`  (to resolve contact from conversation)
- `medias.write`

Copy the token (starts with `pit-`).

### 2. Connect this repo to Vercel
- vercel.com → Add New → Project → import `kleegr/Kleegr-voice-comments`
- Framework preset: **Next.js** (auto-detected)
- Add an Environment Variable:
  - `GHL_PIT` = the token from step 1
- Deploy. You'll get a URL like `https://kleegr-voice-comments.vercel.app`.

Visit the URL — if you see the health page, the server is up.

### 3. Add the mic to GHL
- Edit `public/ghl-voice-comment.js`: set `ENDPOINT` to
  `https://YOUR-VERCEL-URL/api/internal-comment`.
- Paste the script into GHL → Settings → **Custom JS** (pilot subaccount only).
- Bump `VERSION` in the script whenever you change it (GHL caches custom JS hard).

## Testing
1. Open a conversation in the pilot subaccount.
2. Click **Voice note**, speak, click **Stop**.
3. The internal comment should appear with the audio.

### Known unknown
Whether GHL renders the audio attachment as an inline **player** vs a download
**link** isn't documented — verify on the live deploy. If it shows a link, the
next step is to inject a small `<audio>` player via the same custom JS.

## Files
- `app/api/internal-comment/route.ts` — the upload + post endpoint
- `lib/ghl.ts` — GHL API helpers (PIT auth)
- `public/ghl-voice-comment.js` — the GHL custom-JS mic widget
