// CardPulse Price Tracker — Backend Server
// Fetches real eBay sold data daily and serves it to the frontend
// Run: node server.js

require("dotenv").config();
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const EBAY_APP_ID = process.env.EBAY_APP_ID; // Your eBay App ID from developer.ebay.com
const DATA_FILE = path.join(__dirname, "price-data.json");
const REQUESTS_FILE = path.join(__dirname, "player-requests.json");

// ── Search cache — stores results in memory for 6 hours ───────────────────────
// This means identical searches reuse the same eBay API call instead of
// making a new one, multiplying effective capacity by 10-20x
const SEARCH_CACHE = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getCached(key) {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  // Keep cache from growing too large — max 500 entries
  if (SEARCH_CACHE.size >= 500) {
    const oldestKey = SEARCH_CACHE.keys().next().value;
    SEARCH_CACHE.delete(oldestKey);
  }
  SEARCH_CACHE.set(key, { data, timestamp: Date.now() });
}
const PORT = process.env.PORT || 3001;

// ── Player request helpers ───────────────────────────────────────────────────
function loadRequests() {
  if (!fs.existsSync(REQUESTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(REQUESTS_FILE, "utf8")); }
  catch (e) { return []; }
}

function saveRequests(requests) {
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));
}

// Auto-generate eBay search terms from a player name + sport
function generateCardSearches(playerName, sport) {
  const name = playerName.trim();
  const lastName = name.split(" ").slice(-1)[0];
  const sportKeywords = {
    Basketball: ["Prizm rookie PSA 10", "Topps Chrome rookie PSA 10"],
    Football:   ["Prizm rookie PSA 10", "Topps Chrome rookie PSA 10"],
    Baseball:   ["Bowman Chrome PSA 10", "Topps Chrome rookie PSA 10"],
    Hockey:     ["Young Guns rookie PSA 10", "Upper Deck rookie PSA 10"],
  };
  const keywords = sportKeywords[sport] || sportKeywords["Basketball"];
  return keywords.map(k => `${lastName} ${k}`);
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
const WATCHLIST = [

  // ── NBA TOP 25 ───────────────────────────────────────────────────────────────
  { player: "Victor Wembanyama", sport: "Basketball", cards: ["Wembanyama Prizm rookie PSA 10", "Wembanyama Topps Chrome rookie PSA 10"] },
  { player: "LeBron James", sport: "Basketball", cards: ["LeBron James 2003 Topps Chrome PSA 10", "LeBron James rookie PSA 10"] },
  { player: "Stephen Curry", sport: "Basketball", cards: ["Stephen Curry Prizm rookie PSA 10", "Stephen Curry rookie PSA 10"] },
  { player: "Luka Doncic", sport: "Basketball", cards: ["Luka Doncic Prizm rookie PSA 10", "Luka Doncic rookie PSA 10"] },
  { player: "Giannis Antetokounmpo", sport: "Basketball", cards: ["Giannis Prizm rookie PSA 10", "Giannis rookie PSA 10"] },
  { player: "Nikola Jokic", sport: "Basketball", cards: ["Nikola Jokic Prizm rookie PSA 10", "Nikola Jokic rookie PSA 10"] },
  { player: "Kevin Durant", sport: "Basketball", cards: ["Kevin Durant Prizm rookie PSA 10", "Kevin Durant rookie PSA 10"] },
  { player: "Jayson Tatum", sport: "Basketball", cards: ["Jayson Tatum Prizm rookie PSA 10", "Jayson Tatum rookie PSA 10"] },
  { player: "Anthony Edwards", sport: "Basketball", cards: ["Anthony Edwards Prizm rookie PSA 10", "Anthony Edwards rookie PSA 10"] },
  { player: "Ja Morant", sport: "Basketball", cards: ["Ja Morant Prizm rookie PSA 10", "Ja Morant rookie PSA 10"] },
  { player: "Zion Williamson", sport: "Basketball", cards: ["Zion Williamson Prizm rookie PSA 10", "Zion Williamson rookie PSA 10"] },
  { player: "Paolo Banchero", sport: "Basketball", cards: ["Paolo Banchero Prizm rookie PSA 10", "Paolo Banchero rookie PSA 10"] },
  { player: "Caitlin Clark", sport: "Basketball", cards: ["Caitlin Clark rookie PSA 10", "Caitlin Clark Prizm PSA 10"] },
  { player: "Franz Wagner", sport: "Basketball", cards: ["Franz Wagner Prizm rookie PSA 10", "Franz Wagner rookie PSA 10"] },
  { player: "Tyrese Haliburton", sport: "Basketball", cards: ["Tyrese Haliburton Prizm rookie PSA 10", "Tyrese Haliburton rookie PSA 10"] },
  { player: "Scottie Barnes", sport: "Basketball", cards: ["Scottie Barnes Prizm rookie PSA 10", "Scottie Barnes rookie PSA 10"] },
  { player: "Evan Mobley", sport: "Basketball", cards: ["Evan Mobley Prizm rookie PSA 10", "Evan Mobley rookie PSA 10"] },
  { player: "Cade Cunningham", sport: "Basketball", cards: ["Cade Cunningham Prizm rookie PSA 10", "Cade Cunningham rookie PSA 10"] },
  { player: "Jalen Green", sport: "Basketball", cards: ["Jalen Green Prizm rookie PSA 10", "Jalen Green rookie PSA 10"] },
  { player: "Donovan Mitchell", sport: "Basketball", cards: ["Donovan Mitchell Prizm rookie PSA 10", "Donovan Mitchell rookie PSA 10"] },
  { player: "Devin Booker", sport: "Basketball", cards: ["Devin Booker Prizm rookie PSA 10", "Devin Booker rookie PSA 10"] },
  { player: "Shai Gilgeous-Alexander", sport: "Basketball", cards: ["Shai Gilgeous Alexander Prizm rookie PSA 10", "SGA rookie PSA 10"] },
  { player: "Jaylen Brown", sport: "Basketball", cards: ["Jaylen Brown Prizm rookie PSA 10", "Jaylen Brown rookie PSA 10"] },
  { player: "Bam Adebayo", sport: "Basketball", cards: ["Bam Adebayo Prizm rookie PSA 10", "Bam Adebayo rookie PSA 10"] },
  { player: "Jaren Jackson Jr", sport: "Basketball", cards: ["Jaren Jackson Prizm rookie PSA 10", "Jaren Jackson rookie PSA 10"] },

  // ── NFL TOP 25 ───────────────────────────────────────────────────────────────
  { player: "Patrick Mahomes", sport: "Football", cards: ["Mahomes 2017 Prizm rookie PSA 10", "Mahomes 2017 Topps Chrome rookie PSA 10"] },
  { player: "Josh Allen", sport: "Football", cards: ["Josh Allen Prizm rookie PSA 10", "Josh Allen rookie PSA 10"] },
  { player: "Lamar Jackson", sport: "Football", cards: ["Lamar Jackson Prizm rookie PSA 10", "Lamar Jackson rookie PSA 10"] },
  { player: "Joe Burrow", sport: "Football", cards: ["Joe Burrow Prizm rookie PSA 10", "Joe Burrow rookie PSA 10"] },
  { player: "Justin Jefferson", sport: "Football", cards: ["Justin Jefferson Prizm rookie PSA 10", "Justin Jefferson rookie PSA 10"] },
  { player: "Justin Herbert", sport: "Football", cards: ["Justin Herbert Prizm rookie PSA 10", "Justin Herbert rookie PSA 10"] },
  { player: "Jayden Daniels", sport: "Football", cards: ["Jayden Daniels Prizm rookie PSA 10", "Jayden Daniels rookie PSA 10"] },
  { player: "Caleb Williams", sport: "Football", cards: ["Caleb Williams Prizm rookie PSA 10", "Caleb Williams rookie PSA 10"] },
  { player: "CJ Stroud", sport: "Football", cards: ["CJ Stroud Prizm rookie PSA 10", "CJ Stroud rookie PSA 10"] },
  { player: "Marvin Harrison Jr", sport: "Football", cards: ["Marvin Harrison Prizm rookie PSA 10", "Marvin Harrison rookie PSA 10"] },
  { player: "Brock Purdy", sport: "Football", cards: ["Brock Purdy Prizm rookie PSA 10", "Brock Purdy rookie PSA 10"] },
  { player: "Ja'Marr Chase", sport: "Football", cards: ["Jamarr Chase Prizm rookie PSA 10", "Jamarr Chase rookie PSA 10"] },
  { player: "Cooper Kupp", sport: "Football", cards: ["Cooper Kupp Prizm rookie PSA 10", "Cooper Kupp rookie PSA 10"] },
  { player: "Tyreek Hill", sport: "Football", cards: ["Tyreek Hill Prizm rookie PSA 10", "Tyreek Hill rookie PSA 10"] },
  { player: "Travis Kelce", sport: "Football", cards: ["Travis Kelce Prizm rookie PSA 10", "Travis Kelce rookie PSA 10"] },
  { player: "Davante Adams", sport: "Football", cards: ["Davante Adams Prizm rookie PSA 10", "Davante Adams rookie PSA 10"] },
  { player: "Stefon Diggs", sport: "Football", cards: ["Stefon Diggs Prizm rookie PSA 10", "Stefon Diggs rookie PSA 10"] },
  { player: "Puka Nacua", sport: "Football", cards: ["Puka Nacua Prizm rookie PSA 10", "Puka Nacua rookie PSA 10"] },
  { player: "Drake Maye", sport: "Football", cards: ["Drake Maye Prizm rookie PSA 10", "Drake Maye rookie PSA 10"] },
  { player: "Bo Nix", sport: "Football", cards: ["Bo Nix Prizm rookie PSA 10", "Bo Nix rookie PSA 10"] },
  { player: "Malik Nabers", sport: "Football", cards: ["Malik Nabers Prizm rookie PSA 10", "Malik Nabers rookie PSA 10"] },
  { player: "Rome Odunze", sport: "Football", cards: ["Rome Odunze Prizm rookie PSA 10", "Rome Odunze rookie PSA 10"] },
  { player: "Dak Prescott", sport: "Football", cards: ["Dak Prescott Prizm rookie PSA 10", "Dak Prescott rookie PSA 10"] },
  { player: "Jalen Hurts", sport: "Football", cards: ["Jalen Hurts Prizm rookie PSA 10", "Jalen Hurts rookie PSA 10"] },
  { player: "Trevor Lawrence", sport: "Football", cards: ["Trevor Lawrence Prizm rookie PSA 10", "Trevor Lawrence rookie PSA 10"] },

  // ── MLB TOP 25 ───────────────────────────────────────────────────────────────
  { player: "Shohei Ohtani", sport: "Baseball", cards: ["Ohtani 2018 Topps Chrome rookie PSA 10", "Ohtani Topps Update rookie PSA 10"] },
  { player: "Mike Trout", sport: "Baseball", cards: ["Mike Trout 2011 Topps Update rookie PSA 10", "Mike Trout rookie PSA 10"] },
  { player: "Ronald Acuna Jr", sport: "Baseball", cards: ["Ronald Acuna Prizm rookie PSA 10", "Ronald Acuna Topps Chrome rookie PSA 10"] },
  { player: "Juan Soto", sport: "Baseball", cards: ["Juan Soto Topps Chrome rookie PSA 10", "Juan Soto rookie PSA 10"] },
  { player: "Elly De La Cruz", sport: "Baseball", cards: ["Elly De La Cruz Bowman Chrome PSA 10", "Elly De La Cruz rookie PSA 10"] },
  { player: "Paul Skenes", sport: "Baseball", cards: ["Paul Skenes Bowman Chrome PSA 10", "Paul Skenes rookie PSA 10"] },
  { player: "Jackson Holliday", sport: "Baseball", cards: ["Jackson Holliday Bowman Chrome PSA 10", "Jackson Holliday rookie PSA 10"] },
  { player: "Gunnar Henderson", sport: "Baseball", cards: ["Gunnar Henderson Bowman Chrome PSA 10", "Gunnar Henderson rookie PSA 10"] },
  { player: "Julio Rodriguez", sport: "Baseball", cards: ["Julio Rodriguez Topps Chrome rookie PSA 10", "Julio Rodriguez rookie PSA 10"] },
  { player: "Bobby Witt Jr", sport: "Baseball", cards: ["Bobby Witt Bowman Chrome PSA 10", "Bobby Witt rookie PSA 10"] },
  { player: "Corbin Carroll", sport: "Baseball", cards: ["Corbin Carroll Bowman Chrome PSA 10", "Corbin Carroll rookie PSA 10"] },
  { player: "Francisco Lindor", sport: "Baseball", cards: ["Francisco Lindor Topps Chrome rookie PSA 10", "Francisco Lindor rookie PSA 10"] },
  { player: "Mookie Betts", sport: "Baseball", cards: ["Mookie Betts Topps Chrome rookie PSA 10", "Mookie Betts rookie PSA 10"] },
  { player: "Freddie Freeman", sport: "Baseball", cards: ["Freddie Freeman Topps Chrome rookie PSA 10", "Freddie Freeman rookie PSA 10"] },
  { player: "Fernando Tatis Jr", sport: "Baseball", cards: ["Fernando Tatis Topps Chrome rookie PSA 10", "Fernando Tatis rookie PSA 10"] },
  { player: "Vladimir Guerrero Jr", sport: "Baseball", cards: ["Vladimir Guerrero Topps Chrome rookie PSA 10", "Vladimir Guerrero rookie PSA 10"] },
  { player: "Adley Rutschman", sport: "Baseball", cards: ["Adley Rutschman Bowman Chrome PSA 10", "Adley Rutschman rookie PSA 10"] },
  { player: "Yordan Alvarez", sport: "Baseball", cards: ["Yordan Alvarez Topps Chrome rookie PSA 10", "Yordan Alvarez rookie PSA 10"] },
  { player: "Pete Alonso", sport: "Baseball", cards: ["Pete Alonso Topps Chrome rookie PSA 10", "Pete Alonso rookie PSA 10"] },
  { player: "Bryce Harper", sport: "Baseball", cards: ["Bryce Harper Topps Chrome rookie PSA 10", "Bryce Harper rookie PSA 10"] },
  { player: "Cody Bellinger", sport: "Baseball", cards: ["Cody Bellinger Topps Chrome rookie PSA 10", "Cody Bellinger rookie PSA 10"] },
  { player: "Trea Turner", sport: "Baseball", cards: ["Trea Turner Topps Chrome rookie PSA 10", "Trea Turner rookie PSA 10"] },
  { player: "Jazz Chisholm Jr", sport: "Baseball", cards: ["Jazz Chisholm Bowman Chrome PSA 10", "Jazz Chisholm rookie PSA 10"] },
  { player: "Spencer Strider", sport: "Baseball", cards: ["Spencer Strider Topps Chrome rookie PSA 10", "Spencer Strider rookie PSA 10"] },
  { player: "Yoshinobu Yamamoto", sport: "Baseball", cards: ["Yoshinobu Yamamoto Topps rookie PSA 10", "Yamamoto rookie PSA 10"] },
];


// ── eBay API call ─────────────────────────────────────────────────────────────
function fetchEbaySales(keywords) {
  return new Promise((resolve, reject) => {
    if (!EBAY_APP_ID) {
      reject(new Error("No EBAY_APP_ID set in .env file"));
      return;
    }

    const encodedKeywords = encodeURIComponent(keywords);
    const url = `https://svcs.ebay.com/services/search/FindingService/v1` +
      `?OPERATION-NAME=findCompletedItems` +
      `&SERVICE-VERSION=1.0.0` +
      `&SECURITY-APPNAME=${EBAY_APP_ID}` +
      `&RESPONSE-DATA-FORMAT=JSON` +
      `&keywords=${encodedKeywords}` +
      `&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true` +
      
      
      
      `&sortOrder=EndTimeSoonest` +
      `&paginationInput.entriesPerPage=50`;

    https.get(url, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const items = json?.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
          const sales = items
            .filter(item => item.sellingStatus?.[0]?.sellingState?.[0] === "EndedWithSales")
            .map(item => ({
              title: item.title?.[0] || "",
              price: parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.["__value__"] || 0),
              date: item.listingInfo?.[0]?.endTime?.[0] || "",
              itemId: item.itemId?.[0] || "",
              url: item.viewItemURL?.[0] || "",
            }))
            .filter(s => s.price > 0);
          resolve(sales);
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

// ── Calculate stats from sales ────────────────────────────────────────────────
function calcStats(sales) {
  if (!sales.length) return { avg: 0, high: 0, low: 0, count: 0, recent: [] };
  const prices = sales.map(s => s.price);
  return {
    avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    high: Math.max(...prices),
    low: Math.min(...prices),
    count: sales.length,
    recent: sales.slice(0, 10),
  };
}

// ── Calculate heat score & price change ──────────────────────────────────────
function calcHeat(history) {
  // history = array of { date, avg } snapshots over time
  if (history.length < 2) return { weekChange: 0, monthChange: 0, heat: 50 };

  const latest = history[history.length - 1].avg;
  const weekAgo = history[Math.max(0, history.length - 8)].avg;   // ~7 days back
  const monthAgo = history[Math.max(0, history.length - 31)].avg; // ~30 days back

  const weekChange = weekAgo > 0 ? ((latest - weekAgo) / weekAgo * 100) : 0;
  const monthChange = monthAgo > 0 ? ((latest - monthAgo) / monthAgo * 100) : 0;

  // Heat = weighted combo of short + long term momentum + volume signal
  const heat = Math.min(99, Math.max(1, Math.round(
    (weekChange * 2) + (monthChange * 1.5) + 50
  )));

  return {
    weekChange: parseFloat(weekChange.toFixed(1)),
    monthChange: parseFloat(monthChange.toFixed(1)),
    heat,
  };
}

// ── Main fetch & save loop ────────────────────────────────────────────────────
async function fetchAllPrices() {
  console.log(`[${new Date().toISOString()}] Starting price fetch for ${WATCHLIST.length} players...`);

  // Load existing data to append history
  let existingData = {};
  if (fs.existsSync(DATA_FILE)) {
    try { existingData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch (e) { console.warn("Could not read existing data, starting fresh"); }
  }

  const today = new Date().toISOString().split("T")[0];
  const result = { lastUpdated: new Date().toISOString(), players: [] };

  for (const entry of WATCHLIST) {
    console.log(`  Fetching: ${entry.player}...`);
    const playerData = {
      player: entry.player,
      sport: entry.sport,
      cards: [],
    };

    for (const cardQuery of entry.cards) {
      try {
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));

        const sales = await fetchEbaySales(cardQuery);
        const stats = calcStats(sales);

        // Preserve existing history, append today's snapshot
        const existingCard = existingData?.players
          ?.find(p => p.player === entry.player)
          ?.cards?.find(c => c.query === cardQuery);

        const history = existingCard?.history || [];
        // Only add a new snapshot if we don't already have one for today
        if (!history.find(h => h.date === today)) {
          history.push({ date: today, avg: stats.avg, count: stats.count });
        }
        // Keep last 90 days of history
        const trimmedHistory = history.slice(-90);

        const heat = calcHeat(trimmedHistory);

        playerData.cards.push({
          query: cardQuery,
          label: cardQuery,
          stats,
          history: trimmedHistory,
          ...heat,
          lastFetched: new Date().toISOString(),
        });

        console.log(`    ✓ ${cardQuery}: $${stats.avg} avg (${stats.count} sales)`);
      } catch (err) {
        console.error(`    ✗ ${cardQuery}: ${err.message}`);
        // Keep old data if fetch fails
        const existingCard = existingData?.players
          ?.find(p => p.player === entry.player)
          ?.cards?.find(c => c.query === cardQuery);
        if (existingCard) playerData.cards.push(existingCard);
      }
    }

    // Roll up player-level heat from best card
    if (playerData.cards.length > 0) {
      const bestCard = [...playerData.cards].sort((a, b) => b.monthChange - a.monthChange)[0];
      playerData.weekChange = bestCard.weekChange;
      playerData.monthChange = bestCard.monthChange;
      playerData.heat = bestCard.heat;
      playerData.volume = playerData.cards.reduce((sum, c) => sum + (c.stats?.count || 0), 0);
      playerData.reason = `Based on ${playerData.cards.length} tracked cards`;
    }

    result.players.push(playerData);
  }

  // Sort players by heat score descending
  result.players.sort((a, b) => (b.heat || 0) - (a.heat || 0));
  result.players.forEach((p, i) => { p.rank = i + 1; });

  // Save to file
  fs.writeFileSync(DATA_FILE, JSON.stringify(result, null, 2));
  console.log(`[${new Date().toISOString()}] ✅ Done. Data saved to ${DATA_FILE}`);
  return result;
}

// ── HTTP server — serves data to the frontend ─────────────────────────────────
function createServer() {
  const server = http.createServer((req, res) => {
    // CORS headers so the frontend can read the data
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Content-Type", "application/json");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    if (req.url === "/api/prices") {
      if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, "utf8");
        res.writeHead(200);
        res.end(data);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "No data yet — run a fetch first" }));
      }
      return;
    }


    // ── Live search endpoint ── /api/search?q=LeBron+James+PSA+10 ────────────
    if (req.url.startsWith("/api/search")) {
      const urlObj = new URL(req.url, "http://localhost");
      const query = urlObj.searchParams.get("q");
      if (!query) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Missing ?q= parameter" }));
        return;
      }
      // Normalize query for cache key (lowercase, trimmed)
      const cacheKey = query.toLowerCase().trim();
      const cached = getCached(cacheKey);

      if (cached) {
        // Cache hit — return instantly, no eBay API call used
        console.log(`  [CACHE HIT] "${query}" — serving cached result`);
        res.writeHead(200);
        res.end(JSON.stringify({ ...cached, fromCache: true }));
        return;
      }

      // Cache miss — fetch from eBay and cache the result
      console.log(`  [CACHE MISS] "${query}" — fetching from eBay`);
      fetchEbaySales(query)
        .then(sales => {
          const stats = calcStats(sales);
          const allPrices = sales.map(s => s.price).filter(p => p > 0);
          const minP = allPrices.length ? Math.min(...allPrices) : 0;
          const maxP = allPrices.length ? Math.max(...allPrices) : 0;
          const bSize = Math.max(1, Math.ceil((maxP - minP) / 6));
          const distribution = Array.from({ length: 6 }, (_, i) => {
            const lo = minP + i * bSize, hi = lo + bSize;
            return { range: `$${lo}-$${hi}`, count: allPrices.filter(p => p >= lo && p < hi).length };
          });
          const trend = Array.from({ length: 12 }, (_, i) => {
            const wkSales = sales.filter(s => {
              const daysAgo = Math.floor((Date.now() - new Date(s.date).getTime()) / 86400000);
              return daysAgo >= i * 7 && daysAgo < (i + 1) * 7;
            });
            return { week: `W${12 - i}`, avg: wkSales.length ? Math.round(wkSales.reduce((a, b) => a + b.price, 0) / wkSales.length) : null };
          }).reverse();
          const result = { query, stats, sales: sales.slice(0, 30), trend, distribution, fromCache: false };
          setCache(cacheKey, result);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        })
        .catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      return;
    }

    if (req.url === "/api/fetch" && req.method === "POST") {
      // Trigger a manual fetch
      fetchAllPrices()
        .then(() => { res.writeHead(200); res.end(JSON.stringify({ ok: true })); })
        .catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
      return;
    }

    if (req.url === "/api/status") {
      const hasData = fs.existsSync(DATA_FILE);
      const data = hasData ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) : null;
      res.writeHead(200);
      res.end(JSON.stringify({
        status: "running",
        hasData,
        lastUpdated: data?.lastUpdated || null,
        playerCount: data?.players?.length || 0,
        ebayConnected: !!EBAY_APP_ID,
        cache: {
          entries: SEARCH_CACHE.size,
          maxEntries: 500,
          ttlHours: 6,
        }
      }));
      return;
    }

    // ── POST /api/request — user submits a player to track ──────────────────
    if (req.url === "/api/request" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { player, sport } = JSON.parse(body);
          if (!player || !sport) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing player or sport" }));
            return;
          }

          const requests = loadRequests();
          const normalizedName = player.trim();

          // Check if already in watchlist
          const alreadyTracked = WATCHLIST.some(w =>
            w.player.toLowerCase() === normalizedName.toLowerCase()
          );
          if (alreadyTracked) {
            res.writeHead(200);
            res.end(JSON.stringify({ status: "already_tracked", message: `${normalizedName} is already being tracked!` }));
            return;
          }

          // Check if already requested
          const alreadyRequested = requests.find(r =>
            r.player.toLowerCase() === normalizedName.toLowerCase()
          );
          if (alreadyRequested) {
            alreadyRequested.votes = (alreadyRequested.votes || 1) + 1;
            saveRequests(requests);
            res.writeHead(200);
            res.end(JSON.stringify({ status: "upvoted", message: `Vote added! ${normalizedName} has ${alreadyRequested.votes} requests.`, votes: alreadyRequested.votes }));
            return;
          }

          // New request — auto generate card searches
          const cardSearches = generateCardSearches(normalizedName, sport);
          const newRequest = {
            id: Date.now(),
            player: normalizedName,
            sport,
            cards: cardSearches,
            votes: 1,
            requestedAt: new Date().toISOString(),
            status: "pending", // pending | approved | rejected
          };

          requests.push(newRequest);
          saveRequests(requests);

          // Auto-approve if votes threshold met (start at 1 = auto approve all)
          // Change this number to require more votes before tracking
          const AUTO_APPROVE_VOTES = 1;
          if (newRequest.votes >= AUTO_APPROVE_VOTES) {
            // Add to live watchlist immediately
            WATCHLIST.push({ player: normalizedName, sport, cards: cardSearches });
            newRequest.status = "approved";
            saveRequests(requests);
            console.log(`  ✅ Auto-approved player request: ${normalizedName} (${sport})`);
            res.writeHead(200);
            res.end(JSON.stringify({ status: "approved", message: `${normalizedName} has been added to tracking! Data will appear after the next refresh.`, player: normalizedName, sport, cards: cardSearches }));
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ status: "requested", message: `${normalizedName} has been requested! They'll be added once they reach ${AUTO_APPROVE_VOTES} votes.`, votes: 1 }));
          }
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid request body" }));
        }
      });
      return;
    }

    // ── GET /api/requests — list all pending/approved requests ───────────────
    if (req.url === "/api/requests") {
      const requests = loadRequests();
      res.writeHead(200);
      res.end(JSON.stringify({
        total: requests.length,
        approved: requests.filter(r => r.status === "approved").length,
        pending: requests.filter(r => r.status === "pending").length,
        requests: requests.sort((a, b) => (b.votes || 0) - (a.votes || 0)),
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`\n🚀 CardPulse server running on http://localhost:${PORT}`);
    console.log(`   GET  /api/prices  — latest price data`);
    console.log(`   GET  /api/status  — server status`);
    console.log(`   POST /api/fetch   — trigger manual fetch`);
    console.log(`   GET  /api/search?q= — live card search (cached 6hrs)\n`);
    if (!EBAY_APP_ID) {
      console.warn("⚠️  EBAY_APP_ID not set in .env — add it to enable live data\n");
    }
  });
}

// ── Scheduler — fetch once on startup, then every 24 hours ───────────────────
async function start() {
  createServer();

  // Initial fetch on startup
  if (EBAY_APP_ID) {
    await fetchAllPrices().catch(e => console.error("Initial fetch failed:", e.message));
  } else {
    console.log("Skipping fetch — no EBAY_APP_ID configured");
  }

  // Schedule daily refresh
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(async () => {
    console.log("Running scheduled daily fetch...");
    await fetchAllPrices().catch(e => console.error("Scheduled fetch failed:", e.message));
  }, TWENTY_FOUR_HOURS);
}

start();
