# AB Smart Solution – Secure Contact Backend

Receives the website's enquiry form and emails it to your Gmail. Only one dependency (`nodemailer`); everything else uses Node's built-ins, so there is very little to attack or keep updated.

## Security features

- Origin allow-list (CORS) – only your website can call the API
- Strict input validation, length limits, control/bidi-character stripping, header-injection protection
- HTML-escaped emails; `Reply-To` is set to the visitor's email so you can answer directly
- Per-IP rate limits (5 per 10 min, 20 per day) and a global daily cap (150) to protect your Gmail quota
- Honeypot field + minimum-fill-time check against bots (bots get a fake "success", nothing is sent)
- 10 KB body limit, JSON only, request timeouts, security headers, no cache
- Secrets only in environment variables – never in code or Git
- Errors are generic to visitors; logs never contain passwords or message text
- Graceful shutdown, startup mail check, 27 automated tests

## 1. Choose how to send mail

| Option | Best when | Setup |
| --- | --- | --- |
| `MAIL_MODE=smtp` (default) | Host allows outbound SMTP port 465 (paid Render, VPS, etc.) | Gmail App Password (easy) |
| `MAIL_MODE=gmail-api` | Host blocks SMTP (**Render free tier does since Sept 2025**) | Google OAuth2 (more steps) |

### A) Gmail App Password (smtp)

1. Sign in to `absmartsolution2026@gmail.com` → Google Account → **Security** → turn on **2-Step Verification**.
2. Open **App passwords**, create one named "AB Smart Solution website", copy the 16 characters.
3. Put it in `GMAIL_APP_PASSWORD`. Never use your normal Gmail password.

### B) Gmail API (gmail-api)

1. Go to https://console.cloud.google.com → create a project → **APIs & Services → Library → Gmail API → Enable**.
2. **OAuth consent screen**: User type *External*, add your Gmail as a test user, add scope `https://www.googleapis.com/auth/gmail.send`. Then click **Publish app** (otherwise the refresh token expires after 7 days).
3. **Credentials → Create credentials → OAuth client ID → Web application**. Add redirect URI `https://developers.google.com/oauthplayground`. Copy the Client ID and Client Secret.
4. Open https://developers.google.com/oauthplayground → gear icon → tick **Use your own OAuth credentials** → paste ID and secret → in Step 1 enter the scope `https://www.googleapis.com/auth/gmail.send` → Authorize with your Gmail → **Exchange authorization code for tokens** → copy the **Refresh token**.
5. Set `MAIL_MODE=gmail-api`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

## 2. Test on your computer

```bash
cd backend
npm install
cp .env.example .env      # then edit .env with your values
npm test                  # runs the automated tests
npm run dev               # starts on http://localhost:3000
```

For local testing set `ALLOWED_ORIGINS=http://localhost:5500` (or wherever you serve the site) and open the site from that address.

## 3. Deploy

Use a **separate private GitHub repository** for this `backend` folder (do not put it inside the website repository).

**Render:** New → Web Service → connect the repo → Runtime *Node* → Build `npm install` → Start `npm start`. Add these Environment Variables: `ALLOWED_ORIGINS`, `GMAIL_USER`, `MAIL_MODE`, the Gmail secrets for your chosen mode, and `TRUST_PROXY=1`. Set the health check path to `/health`. For `smtp` mode you need a paid instance; for the free tier use `gmail-api`.

Optional: in Render → Settings → Custom Domains add `api.absmartsolution.com.np` and create the CNAME record Render shows you at your domain provider.

Check it works: open `https://YOUR-API-URL/health` – you should see `{"status":"ok"}`. In the logs look for `Mail connection verified`.

## 4. Connect the website

In `website/script.js` set:

```js
const API_URL = 'https://api.absmartsolution.com.np/api/contact';
```

(or your `onrender.com` address followed by `/api/contact`). Make sure the exact website address is in `ALLOWED_ORIGINS`, including `www` if you use it.

## Important notes

- If an App Password or token is ever exposed, revoke it in your Google Account and create a new one.
- Check Gmail's Spam folder the first time. Mark the first message "Not spam".
- Rate limits are stored in memory, so they reset when the server restarts. That is fine for a single small instance.
- Keep dependencies updated: run `npm audit` and `npm update` now and then.
