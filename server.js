'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  Velora Flight Assistant — Node.js / Express backend
//  Proxies all Amadeus API calls so credentials never reach the browser.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT 
|| 3000;

// ── Config ────────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.AMADEUS_CLIENT_ID;
const CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET;
const ENV           = process.env.AMADEUS_ENV || 'test';
const BASE_URL      = ENV === 'prod'
  ? 'https://api.amadeus.com'
  : 'https://test.api.amadeus.com';

// Validate credentials on startup
if (!CLIENT_ID || CLIENT_ID === 'your_client_id_here') {
  console.error('❌  AMADEUS_CLIENT_ID is not set in .env — server will start but API calls will fail.');
}
if (!CLIENT_SECRET || CLIENT_SECRET === 'your_client_secret_here') {
  console.error('❌  AMADEUS_CLIENT_SECRET is not set in .env — server will start but API calls will fail.');
}

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));
app.use(express.json());

// Serve velora_Flight.html as the root page
app.use(express.static(path.join(__dirname, 'public')));

// ── Token cache (reuse until 50s before expiry) ───────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

async function getAmadeusToken() {
  const now = Date.now();
  // Return cached token if still valid (with 50 s buffer)
  if (_tokenCache.token && now < _tokenCache.expiresAt - 50_000) {
    return _tokenCache.token;
  }

  const res = await fetch(`${BASE_URL}/v1/security/oauth2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=client_credentials&client_id=${encodeURIComponent(CLIENT_ID)}&client_secret=${encodeURIComponent(CLIENT_SECRET)}`
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Amadeus auth failed (${res.status}): ${err.error_description || err.error || 'unknown'}`);
  }

  const data = await res.json();
  _tokenCache = {
    token:     data.access_token,
    expiresAt: now + (data.expires_in || 1799) * 1000
  };

  console.log(`🔑  New Amadeus token obtained (expires in ${data.expires_in}s) [${ENV}]`);
  return _tokenCache.token;
}

// ── Generic Amadeus proxy helper ──────────────────────────────────────────────
async function amadeusGet(endpoint, queryParams) {
  const token  = await getAmadeusToken();
  const url    = `${BASE_URL}${endpoint}?${new URLSearchParams(queryParams)}`;
  const res    = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body   = await res.json();

  if (!res.ok) {
    const detail = body.errors?.[0]?.detail || body.errors?.[0]?.title || res.status;
    throw new Error(detail);
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 1 — Flight Offers Search
//  GET /api/flights?originLocationCode=DEL&destinationLocationCode=BOM&...
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/flights', async (req, res) => {
  try {
    // Required params
    const {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      adults = '1',
      travelClass = 'ECONOMY',
      nonStop = 'false',
      currencyCode = 'INR',
      max = '40',
      children,
      infants,
      returnDate
    } = req.query;

    if (!originLocationCode || !destinationLocationCode || !departureDate) {
      return res.status(400).json({
        error: 'Missing required params: originLocationCode, destinationLocationCode, departureDate'
      });
    }

    const params = {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      adults,
      travelClass,
      nonStop,
      currencyCode,
      max
    };
    if (children && children !== '0') params.children = children;
    if (infants  && infants  !== '0') params.infants  = infants;
    if (returnDate) params.returnDate = returnDate;

    console.log(`✈️  Flight search: ${originLocationCode}→${destinationLocationCode} on ${departureDate} [${travelClass}, nonStop=${nonStop}]`);

    const data = await amadeusGet('/v2/shopping/flight-offers', params);

    console.log(`   ↳ ${data.data?.length || 0} offers returned`);
    res.json(data);

  } catch (err) {
    console.error('❌  /api/flights error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 2 — Airport / City Search (for resolving typed city names → IATA)
//  GET /api/airports?keyword=Mumbai&subType=AIRPORT,CITY
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/airports', async (req, res) => {
  try {
    const { keyword, subType = 'AIRPORT,CITY', 'page[limit]': limit = '5' } = req.query;

    if (!keyword) {
      return res.status(400).json({ error: 'Missing required param: keyword' });
    }

    console.log(`🏙️  Airport search: "${keyword}"`);

    const data = await amadeusGet('/v1/reference-data/locations', {
      subType,
      keyword,
      'page[limit]': limit
    });

    console.log(`   ↳ ${data.data?.length || 0} locations found`);
    res.json(data);

  } catch (err) {
    console.error('❌  /api/airports error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 3 — Flight Price Confirmation (optional — confirm offer before booking)
//  POST /api/flights/pricing
//  Body: { flightOffers: [ <offer object from /api/flights> ] }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/flights/pricing', async (req, res) => {
  try {
    const { flightOffers } = req.body;
    if (!flightOffers || !Array.isArray(flightOffers)) {
      return res.status(400).json({ error: 'Body must contain flightOffers array' });
    }

    const token = await getAmadeusToken();
    const apiRes = await fetch(`${BASE_URL}/v1/shopping/flight-offers/pricing`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: { type: 'flight-offers-pricing', flightOffers } })
    });

    const body = await apiRes.json();
    if (!apiRes.ok) {
      const detail = body.errors?.[0]?.detail || apiRes.status;
      throw new Error(detail);
    }

    console.log('💰  Pricing confirmed for offer');
    res.json(body);

  } catch (err) {
    console.error('❌  /api/flights/pricing error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE 4 — Health check
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await getAmadeusToken();
    res.json({
      status:  'ok',
      env:     ENV,
      baseUrl: BASE_URL,
      time:    new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Fallback — serve velora_Flight.html for any non-API route
// ─────────────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  //res.sendFile(path.join(__dirname, 'public', 'velora_Flight.html'));
    res.sendFile(path.join(__dirname, 'public', 'index.html'));

});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('🚀  Velora Flight Server started');
  console.log(`    URL   : http://localhost:${PORT}`);
  console.log(`    Mode  : Amadeus ${ENV.toUpperCase()} environment`);
  console.log(`    API   : ${BASE_URL}`);
  console.log('');
  console.log('    Endpoints:');
  console.log(`    GET  /api/flights          → Flight Offers Search`);
  console.log(`    GET  /api/airports         → Airport / City Lookup`);
  console.log(`    POST /api/flights/pricing  → Price Confirmation`);
  console.log(`    GET  /api/health           → Health check + token test`);
  console.log('');
});
