# Velora Flight Assistant — Node.js Backend

Secure Amadeus API proxy for the Velora AI Flight Assistant.  
Your API credentials never reach the browser — everything is handled server-side.

---

## Folder Structure

```
velora-AI Flight Assistant/
├── server.js           ← Express server (all Amadeus proxy routes)
├── package.json
├── .env                ← Your credentials (never commit this)
├── .gitignore
└── public/
    └── velora_Flight.html   ← Velora UI (calls /api/* instead of Amadeus directly)
```

---

## Setup

### 1. Get Amadeus API keys
1. Go to https://developers.amadeus.com
2. Create a free account
3. Create a new app → copy **Client ID** and **Client Secret**
4. Test environment is free and has real flight data

### 2. Configure credentials
Edit `.env`:
```
AMADEUS_CLIENT_ID=paste_your_client_id
AMADEUS_CLIENT_SECRET=paste_your_client_secret
AMADEUS_ENV=test
PORT=3000
```

### 3. Install and run
```bash
npm install
npm start
```

Open http://localhost:3000 — Velora loads and searches live flights.

For auto-reload during development:
```bash
npm run dev
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/flights` | Flight Offers Search |
| GET | `/api/airports` | Airport / City name → IATA lookup |
| POST | `/api/flights/pricing` | Confirm price before booking |
| GET | `/api/health` | Health check + token test |

### Example calls

```bash
# Health check (also tests your credentials)
curl http://localhost:3000/api/health

# Search flights
curl "http://localhost:3000/api/flights?originLocationCode=DEL&destinationLocationCode=BOM&departureDate=2026-04-15&adults=1&travelClass=ECONOMY&nonStop=true&currencyCode=INR"

# Airport search
curl "http://localhost:3000/api/airports?keyword=Mumbai"
```

---

## Switch to Production (Live Fares)

1. Apply for Amadeus production access at developers.amadeus.com
2. Once approved, update `.env`:
```
AMADEUS_ENV=prod
AMADEUS_CLIENT_ID=your_prod_client_id
AMADEUS_CLIENT_SECRET=your_prod_client_secret
```

---

## Deploy to Railway (free hosting)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set your `.env` variables in the Railway dashboard under Variables.

## Deploy to Render (free hosting)

1. Push this folder to a GitHub repo
2. Go to https://render.com → New Web Service
3. Connect your repo
4. Set Build Command: `npm install`
5. Set Start Command: `npm start`
6. Add environment variables from your `.env`

---

## Security Notes

- `.env` is in `.gitignore` — never commit it
- The browser HTML has **no** Amadeus credentials — only calls `/api/*`
- Token caching is built-in: one token per ~30 minutes, not per search
- CORS is configurable via `FRONTEND_ORIGIN` in `.env`
