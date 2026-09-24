# Bus Arrivals

A home-screen web app for Singapore bus arrivals. Plain HTML, CSS and JavaScript, with no build step and no server.

**Live app:** https://qilin1983.github.io/bus-app/

## Run it
Opening `index.html` directly works for trying it out, but installing and offline mode
need the page served over http(s). From this folder:

```
npx serve .
```

Then open the address it prints (e.g. http://localhost:3000).

## Install on your phone
The app must be hosted on an https address first (e.g. GitHub Pages).
- **Android (Chrome/Edge):** tap **Install app** at the top, or menu → *Install app*.
- **iPhone (Safari):** tap Share → *Add to Home Screen*.
- **Desktop (Chrome/Edge):** tap **Install app**, or the install icon in the address bar.

Once installed it opens full-screen, and the app plus stop search work offline.
Live arrival times always need a connection.

## Progress
- [x] 1. Type a stop code and see ETAs
- [x] 2. Crowd dots and auto-refresh every 20s
- [x] 3. One search box (stop code, bus number, stop name) and "nearby stops" (uses `data.busrouter.sg/v1/stops.min.json`)
- [x] 4. Favourites: Home / Work / Play icon, custom name, chosen buses, live times on home screen (`localStorage`)
- [x] 5. First/last-bus badges with a warning 30 min before the last bus (`firstlast.min.json`)
- [x] 6. Installable app: manifest, icons, offline support (`sw.js`), Install button
- [x] 7. Plan trip: direct buses from a stop, "near me" or a favourite, with live ride times (GPS-matched) and arrival time
- [ ] 8. On-board mode
- [ ] 9. Multi-transfer routing via OneMap (needs a serverless function)

## Data sources
- Live arrivals: `https://arrivelah2.busrouter.sg/?id=<stopCode>`
- Static network data: `https://data.busrouter.sg/v1/`
