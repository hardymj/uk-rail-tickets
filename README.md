# UK Rail Tickets

A simple web app to:
- Enter a UK postcode and find nearby stations
- Pick a destination
- Compare cheapest fares from each nearby origin to the destination

Frontend is a static site. Backend is a minimal Node/Express proxy to:
- Mirror the stations dataset
- Proxy BR Fares endpoints and postcodes lookups
- Provide basic caching and a local fallback for the stations list

## Project structure

- uk-rail-tickets/
  - index.html
  - assets/
    - app.js
    - style.css
- server/
  - index.js (Express server and API proxy)
  - package.json
  - Dockerfile
  - .dockerignore

## Prerequisites

- Node.js 18+ (or Docker)
- npm

## Running locally (without Docker)

1) Install and start the server
- cd server
- npm install
- npm run dev
- Open http://localhost:3000/uk-rail-tickets/

2) Use the UI
- Enter a postcode (e.g., SW1A 1AA) and click “Find nearby stations”
- Select one or more stations
- Enter destination (station name or CRS like MAN) — suggestions appear
- Optionally add a railcard (autocomplete), set Single/Return and dates/times
- Click Compare fares

## Environment variables

- PORT: Server port (default 3000)
- LOG_LEVEL: info | debug | silent (default info)
- CACHE_TTL_STATIONS_MS: TTL for stations cache (default 86400000 = 24h)
- CACHE_TTL_FARES_MS: TTL for fares cache (default 600000 = 10m)
- CACHE_TTL_SEARCH_MS: TTL for location/railcard search cache (default 3600000 = 1h)
- STATIONS_REFRESH_MS: Background refresh interval for stations (default 86400000 = 24h)

## Docker

Build and run:
- cd server
- docker build -t uk-rail-tickets .
- docker run --rm -p 3000:3000 \
  -e LOG_LEVEL=info \
  -e CACHE_TTL_STATIONS_MS=86400000 \
  -e CACHE_TTL_FARES_MS=600000 \
  -e CACHE_TTL_SEARCH_MS=3600000 \
  -e STATIONS_REFRESH_MS=86400000 \
  uk-rail-tickets

Open http://localhost:3000/uk-rail-tickets/

## Deploy

Any Docker-capable platform will work (Fly.io, Render, Railway, ECS, Cloud Run, etc.). Provide the env vars above as needed.

To deploy without Docker, run `npm ci --omit=dev && npm start` in the `server` directory on Node 18+ and configure your process manager/reverse proxy.

## Data sources

- Stations list: https://github.com/davwheat/uk-railway-stations
- Postcode geocoding: https://postcodes.io
- Fares and lookups: https://www.brfares.com (legacy API endpoints)

## Notes

- The app presents the cheapest adult fare returned by the BR Fares query for each origin→destination.
- Return pricing and time/date sensitivity vary based on the legacy endpoint behavior.
- The backend mirrors stations.json locally for resilience and caches upstream responses in memory.

## Development

The frontend is static and can be edited in `uk-rail-tickets/`. The server proxies are in `server/index.js`.