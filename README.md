# Bus Arrivals

A home-screen web app for Singapore bus arrivals. Plain HTML, CSS and JavaScript, with no build step and no server.

## Run it
Open `index.html` in a browser, or run a local server from this folder:

```
npx serve .
```

## Progress
- [x] 1. Type a stop code and see ETAs
- [x] 2. Crowd dots and auto-refresh every 20s
- [x] 3. One search box (stop code, bus number, stop name) and "nearby stops" (uses `data.busrouter.sg/v1/stops.min.json`)
- [x] 4. Favourites: Home / Work / Play icon, custom name, chosen buses, live times on home screen (`localStorage`)
- [x] 5. First/last-bus badges with a warning 30 min before the last bus (`firstlast.min.json`)
- [ ] 6. Installable PWA
- [ ] 7. Trip search: direct buses, live ride time
- [ ] 8. On-board mode
- [ ] 9. Multi-transfer routing via OneMap (needs a serverless function)

## Data sources
- Live arrivals: `https://arrivelah2.busrouter.sg/?id=<stopCode>`
- Static network data: `https://data.busrouter.sg/v1/`
