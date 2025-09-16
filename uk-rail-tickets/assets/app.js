/**
 * UK Train Fare Finder - Frontend (uses local Node server proxies where available)
 * - Postcode geocoding: https://api.postcodes.io/postcodes/{postcode}
 * - Stations list: /api/stations (proxied/mirrored)
 * - Fares: /api/fares?orig=XXX&dest=YYY
 * - Dest search: /api/loc?term=...
 * - Railcards search: /api/railcards?term=...
 */

const stationsURL = "/api/stations";
const brFaresBase = "/api/fares";
const brFaresSearch = "/api/loc?term=";
const brRailcardsSearch = "/api/railcards?term=";

const qs = sel => document.querySelector(sel);
const qsa = sel => Array.from(document.querySelectorAll(sel));

const el = {
  postcode: qs("#postcode"),
  findStations: qs("#find-stations"),
  nearbyList: qs("#nearby-list"),
  nearbyLimit: qs("#nearby-limit"),
  nearbyRadius: qs("#nearby-radius"),
  toggleSelect: qs("#toggle-select"),
  dest: qs("#destination"),
  destSuggestions: qs("#dest-suggestions"),
  compare: qs("#compare"),
  status: qs("#status"),
  results: qs("#results-body"),
  form: qs("#search-form"),
  // new
  jtSingle: qs("#jt-single"),
  jtReturn: qs("#jt-return"),
  outDate: qs("#out-date"),
  outTime: qs("#out-time"),
  retDateWrap: qs("#ret-date-wrap"),
  retTimeWrap: qs("#ret-time-wrap"),
  retDate: qs("#ret-date"),
  retTime: qs("#ret-time"),
  rcInput: qs("#railcard"),
  rcSuggestions: qs("#railcard-suggestions"),
  stationsSpinner: qs("#stations-spinner"),
  faresSpinner: qs("#fares-spinner"),
};

let STATIONS = [];
let destOptions = [];
let railcardOptions = [];
let cache = {
  stations: null, // stations JSON
  fares: new Map(), // key -> response
};

function cacheKey(params) {
  return JSON.stringify(params);
}

function show(elm) { elm && (elm.hidden = false); }
function hide(elm) { elm && (elm.hidden = true); }

async function loadStations() {
  if (cache.stations) {
    STATIONS = cache.stations;
    return;
  }
  const res = await fetch(stationsURL, { cache: "force-cache" });
  if (!res.ok) throw new Error("Failed to load stations data");
  const raw = await res.json();
  STATIONS = raw.filter(s => s.crs && s.lat && s.long)
    .map(s => ({ name: s.name, crs: s.crs, lat: s.lat, lon: s.long || s.lon }));
  cache.stations = STATIONS;
}

function toRadians(d) { return d * Math.PI / 180; }
function haversine(a, b) {
  const R = 6371; // km
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const s1 = Math.sin(dLat/2)**2 + Math.cos(toRadians(a.lat))*Math.cos(toRadians(b.lat))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(s1), Math.sqrt(1-s1));
  return R * c;
}

async function geocodePostcode(postcode) {
  const pc = postcode.trim().toUpperCase().replace(/\s+/g, "");
  const res = await fetch(`https://api.postcodes.io/postcodes/${pc}`);
  const data = await res.json();
  if (data.status !== 200) throw new Error(data.error || "Invalid postcode");
  return { lat: data.result.latitude, lon: data.result.longitude };
}

function findNearbyStations(center, radiusKm, limit) {
  const withDist = STATIONS.map(s => ({...s, distance: haversine(center, s)}));
  return withDist
    .filter(s => s.distance <= radiusKm)
    .sort((a,b) => a.distance - b.distance)
    .slice(0, limit);
}

function renderNearby(stations) {
  if (!stations.length) {
    el.nearbyList.classList.add("empty");
    el.nearbyList.innerHTML = `<p class="muted">No stations found within the chosen radius.</p>`;
    el.compare.disabled = true;
    return;
  }
  el.nearbyList.classList.remove("empty");
  el.nearbyList.innerHTML = stations.map(s => `
    <label class="station-pill">
      <input type="checkbox" class="nearby-check" value="${s.crs}">
      <div class="station-title">
        <strong>${s.name}</strong>
        <small>${s.crs} • ${s.distance.toFixed(1)} km</small>
      </div>
    </label>
  `).join("");
  el.compare.disabled = false;
}

function setStatus(msg, isError=false) {
  el.status.textContent = msg || "";
  el.status.classList.toggle("error", !!isError);
}

async function suggestDestinations(query) {
  if (!query || query.length < 2) {
    el.destSuggestions.innerHTML = "";
    destOptions = [];
    return;
  }
  const q = query.toLowerCase();
  const local = STATIONS
    .filter(s => s.name.toLowerCase().includes(q) || s.crs.toLowerCase().startsWith(q))
    .slice(0, 10)
    .map(s => ({ name: s.name, crs: s.crs }));
  let remote = [];
  try {
    const r = await fetch(brFaresSearch + encodeURIComponent(query));
    if (r.ok) {
      const js = await r.json();
      remote = (js || []).map(x => ({ name: x.location, crs: x.code }));
    }
  } catch {}
  const map = new Map();
  [...local, ...remote].forEach(it => { if (!map.has(it.crs)) map.set(it.crs, it); });
  destOptions = Array.from(map.values()).slice(0, 12);

  el.destSuggestions.innerHTML = destOptions.length ? `
    <ul>
      ${destOptions.map(o => `<li data-crs="${o.crs}">${o.name} (${o.crs})</li>`).join("")}
    </ul>
  ` : "";
}

async function suggestRailcards(query) {
  if (!query || query.length < 1) {
    el.rcSuggestions.innerHTML = "";
    railcardOptions = [];
    return;
  }
  try {
    const r = await fetch(brRailcardsSearch + encodeURIComponent(query));
    if (r.ok) {
      const js = await r.json(); // Expect [{code, name}] or similar
      railcardOptions = (js || []).map(x => ({
        code: x.code || x.value || x.id,
        name: x.name || x.label || x.description || x.text || `${x.code}`,
      })).filter(x => x.code);
      // de-dupe by code
      const m = new Map();
      railcardOptions.forEach(x => { if (!m.has(x.code)) m.set(x.code, x); });
      railcardOptions = Array.from(m.values()).slice(0, 10);
      el.rcSuggestions.innerHTML = railcardOptions.length ? `
        <ul>
          ${railcardOptions.map(o => `<li data-code="${o.code}">${o.name} (${o.code})</li>`).join("")}
        </ul>
      ` : "";
    }
  } catch {
    // ignore
  }
}

function selectAllNearby(toggleTo) {
  qsa(".nearby-check").forEach(cb => cb.checked = toggleTo);
}

function parseCheapestFare(faresJson) {
  if (!faresJson || !Array.isArray(faresJson.fares)) return null;
  const getPrice = f => (typeof f.adult === "number" ? f.adult : (f.price && f.price.adult)) ?? null;
  const withPrice = faresJson.fares
    .map(f => ({...f, p: getPrice(f)}))
    .filter(f => typeof f.p === "number");
  if (!withPrice.length) return null;
  withPrice.sort((a,b) => a.p - b.p);
  return withPrice[0];
}

function formatPence(p) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP"}).format(p/100);
}

function renderResults(rows) {
  if (!rows.length) {
    el.results.innerHTML = `<p class="muted">No fares found.</p>`;
    return;
  }
  el.results.innerHTML = rows.map(r => `
    <div class="result-row">
      <div><strong>${r.originName}</strong> <span class="muted">(${r.origin}) → ${r.destName} (${r.dest})</span></div>
      <div class="muted">${r.ticketName} <span class="muted">[${r.ticket}]</span></div>
      <div class="price">${formatPence(r.price)}</div>
    </div>
  `).join("");
}

async function getFares(orig, dest, opts = {}) {
  const params = new URLSearchParams({ orig, dest });
  if (opts.date) params.set("date", opts.date);
  if (opts.time) params.set("time", opts.time);
  if (opts.rlc) params.set("rlc", opts.rlc);
  if (opts.journey === "return") params.set("rtn", "1"); // hint for returns if supported

  const key = cacheKey({ orig, dest, ...opts });
  if (cache.fares.has(key)) {
    return cache.fares.get(key);
  }

  const url = `${brFaresBase}?${params.toString()}`;
  const res = await fetch(url, { headers: { "Accept": "application/json" }});
  if (!res.ok) throw new Error(`Fare fetch failed ${res.status}`);
  const json = await res.json();
  cache.fares.set(key, json);
  return json;
}

function stationByCRS(crs) {
  return STATIONS.find(s => s.crs === crs) || { name: crs, crs };
}

function parseDateInput(elm) {
  return elm && elm.value ? elm.value : undefined; // yyyy-mm-dd
}
function parseTimeInput(elm) {
  return elm && elm.value ? elm.value : undefined; // HH:MM
}

async function handleCompare(ev) {
  ev.preventDefault();
  const checked = qsa(".nearby-check").filter(cb => cb.checked).map(cb => cb.value);
  const destValue = el.dest.value.trim();
  if (!checked.length) return setStatus("Select at least one nearby station.", true);

  // Resolve dest CRS
  let destCRS = destValue.toUpperCase();
  let destName = destValue;
  const maybe = STATIONS.find(s => s.crs.toUpperCase() === destCRS) || STATIONS.find(s => s.name.toLowerCase() === destValue.toLowerCase());
  if (maybe) {
    destCRS = maybe.crs;
    destName = maybe.name;
  } else if (/^[A-Z]{3}$/.test(destCRS) === false && destOptions.length) {
    destCRS = destOptions[0].crs;
    destName = destOptions[0].name;
  }

  const opts = {
    journey: el.jtReturn.checked ? "return" : "single",
    date: parseDateInput(el.outDate),
    time: parseTimeInput(el.outTime),
    rlc: (el.rcInput.value.match(/\(([A-Z]{3})\)$/) || [])[1] || undefined,
  };

  setStatus("Fetching fares...");
  show(el.faresSpinner);
  el.compare.disabled = true;

  const rows = [];
  for (const crs of checked) {
    try {
      const fares = await getFares(crs, destCRS, opts);
      const cheapest = parseCheapestFare(fares);
      if (cheapest) {
        const origin = stationByCRS(crs);
        rows.push({
          origin: crs,
          originName: origin.name || crs,
          dest: destCRS,
          destName,
          ticket: cheapest.ticket || cheapest.ticket_code || "",
          ticketName: cheapest.name || cheapest.ticket_name || "Cheapest",
          price: cheapest.p,
        });
      }
    } catch (e) {
      console.warn("Fare fetch error", e);
    }
  }

  rows.sort((a,b) => a.price - b.price);
  renderResults(rows);
  setStatus(rows.length ? `Found ${rows.length} routes.` : "No routes found.");
  hide(el.faresSpinner);
  el.compare.disabled = false;
}

function attachEvents() {
  el.findStations.addEventListener("click", async () => {
    try {
      setStatus("Looking up postcode...");
      show(el.stationsSpinner);
      if (!STATIONS.length) {
        await loadStations();
      }
      const center = await geocodePostcode(el.postcode.value);
      setStatus("Finding nearby stations...");
      const stations = findNearbyStations(center, Number(el.nearbyRadius.value), Number(el.nearbyLimit.value));
      renderNearby(stations);
      setStatus("");
    } catch (e) {
      setStatus(e.message || "Failed to find stations", true);
    } finally {
      hide(el.stationsSpinner);
    }
  });

  el.toggleSelect.addEventListener("click", () => {
    const boxes = qsa(".nearby-check");
    const allChecked = boxes.length && boxes.every(b => b.checked);
    selectAllNearby(!allChecked);
    el.toggleSelect.textContent = !allChecked ? "Clear all" : "Select all";
  });

  el.dest.addEventListener("input", async (e) => {
    const q = e.target.value;
    await suggestDestinations(q);
  });

  el.destSuggestions.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-crs]");
    if (!li) return;
    const crs = li.dataset.crs;
    const opt = destOptions.find(o => o.crs === crs);
    if (opt) {
      el.dest.value = `${opt.name} (${opt.crs})`;
      el.destSuggestions.innerHTML = "";
    }
  });

  // Railcard typeahead
  el.rcInput.addEventListener("input", async (e) => {
    const q = e.target.value;
    await suggestRailcards(q);
  });
  el.rcSuggestions.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-code]");
    if (!li) return;
    const opt = railcardOptions.find(o => o.code === li.dataset.code);
    if (opt) {
      el.rcInput.value = `${opt.name} (${opt.code})`;
      el.rcSuggestions.innerHTML = "";
    }
  });

  // Journey type toggles return fields
  el.jtSingle.addEventListener("change", () => {
    const showReturn = el.jtReturn.checked;
    el.retDateWrap.hidden = !showReturn;
    el.retTimeWrap.hidden = !showReturn;
  });
  el.jtReturn.addEventListener("change", () => {
    const showReturn = el.jtReturn.checked;
    el.retDateWrap.hidden = !showReturn;
    el.retTimeWrap.hidden = !showReturn;
  });

  el.form.addEventListener("submit", handleCompare);
}

attachEvents();