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
const PORT = process.env.PORT || 3001;

// ── Watchlist — add any player + cards you want to track ─────────────────────
const WATCHLIST = [
  { player: "Victor Wembanyama", sport: "Basketball", cards: [
    "Wembanyama 2023 Panini Prizm RC PSA 10",
    "Wembanyama 2023 Panini Prizm Silver RC PSA 10",
    "Wembanyama 2023 Topps Chrome RC PSA 10",
  ]},
  { player: "Caitlin Clark", sport: "Basketball", cards: [
    "Caitlin Clark 2024 Parkside WNBA RC PSA 10",
    "Caitlin Clark 2024 Panini Prizm WNBA RC PSA 10",
  ]},
  { player: "Shohei Ohtani", sport: "Baseball", cards: [
    "Shohei Ohtani 2018 Topps Chrome RC PSA 10",
    "Shohei Ohtani 2018 Topps Update RC PSA 10",
    "Shohei Ohtani 2018 Topps Update RC PSA 9",
  ]},
  { player: "Patrick Mahomes", sport: "Football", cards: [
    "Mahomes 2017 Panini Prizm RC PSA 10",
    "Mahomes 2017 Panini Prizm RC PSA 9",
    "Mahomes 2017 Topps Chrome RC PSA 10",
  ]},
  { player: "Connor McDavid", sport: "Hockey", cards: [
    "McDavid 2015 Upper Deck Young Guns RC PSA 10",
    "McDavid 2015 Upper Deck Young Guns RC PSA 9",
  ]},
  { player: "Jayden Daniels", sport: "Football", cards: [
    "Jayden Daniels 2024 Panini Prizm RC PSA 10",
    "Jayden Daniels 2024 Panini Prizm Silver RC PSA 10",
  ]},
  { player: "Elly De La Cruz", sport: "Baseball", cards: [
    "Elly De La Cruz 2023 Bowman Chrome RC PSA 10",
    "Elly De La Cruz 2023 Topps Chrome RC PSA 10",
  ]},
  { player: "LeBron James", sport: "Basketball", cards: [
    "LeBron James 2003 Topps Chrome RC PSA 10",
    "LeBron James 2003 Topps Chrome RC PSA 9",
  ]},
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
      `&itemFilter(1).name=ListingType&itemFilter(1).value=AuctionWithBIN` +
      `&itemFilter(2).name=ListingType(1)&itemFilter(2).value=FixedPrice` +
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Content-Type", "application/json");

if (req.method === "OPTIONS") {
  res.writeHead(204);
  res.end();
  return;
}

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
    console.log(`   POST /api/fetch   — trigger manual fetch\n`);
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
