import express from "express";
import compression from "compression";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configurable TTLs and refresh via env
const TTL = {
  STATIONS_MS: Number(process.env.CACHE_TTL_STATIONS_MS) || 24 * 60 * 60 * 1000, // 24h
  FARES_MS: Number(process.env.CACHE_TTL_FARES_MS) || 10 * 60 * 1000,            // 10m
  SEARCH_MS: Number(process.env.CACHE_TTL_SEARCH_MS) || 60 * 60 * 1000,          // 1h
};
const STATIONS_REFRESH_MS = Number(process.env.STATIONS_REFRESH_MS) || 24 * 60 * 60 * 1000;
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();

app.disable("x-powered-by");
app.use(compression());

// Simple request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const dur = Date.now() - start;
    if (LOG_LEVEL !== "silent") {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${dur}ms`);
    }
  });
  next();
});

// Simple in-memory cache
const cache = new Map();
const putCache = (key, value, ttlMs = 10 * 60 * 1000) => {
  const expires = Date.now() + ttlMs;
  cache.set(key, { value, expires });
};
const getCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};

// Utility fetch with basic caching
async function cachedFetchJson(url, ttlMs = 10 * 60 * 1000, opts = {}) {
  const key = `fetch:${url}`;
  const hit = getCache(key);
  if (hit) return hit;
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "Accept-Encoding": "gzip, deflate" },
    ...opts
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  putCache(key, json, ttlMs);
  return json;
}

// Serve static frontend
const staticRoot = path.resolve(__dirname, "..");
app.use("/", express.static(staticRoot, { extensions: ["html"] }));

// API: Stations (mirror from GitHub with a local file fallback)
const dataDir = path.join(__dirname, "data");
const stationsLocalPath = path.join(dataDir, "stations.json");
const stationsRemote = "https://raw.githubusercontent.com/davwheat/uk-railway-stations/main/stations.json";

// Helper to refresh stations in background
async function refreshStationsBackground() {
  try {
    const json = await cachedFetchJson(stationsRemote, TTL.STATIONS_MS);
    await mkdir(dataDir, { recursive: true });
    await writeFile(stationsLocalPath, JSON.stringify(json));
    if (LOG_LEVEL === "debug") console.log("Stations refreshed and cached");
  } catch (e) {
    console.error("Stations refresh failed:", e.message || e);
  }
}

// Initial stations refresh and interval
refreshStationsBackground();
setInterval(refreshStationsBackground, STATIONS_REFRESH_MS);

app.get("/api/stations", async (req, res) => {
  try {
    const json = await cachedFetchJson(stationsRemote, TTL.STATIONS_MS);
    res.json(json);
    // write-through async
    mkdir(dataDir, { recursive: true }).then(() => writeFile(stationsLocalPath, JSON.stringify(json))).catch(()=>{});
  } catch (e) {
    try {
      const raw = await readFile(stationsLocalPath, "utf8");
      res.json(JSON.parse(raw));
    } catch {
      res.status(e.status || 502).json({ error: "Failed to retrieve stations" });
    }
  }
});

// API: Location search proxy
app.get("/api/loc", async (req, res) => {
  const term = (req.query.term || "").toString().trim();
  if (!term) return res.json([]);
  try {
    const url = `https://gw.brfares.com/legacy_ac_loc?term=${encodeURIComponent(term)}`;
    const json = await cachedFetchJson(url, TTL.SEARCH_MS);
    res.json(json);
  } catch (e) {
    if (LOG_LEVEL !== "silent") console.error("loc error:", e.message || e);
    res.status(e.status || 502).json({ error: "Failed to search locations" });
  }
});

// API: Railcards search proxy
app.get("/api/railcards", async (req, res) => {
  const term = (req.query.term || "").toString().trim();
  if (!term) return res.json([]);
  try {
    const url = `https://gw.brfares.com/legacy_ac_rlc?term=${encodeURIComponent(term)}`;
    const json = await cachedFetchJson(url, TTL.SEARCH_MS);
    res.json(json);
  } catch (e) {
    if (LOG_LEVEL !== "silent") console.error("railcards error:", e.message || e);
    res.status(e.status || 502).json({ error: "Failed to search railcards" });
  }
});

// API: Fares proxy with basic param pass-through
app.get("/api/fares", async (req, res) => {
  const { orig, dest, date, time, rlc, rtn } = req.query;
  if (!orig || !dest) return res.status(400).json({ error: "orig and dest are required" });

  const params = new URLSearchParams({ orig, dest });
  if (date) params.set("date", date);
  if (time) params.set("time", time);
  if (rlc) params.set("rlc", rlc);
  if (rtn) params.set("rtn", "1");

  const url = `https://gw.brfares.com/legacy_querysimple?${params.toString()}`;
  try {
    const json = await cachedFetchJson(url, TTL.FARES_MS);
    res.json(json);
  } catch (e) {
    if (LOG_LEVEL !== "silent") console.error("fares error:", e.message || e);
    res.status(e.status || 502).json({ error: "Failed to fetch fares" });
  }
});

// Healthcheck
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});