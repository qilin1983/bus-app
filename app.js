// Bus Arrivals
// Step 1: see when the next buses arrive at a stop.
// Step 2: crowd dots and auto-refresh.
// Step 3: one search box (stop code, bus number or stop name) and "Stops near me".
// Step 4: favourites with an icon and name, shown with live times on the home screen.

const API_URL = 'https://arrivelah2.busrouter.sg/?id=';
const DATA_URL = 'https://data.busrouter.sg/v1/';

// Grab the page elements we need once, at the start
const form = document.getElementById('search-form');
const input = document.getElementById('search');
const homeButton = document.getElementById('home');
const nearbyButton = document.getElementById('nearby');
const statusEl = document.getElementById('status');
const viewEl = document.getElementById('view');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Download a URL and turn the JSON into a JavaScript object.
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Server error ' + response.status);
  }
  return response.json();
}

// Make text safe to put inside HTML, so a name like "Blk 1 <A>" can't break the page.
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Straight-line distance in metres between two points on Earth (the "haversine" formula).
function distanceMetres(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

function formatDistance(metres) {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

// Sort bus numbers like "2, 15, 150, 854e" instead of "15, 150, 2"
function compareServiceNumbers(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

// ---------------------------------------------------------------------------
// Bus network data (all stops and all services), downloaded once at start-up
// ---------------------------------------------------------------------------

// stops:    { "83139": { code, name, road, lat, lng }, ... }       (about 5,200 stops)
// services: { "15": { name: "A ⇄ B", routes: [[stop codes in order], [other direction]] }, ... }
let stops = {};
let services = {};
let dataError = null;

async function loadNetworkData() {
  // Download both files at the same time
  const [stopsRaw, servicesRaw] = await Promise.all([
    fetchJson(DATA_URL + 'stops.min.json'),
    fetchJson(DATA_URL + 'services.min.json'),
  ]);

  // The stops file stores each stop as a short array: [lng, lat, name, road].
  // Turn it into objects with names, which are easier to read in the rest of the code.
  for (const [code, [lng, lat, name, road]] of Object.entries(stopsRaw)) {
    stops[code] = { code, name, road, lat, lng };
  }
  services = servicesRaw;
}

// Start downloading straight away. Anything that needs the data does `await dataReady` first.
const dataReady = loadNetworkData().catch((error) => {
  dataError = error;
});

function stopName(code) {
  return stops[code] ? stops[code].name : `Stop ${code}`;
}

// ---------------------------------------------------------------------------
// First and last bus times (step 5)
// ---------------------------------------------------------------------------

// firstLast: { "83139": ["15 0544 2347 0543 2348 0543 2343", ...], ... }
// Each row is: bus, then first and last bus times for weekdays, Saturdays, Sundays & public holidays.
//   "="  means "same as weekdays"      "-"  means no service that day
// This file is bigger (about 900 KB), so it loads in the background and never holds up the app.
let firstLast = null;

fetchJson(DATA_URL + 'firstlast.min.json')
  .then((data) => {
    firstLast = data;
    // Redraw the current screen so the badges appear without waiting 20 seconds
    if (refreshScreen) refreshScreen();
  })
  .catch(() => {
    // Not essential: the app works without last-bus badges
  });

// Buses run past midnight, so a "service day" runs from 3am to 3am.
// Times are counted in minutes from the start of the service day's date: 23:45 is 1425,
// and 00:30 the next night is 1470 (24 × 60 + 30).
const DAY_START_MINUTES = 3 * 60;

function timeToMinutes(hhmm) {
  const minutes = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
  return minutes < DAY_START_MINUTES ? minutes + 24 * 60 : minutes;
}

// "0044" -> "00:44", "2400" -> "00:00"
function formatTime(hhmm) {
  const hours = Number(hhmm.slice(0, 2)) % 24;
  return `${String(hours).padStart(2, '0')}:${hhmm.slice(2)}`;
}

// Work out which service day it is, and how far into it we are.
function serviceDayNow(now) {
  let minutes = now.getHours() * 60 + now.getMinutes();
  const day = new Date(now);
  if (minutes < DAY_START_MINUTES) {
    // Before 3am still counts as the previous day's service (e.g. Friday night's last bus)
    day.setDate(day.getDate() - 1);
    minutes += 24 * 60;
  }
  const weekday = day.getDay(); // 0 = Sunday, 6 = Saturday
  const dayType = weekday === 0 ? 'sun' : weekday === 6 ? 'sat' : 'weekday';
  return { minutes, dayType };
}

// The first and last bus for one service at one stop today, or null if unknown.
// Returns e.g. { first: "0544", last: "2347" }, or { none: true } if it doesn't run today.
function todaysTimes(stopCode, serviceNo, now) {
  if (!firstLast || !firstLast[stopCode]) return null;

  const { dayType } = serviceDayNow(now);
  const column = { weekday: 1, sat: 3, sun: 5 }[dayType];

  const options = firstLast[stopCode]
    .map((row) => row.split(' '))
    .filter((parts) => parts[0] === serviceNo)
    .map((parts) => {
      let first = parts[column];
      let last = parts[column + 1];
      if (first === '=') first = parts[1]; // same as weekdays
      if (last === '=') last = parts[2];
      return { first, last };
    });

  if (options.length === 0) return null;
  const running = options.filter((t) => /^\d{4}$/.test(t.first) && /^\d{4}$/.test(t.last));
  if (running.length === 0) return { none: true };

  if (running.length === 1) return running[0];

  // Some services have two rows at one stop:
  // - Mostly at an interchange where the route starts: one row is buses *leaving*, the other
  //   is buses *arriving to end their trip*. You can only board the leaving ones, which are
  //   the row with the earlier first bus (buses leave the interchange before any arrive back).
  // - Otherwise the route passes the stop twice and both can be boarded; use the later last bus.
  const service = services[serviceNo];
  const routeStartsHere = service && service.routes.some((route) => route[0] === stopCode);
  if (routeStartsHere) {
    running.sort((a, b) => timeToMinutes(a.first) - timeToMinutes(b.first));
  } else {
    running.sort((a, b) => timeToMinutes(b.last) - timeToMinutes(a.last));
  }
  return running[0];
}

// How long before the last bus we start warning
const LAST_BUS_WARNING_MINUTES = 30;

// A small label under the bus number, e.g. "Last 23:47" or "Last bus in 12 min".
function lastBusBadge(stopCode, serviceNo, now = new Date()) {
  const times = todaysTimes(stopCode, serviceNo, now);
  if (!times) return '';
  if (times.none) return '<span class="badge badge-off">No service today</span>';

  const nowMinutes = serviceDayNow(now).minutes;
  const first = timeToMinutes(times.first);
  const last = timeToMinutes(times.last);

  if (nowMinutes < first) {
    return `<span class="badge">First ${formatTime(times.first)}</span>`;
  }
  if (nowMinutes > last) {
    return `<span class="badge badge-off">Ended · last ${formatTime(times.last)}</span>`;
  }
  const minutesLeft = last - nowMinutes;
  if (minutesLeft <= LAST_BUS_WARNING_MINUTES) {
    return `<span class="badge badge-warn">Last bus ${formatTime(times.last)} · ${minutesLeft} min</span>`;
  }
  return `<span class="badge">Last ${formatTime(times.last)}</span>`;
}

// Every bus service that calls at a stop, according to the route data.
function servicesAtStop(code) {
  return Object.keys(services)
    .filter((no) => services[no].routes.some((route) => route.includes(code)))
    .sort(compareServiceNumbers);
}

// ---------------------------------------------------------------------------
// Switching screens and auto-refresh
// ---------------------------------------------------------------------------

// Every time we show a new screen, `screenId` goes up by one. Slow downloads remember the
// id they started with, and if it has changed by the time they finish, the user has moved on,
// so they don't draw over the new screen.
let screenId = 0;

// Screens with live times (a stop's arrivals, the favourites home screen) refresh every
// 20 seconds. The API caches data for 15 seconds, so refreshing faster shows nothing newer.
const REFRESH_MS = 20000;
let refreshTimer = null;
let refreshScreen = null;

// Call this at the start of every screen. Pass a function to re-run every 20 seconds,
// or nothing for screens that don't need refreshing.
function changeScreen(refresh = null) {
  screenId++;
  clearInterval(refreshTimer);
  refreshScreen = refresh;
  if (refresh) {
    refreshTimer = setInterval(() => {
      // Skip refreshing while the tab is hidden, to save battery and data
      if (!document.hidden) refresh();
    }, REFRESH_MS);
  }
  return screenId;
}

// When the user comes back to the tab, refresh straight away instead of waiting
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && refreshScreen) refreshScreen();
});

// Remembers how to redraw the last list screen, so the arrivals screen can offer "Back"
let lastList = null;
let backTo = null;

function backButton() {
  return backTo ? '<button class="back" type="button" data-back>← Back</button>' : '';
}

// ---------------------------------------------------------------------------
// Favourites (step 4), saved in this browser with localStorage
// ---------------------------------------------------------------------------

// Each favourite looks like:
//   { stop: "83139", icon: "home", label: "Home", services: ["15", "150"] }
// An empty `services` list means "show every bus at this stop".
const FAVOURITES_KEY = 'bus-app:favourites';

const ICONS = {
  home: { emoji: '🏠', name: 'Home' },
  work: { emoji: '💼', name: 'Work' },
  play: { emoji: '🎡', name: 'Play' },
};

// localStorage can be unavailable (e.g. some private browsing modes), so never let it crash the app
function loadFavourites() {
  try {
    return JSON.parse(localStorage.getItem(FAVOURITES_KEY)) || [];
  } catch {
    return [];
  }
}

function storeFavourites(favourites) {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites));
    return true;
  } catch {
    return false;
  }
}

function findFavourite(stopCode) {
  return loadFavourites().find((fav) => fav.stop === stopCode);
}

// Add a new favourite, or update the one already saved for this stop.
function saveFavourite(stopCode, { icon, label, services: chosen }) {
  const favourites = loadFavourites();
  const index = favourites.findIndex((fav) => fav.stop === stopCode);
  // No bus choice made (null): keep the buses already saved, or show every bus if new
  const keptServices = index >= 0 ? favourites[index].services : [];
  const favourite = {
    stop: stopCode,
    icon: ICONS[icon] ? icon : 'home',
    label: label.trim() || ICONS[icon].name,
    services: chosen === null ? keptServices : chosen,
  };
  if (index >= 0) {
    favourites[index] = favourite;
  } else {
    favourites.push(favourite);
  }
  return storeFavourites(favourites);
}

function removeFavourite(stopCode) {
  return storeFavourites(loadFavourites().filter((fav) => fav.stop !== stopCode));
}

// ---------------------------------------------------------------------------
// Live arrivals (steps 1 and 2)
// ---------------------------------------------------------------------------

// How full a bus is. The API sends one of these three codes in `bus.load`.
const LOAD_LEVELS = {
  SEA: { label: 'Seats available', className: 'load-seats' },
  SDA: { label: 'Standing available', className: 'load-standing' },
  LSD: { label: 'Limited standing', className: 'load-full' },
};

// Ask the API for arrivals at one bus stop.
// Returns an array of services, e.g. [{ no: "15", next: {...}, subsequent: {...}, next3: {...} }]
async function fetchArrivals(stopCode) {
  const data = await fetchJson(API_URL + stopCode);
  // The API reports some errors inside a normal-looking response
  if (data.error) {
    throw new Error(data.error);
  }
  return data.services;
}

// A small coloured dot showing how crowded the bus is.
function crowdDot(bus) {
  const level = LOAD_LEVELS[bus.load];
  if (!level) return ''; // unknown code: show no dot rather than a wrong one
  return `<span class="dot ${level.className}" title="${level.label}" aria-label="${level.label}"></span>`;
}

// Turn one bus's arrival info into text like "Arr" or "5".
function minutesAway(bus) {
  const minutes = Math.floor(bus.duration_ms / 60000);
  return minutes <= 0 ? 'Arr' : String(minutes);
}

// Build the HTML for one bus service row at a stop.
function renderService(service, stopCode, highlightNo) {
  // Each service has up to 3 upcoming buses; some may be missing late at night
  const buses = [service.next, service.subsequent, service.next3].filter(Boolean);

  const etas = buses.map((bus) => {
    const text = minutesAway(bus);
    const unit = text === 'Arr' ? '' : 'min';
    return `<div class="eta"><strong>${text}</strong><small>${crowdDot(bus)}${unit}</small></div>`;
  }).join('');

  const highlight = service.no === highlightNo ? ' highlight' : '';
  return `
    <li class="service${highlight}">
      <div class="service-info">
        <span class="service-no">${escapeHtml(service.no)}</span>
        ${lastBusBadge(stopCode, service.no)}
      </div>
      <div class="etas">${etas || '<small>No buses right now</small>'}</div>
    </li>`;
}

const LEGEND = `
  <p class="legend">
    <span><span class="dot load-seats"></span>Seats</span>
    <span><span class="dot load-standing"></span>Standing</span>
    <span><span class="dot load-full"></span>Limited standing</span>
  </p>`;

// Open a stop's arrivals screen and keep it refreshing.
function openStop(stopCode, highlightNo = null) {
  const id = changeScreen(() => showArrivals(id, stopCode, highlightNo, true));
  showArrivals(id, stopCode, highlightNo, false);
}

// Load and display arrivals for one stop.
// On a refresh we keep the old results on screen until the new ones arrive,
// so the list doesn't flash empty every 20 seconds.
async function showArrivals(id, stopCode, highlightNo, isRefresh) {
  if (!isRefresh) {
    statusEl.textContent = 'Loading…';
    viewEl.innerHTML = '';
  }

  try {
    const arrivals = await fetchArrivals(stopCode);
    if (id !== screenId) return; // the user has moved on to another screen

    const stop = stops[stopCode];
    const favButton = findFavourite(stopCode)
      ? '★ Edit favourite'
      : '☆ Save as favourite';
    const heading = `
      ${backButton()}
      <h2>${escapeHtml(stopName(stopCode))}</h2>
      <p class="subtitle">${stopCode}${stop ? ' · ' + escapeHtml(stop.road) : ''}</p>
      <button class="secondary fav-toggle" type="button" data-edit-favourite="${stopCode}"
              data-service="${escapeHtml(highlightNo || '')}">${favButton}</button>`;

    if (arrivals.length === 0) {
      viewEl.innerHTML = heading;
      statusEl.textContent = `No buses found for stop ${stopCode}. Check the code, or services may have ended for the night.`;
      return;
    }

    // Put the highlighted bus (if any) at the top, then the rest in number order
    arrivals.sort((a, b) => compareServiceNumbers(a.no, b.no));
    arrivals.sort((a, b) => (b.no === highlightNo) - (a.no === highlightNo));

    viewEl.innerHTML = heading +
      `<ul class="list">${arrivals.map((s) => renderService(s, stopCode, highlightNo)).join('')}</ul>` +
      LEGEND;
    statusEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    if (id !== screenId) return;
    // `navigator.onLine` is only a hint (it can say "online" on a dead connection),
    // so the fallback message mentions the connection too
    statusEl.textContent = navigator.onLine
      ? 'Could not load arrivals. Check your connection and try again.'
      : 'You\'re offline. Live times will appear when you reconnect.';
  }
}

// ---------------------------------------------------------------------------
// Home screen: every favourite with its live times (step 4)
// ---------------------------------------------------------------------------

function showHome() {
  const id = changeScreen(() => renderHome(id, true));
  backTo = null;
  lastList = showHome;
  renderHome(id, false);
}

async function renderHome(id, isRefresh) {
  const favourites = loadFavourites();

  if (favourites.length === 0) {
    viewEl.innerHTML = `
      <div class="empty">
        <p><strong>No favourites yet</strong></p>
        <p>Search for a stop, then tap <strong>☆ Save as favourite</strong> to pin it here
           with a Home, Work or Play icon.</p>
      </div>`;
    statusEl.textContent = '';
    return;
  }

  if (!isRefresh) {
    // Clear the previous screen straight away, so its buttons can't be tapped while we load
    viewEl.innerHTML = '';
    statusEl.textContent = 'Loading your favourites…';
  }
  await dataReady; // for stop names

  // Fetch every favourite stop at the same time. If one fails, the others still show.
  const results = await Promise.all(favourites.map((fav) =>
    fetchArrivals(fav.stop).catch(() => null)
  ));
  if (id !== screenId) return;

  viewEl.innerHTML = favourites.map((fav, i) => favouriteCard(fav, results[i])).join('') + LEGEND;
  statusEl.textContent = results.every((r) => r === null)
    ? 'Couldn\'t load live times. Check your connection. Retrying every 20 seconds.'
    : `Updated ${new Date().toLocaleTimeString()}`;
}

// One card on the home screen: icon, name, stop, then the chosen buses' times.
function favouriteCard(fav, arrivals) {
  const icon = ICONS[fav.icon] || ICONS.home;

  let rows;
  if (arrivals === null) {
    rows = '<p class="card-note">Couldn\'t load times. Will retry shortly.</p>';
  } else {
    // Only the buses this favourite cares about (or all of them if none were chosen).
    // A chosen bus that isn't in the live data (e.g. not running now) still gets a row.
    const wanted = fav.services.length ? fav.services : arrivals.map((s) => s.no);
    const shown = wanted
      .slice()
      .sort(compareServiceNumbers)
      .map((no) => arrivals.find((s) => s.no === no) || { no });
    rows = shown.length
      ? `<ul class="list">${shown.map((s) => renderService(s, fav.stop)).join('')}</ul>`
      : '<p class="card-note">No buses right now.</p>';
  }

  return `
    <section class="fav-card">
      <button class="fav-head" type="button" data-stop="${fav.stop}" data-service="">
        <span class="fav-icon" aria-hidden="true">${icon.emoji}</span>
        <span>
          <span class="fav-label">${escapeHtml(fav.label)}</span>
          <span class="stop-meta">${escapeHtml(stopName(fav.stop))} · ${fav.stop}</span>
        </span>
      </button>
      ${rows}
    </section>`;
}

// ---------------------------------------------------------------------------
// Save / edit favourite screen (step 4)
// ---------------------------------------------------------------------------

async function showFavouriteForm(stopCode, highlightNo) {
  const id = changeScreen();
  viewEl.innerHTML = '';
  statusEl.textContent = 'Loading…';

  // The list of buses at this stop comes from the network data, so wait for it
  await dataReady;
  if (id !== screenId) return; // the user has moved on to another screen

  const existing = findFavourite(stopCode);
  const atStop = servicesAtStop(stopCode);

  // Which icon and buses start ticked: the saved ones when editing; otherwise the bus
  // the user came from (if any), or every bus.
  const icon = existing ? existing.icon : 'home';
  const label = existing ? existing.label : ICONS.home.name;
  let ticked;
  if (existing) {
    ticked = existing.services.length ? existing.services : atStop;
  } else {
    ticked = highlightNo ? [highlightNo] : atStop;
  }

  const iconChoices = Object.entries(ICONS).map(([key, { emoji, name }]) => `
    <label class="icon-choice">
      <input type="radio" name="icon" value="${key}"${key === icon ? ' checked' : ''}>
      <span aria-hidden="true">${emoji}</span> ${name}
    </label>`).join('');

  const busChoices = atStop.length
    ? atStop.map((no) => `
        <label class="bus-choice">
          <input type="checkbox" name="service" value="${escapeHtml(no)}"${ticked.includes(no) ? ' checked' : ''}>
          ${escapeHtml(no)}
        </label>`).join('')
    : `<p class="card-note">Bus list unavailable. ${existing
        ? 'Your saved buses will be kept.'
        : 'Every bus at this stop will be shown.'}</p>`;

  viewEl.innerHTML = `
    <h2>${existing ? 'Edit favourite' : 'Save as favourite'}</h2>
    <p class="subtitle">${escapeHtml(stopName(stopCode))} · ${stopCode}</p>

    <form class="fav-form" data-stop="${stopCode}" data-highlight="${escapeHtml(highlightNo || '')}">
      <fieldset>
        <legend>Icon</legend>
        <div class="choices">${iconChoices}</div>
      </fieldset>

      <label for="fav-label">Name</label>
      <input id="fav-label" name="label" maxlength="30" value="${escapeHtml(label)}"
             placeholder="e.g. Mum's place">

      <fieldset>
        <legend>Buses to show</legend>
        <div class="choices">${busChoices}</div>
        <p class="hint">Tick the buses you take. Tick none to show every bus.</p>
      </fieldset>

      <div class="row">
        <button type="submit">Save</button>
        <button class="secondary" type="button" data-cancel>Cancel</button>
      </div>
      ${existing ? '<button class="danger" type="button" data-remove>Remove favourite</button>' : ''}
    </form>`;
  statusEl.textContent = '';
}

// Read what the user picked in the favourite form.
// `services` is null when there were no bus checkboxes (bus list unavailable),
// meaning "keep whatever was saved before".
function readFavouriteForm(formEl) {
  const icon = formEl.querySelector('input[name="icon"]:checked').value;
  const label = formEl.querySelector('input[name="label"]').value;
  const boxes = [...formEl.querySelectorAll('input[name="service"]')];
  if (boxes.length === 0) return { icon, label, services: null };
  let chosen = boxes.filter((box) => box.checked).map((box) => box.value);
  // All ticked means "every bus", so new services at this stop show up automatically too
  if (chosen.length === boxes.length) chosen = [];
  return { icon, label, services: chosen };
}

// ---------------------------------------------------------------------------
// List screens: stop search results, a bus's route, and nearby stops (step 3)
// ---------------------------------------------------------------------------

// One tappable row in a list of stops. `detail` is extra text such as "120 m" or "Stop 3".
// `serviceNo` is set when the list is a bus route, so that bus gets highlighted on the next screen.
function stopItem(code, detail = '', serviceNo = '') {
  const stop = stops[code];
  const meta = [detail, code, stop && stop.road].filter(Boolean).map(escapeHtml).join(' · ');
  const star = findFavourite(code) ? '<span class="star" title="Favourite">★</span>' : '';
  return `
    <li>
      <button class="stop-item" type="button" data-stop="${code}" data-service="${escapeHtml(serviceNo)}">
        <span class="stop-name">${escapeHtml(stopName(code))}${star}</span>
        <span class="stop-meta">${meta}</span>
      </button>
    </li>`;
}

// Show every stop on one bus route, in order, for one direction.
function showService(serviceNo, directionIndex = 0) {
  changeScreen();
  const service = services[serviceNo];
  const route = service.routes[directionIndex];

  // Buses that run between two ends have two directions; loop services have one.
  // Label each direction by its final stop, e.g. "To Marine Pde Stn Exit 2".
  let tabs = '';
  if (service.routes.length > 1) {
    tabs = '<div class="tabs">' + service.routes.map((r, i) => `
      <button class="tab${i === directionIndex ? ' active' : ''}" type="button"
              data-service-no="${escapeHtml(serviceNo)}" data-direction="${i}">
        To ${escapeHtml(stopName(r[r.length - 1]))}
      </button>`).join('') + '</div>';
  }

  viewEl.innerHTML = `
    <h2>Bus ${escapeHtml(serviceNo)}</h2>
    <p class="subtitle">${escapeHtml(service.name)}</p>
    ${tabs}
    <ul class="list">
      ${route.map((code, i) => stopItem(code, `Stop ${i + 1}`, serviceNo)).join('')}
    </ul>`;
  statusEl.textContent = `${route.length} stops. Tap one to see arrivals.`;
  lastList = () => showService(serviceNo, directionIndex);
}

// Find stops whose name, road or code matches the search text.
// Names that *start* with the text come first, since they're usually what people mean.
function searchStops(text) {
  const needle = text.toLowerCase();
  const startsWith = [];
  const contains = [];

  for (const stop of Object.values(stops)) {
    const name = stop.name.toLowerCase();
    if (name.startsWith(needle)) {
      startsWith.push(stop);
    } else if (name.includes(needle) || stop.road.toLowerCase().includes(needle) || stop.code.startsWith(needle)) {
      contains.push(stop);
    }
  }
  return [...startsWith, ...contains].slice(0, 30);
}

function showStopMatches(text) {
  changeScreen();
  const matches = searchStops(text);

  if (matches.length === 0) {
    viewEl.innerHTML = '';
    statusEl.textContent = `No stops or bus services match "${text}".`;
    return;
  }

  viewEl.innerHTML = `<ul class="list">${matches.map((s) => stopItem(s.code)).join('')}</ul>`;
  statusEl.textContent = matches.length === 30
    ? 'Showing the first 30 matches. Type more to narrow it down.'
    : `${matches.length} matching stop${matches.length === 1 ? '' : 's'}`;
  lastList = () => showStopMatches(text);
}

// Look up a bus service number, ignoring upper/lower case (so "854E" finds "854e")
function findService(text) {
  const wanted = text.toLowerCase();
  return Object.keys(services).find((no) => no.toLowerCase() === wanted);
}

// Decide what the user typed and show the right screen.
async function handleSearch(query) {
  const text = query.trim();
  if (!text) return;
  backTo = null;

  // 1. Five digits: a bus stop code. This works even if the stop data hasn't loaded.
  if (/^\d{5}$/.test(text)) {
    openStop(text);
    return;
  }

  // The other two kinds of search need the network data.
  // Switch screens first, so if the user taps elsewhere while it loads, we don't jump back here.
  const id = changeScreen();
  viewEl.innerHTML = '';
  statusEl.textContent = 'Loading bus data…';
  await dataReady;
  if (id !== screenId) return; // the user has moved on to another screen
  if (dataError) {
    statusEl.textContent = 'Could not load bus stop data, so only 5-digit stop codes work right now. Try reloading the page.';
    return;
  }

  // 2. An exact bus service number, e.g. 15, 854e, 2B
  const serviceNo = findService(text);
  if (serviceNo) {
    showService(serviceNo);
    return;
  }

  // 3. Anything else: search stop names and roads
  showStopMatches(text);
}

// ---------------------------------------------------------------------------
// Stops near me (step 3)
// ---------------------------------------------------------------------------

const NEARBY_COUNT = 8;

// Ask the browser for the user's location. Returns a Promise, so it can be used with `await`.
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

function locationErrorMessage(error) {
  if (error.message === 'unsupported') {
    return 'Your browser can\'t share your location. Try searching by name instead.';
  }
  return error.code === 1 // 1 = permission denied
    ? 'Location access is blocked. Allow it for this page in your browser settings, or search by name instead.'
    : 'Couldn\'t get your location. Try again, or search by name instead.';
}

async function findNearby() {
  const id = changeScreen();
  viewEl.innerHTML = '';
  statusEl.textContent = 'Finding your location…';

  let position;
  try {
    position = await getPosition();
  } catch (error) {
    if (id === screenId) statusEl.textContent = locationErrorMessage(error);
    return;
  }

  await dataReady;
  if (id !== screenId) return;
  if (dataError) {
    statusEl.textContent = 'Could not load bus stop data. Try reloading the page.';
    return;
  }
  showNearby(position.coords.latitude, position.coords.longitude);
}

function showNearby(lat, lng) {
  changeScreen();
  // Work out the distance to every stop, then keep the closest few.
  // 5,200 distance sums take a few milliseconds, so there's no need for anything cleverer.
  const nearest = Object.values(stops)
    .map((stop) => ({ stop, metres: distanceMetres(lat, lng, stop.lat, stop.lng) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, NEARBY_COUNT);

  backTo = null;
  viewEl.innerHTML = `<ul class="list">${nearest.map((n) => stopItem(n.stop.code, formatDistance(n.metres))).join('')}</ul>`;
  statusEl.textContent = nearest[0].metres > 5000
    ? 'You seem to be far from any Singapore bus stop. These are the closest ones.'
    : 'Nearest stops. Tap one to see arrivals.';
  lastList = () => showNearby(lat, lng);
}

// ---------------------------------------------------------------------------
// Trip search: direct buses from A to B, with live ride times (step 7)
// ---------------------------------------------------------------------------

// Measured from live data: buses cover about 240 m of straight-line stop-to-stop distance
// per minute, including time spent at stops. Used when we can't measure the ride live.
const BUS_METRES_PER_MIN = 240;
// Walking: about 80 m a minute, plus a bit extra because streets aren't straight lines
const WALK_METRES_PER_MIN = 80;
const WALK_DETOUR = 1.25;
// From "near me", consider any stop within this distance
const ORIGIN_RADIUS = 400;
// Also accept getting off at a stop this close to the destination (e.g. across the road)
const DESTINATION_RADIUS = 300;
const MAX_TRIP_OPTIONS = 8;

function walkMinutes(metres) {
  return Math.ceil((metres * WALK_DETOUR) / WALK_METRES_PER_MIN);
}

// "14:52", matching the 24-hour times in the last-bus badges
function clockTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// The trip being planned.
//   from: { kind: 'near', lat, lng } for "my location", or { kind: 'stop', code }
//   to:   a stop code
let trip = { from: null, to: null };

function tripFromText() {
  if (!trip.from) return 'Not set';
  return trip.from.kind === 'near' ? 'Your location' : `${stopName(trip.from.code)} (${trip.from.code})`;
}

function tripToText() {
  return trip.to ? `${stopName(trip.to)} (${trip.to})` : 'Not set';
}

// All stops within `radius` metres of a point, closest first, with their distance
function stopsWithin(lat, lng, radius) {
  return Object.values(stops)
    .map((stop) => ({ code: stop.code, metres: distanceMetres(lat, lng, stop.lat, stop.lng) }))
    .filter((s) => s.metres <= radius)
    .sort((a, b) => a.metres - b.metres);
}

// Where the user could get on: one chosen stop, or every stop within walking distance
function boardingStops() {
  if (trip.from.kind === 'stop') return [{ code: trip.from.code, metres: 0 }];
  return stopsWithin(trip.from.lat, trip.from.lng, ORIGIN_RADIUS).slice(0, 12);
}

// Where the user could get off: the destination stop (0 m) and any stops close to it
function alightingStops() {
  const dest = stops[trip.to];
  return stopsWithin(dest.lat, dest.lng, DESTINATION_RADIUS).slice(0, 8);
}

// Straight-line distance along a route, from stop number `from` to stop number `to`
function routeMetres(route, from, to) {
  let metres = 0;
  for (let k = from; k < to; k++) {
    const a = stops[route[k]];
    const b = stops[route[k + 1]];
    if (a && b) metres += distanceMetres(a.lat, a.lng, b.lat, b.lng);
  }
  return metres;
}

// Find every bus service that goes from one of the boarding stops to one of the alighting
// stops without changing buses. For each service and direction we keep the best pair of stops.
function findDirectOptions(boarding, alighting) {
  const walkTo = new Map(boarding.map((s) => [s.code, s.metres]));
  const walkFrom = new Map(alighting.map((s) => [s.code, s.metres]));
  const options = [];

  for (const [no, service] of Object.entries(services)) {
    service.routes.forEach((route, direction) => {
      let best = null;

      route.forEach((boardCode, i) => {
        if (!walkTo.has(boardCode)) return;
        // Look at every later stop on the route where we could get off
        for (let j = i + 1; j < route.length; j++) {
          const alightCode = route[j];
          if (!walkFrom.has(alightCode) || alightCode === boardCode) continue;

          const estRide = routeMetres(route, i, j) / BUS_METRES_PER_MIN;
          const estimate = walkMinutes(walkTo.get(boardCode)) + estRide + walkMinutes(walkFrom.get(alightCode));
          if (!best || estimate < best.estimate) {
            best = {
              no, board: boardCode, alight: alightCode, stopCount: j - i,
              walkTo: walkTo.get(boardCode), walkFrom: walkFrom.get(alightCode),
              estRide, estimate,
            };
          }
        }
      });

      if (best) options.push(best);
    });
  }

  return options.sort((a, b) => a.estimate - b.estimate);
}

// False if the timetable says this bus doesn't run at this stop today, or has finished for
// the night. True if it's running, or if we don't know (timetable not loaded yet).
function runsNow(stopCode, serviceNo, now = new Date()) {
  const times = todaysTimes(stopCode, serviceNo, now);
  if (!times) return true;
  if (times.none) return false;
  return serviceDayNow(now).minutes <= timeToMinutes(times.last);
}

function busesOf(service) {
  return service ? [service.next, service.subsequent, service.next3].filter(Boolean) : [];
}

// The arrival API has no bus ID, but a tracked bus reports the same GPS position in every
// stop's data, so matching positions tells us it's the same bus.
function sameBus(a, b) {
  return a.monitored === 1 && b.monitored === 1 && a.lat !== 0 && a.lat === b.lat && a.lng === b.lng;
}

// Fill in live details for each option: the first bus the user can walk to in time,
// the ride time (measured live if possible), and the arrival time at the destination.
async function addLiveTimes(options) {
  // Download arrivals for every stop involved, all at the same time
  const codes = [...new Set(options.flatMap((o) => [o.board, o.alight]))];
  const results = await Promise.all(codes.map((code) =>
    fetchArrivals(code).then((arrivals) => [code, arrivals]).catch(() => [code, null])
  ));
  const arrivalsAt = Object.fromEntries(results);

  for (const option of options) {
    const atBoard = arrivalsAt[option.board] && arrivalsAt[option.board].find((s) => s.no === option.no);
    const atAlight = arrivalsAt[option.alight] && arrivalsAt[option.alight].find((s) => s.no === option.no);
    const boardBuses = busesOf(atBoard);
    const alightBuses = busesOf(atAlight);

    // The first bus that arrives after the user can walk to the stop
    const walk = walkMinutes(option.walkTo);
    option.boardBus = boardBuses.find((bus) => bus.duration_ms / 60000 >= walk) || null;
    option.liveUnavailable = arrivalsAt[option.board] === null;

    // Live ride time: the same bus's arrival time at the get-off stop minus at the boarding stop
    option.liveRide = null;
    for (const bus of [option.boardBus, ...boardBuses].filter(Boolean)) {
      const later = alightBuses.find((b) => sameBus(bus, b) && Date.parse(b.time) > Date.parse(bus.time));
      if (later) {
        option.liveRide = (Date.parse(later.time) - Date.parse(bus.time)) / 60000;
        break;
      }
    }
    option.ride = option.liveRide !== null ? option.liveRide : option.estRide;

    option.arriveAt = option.boardBus
      ? Date.parse(option.boardBus.time) + (option.ride + walkMinutes(option.walkFrom)) * 60000
      : null;
  }

  // Soonest arrival first; options with no catchable bus go last
  options.sort((a, b) => (a.arriveAt || Infinity) - (b.arriveAt || Infinity) || a.estimate - b.estimate);
}

function tripCard(option) {
  const rideText = option.liveRide !== null
    ? `Ride ${Math.round(option.ride)} min <span class="live">live</span>`
    : `Ride ~${Math.round(option.ride)} min`;

  let when;
  if (option.boardBus) {
    const mins = minutesAway(option.boardBus);
    when = mins === 'Arr' ? 'Bus arriving now' : `Bus in ${mins} min`;
  } else if (option.liveUnavailable) {
    when = 'Live times unavailable';
  } else {
    when = 'No bus you can catch soon';
  }

  const walkStart = option.walkTo > 0 ? ` · ${walkMinutes(option.walkTo)} min walk` : '';
  const walkEnd = option.walkFrom > 0 ? `, then ${walkMinutes(option.walkFrom)} min walk` : '';

  return `
    <li>
      <button class="trip-card" type="button" data-stop="${option.board}" data-service="${escapeHtml(option.no)}">
        <span class="trip-top">
          <span class="service-no">${escapeHtml(option.no)}</span>
          <span class="trip-arrive">${option.arriveAt ? 'Arrive ' + clockTime(option.arriveAt) : '–'}</span>
        </span>
        <span class="trip-line"><strong>${when}</strong>${crowdText(option.boardBus)} at
          ${escapeHtml(stopName(option.board))}${walkStart}</span>
        <span class="trip-line">${rideText} · ${option.stopCount} stop${option.stopCount === 1 ? '' : 's'}
          to ${escapeHtml(stopName(option.alight))}${walkEnd}</span>
        ${lastBusBadge(option.board, option.no)}
      </button>
    </li>`;
}

// The crowd dot for the bus the user would catch (nothing if there's no bus)
function crowdText(bus) {
  return bus ? ' ' + crowdDot(bus) : '';
}

// Open the planner from the top bar. Stop search needs the network data, so wait for it.
async function openTripPlanner() {
  const id = changeScreen();
  viewEl.innerHTML = '';
  statusEl.textContent = 'Loading bus data…';
  await dataReady;
  if (id !== screenId) return;
  if (dataError) {
    statusEl.textContent = 'Could not load bus data. Try reloading the page.';
    return;
  }
  showTripPlanner();
}

// --- The planner screen: choose From and To ---

// `picker` is set while the user is searching for a stop: { field: 'from' | 'to', query }
function showTripPlanner(picker = null) {
  changeScreen();
  const favourites = loadFavourites();

  // Quick picks: the user's favourites, e.g. "🏠 Home" → "💼 Work"
  const favChips = (field) => favourites.map((fav) => `
    <button class="chip" type="button" data-trip-pick="${field}" data-code="${fav.stop}">
      ${(ICONS[fav.icon] || ICONS.home).emoji} ${escapeHtml(fav.label)}
    </button>`).join('');

  // Search results for whichever field is being searched
  const pickerResults = (field) => {
    if (!picker || picker.field !== field) return '';
    const matches = /^\d{5}$/.test(picker.query) && stops[picker.query]
      ? [stops[picker.query]]
      : searchStops(picker.query).slice(0, 10);
    if (matches.length === 0) return `<p class="card-note">No stops match "${escapeHtml(picker.query)}".</p>`;
    return `<ul class="list">${matches.map((s) => `
      <li>
        <button class="stop-item" type="button" data-trip-pick="${field}" data-code="${s.code}">
          <span class="stop-name">${escapeHtml(s.name)}</span>
          <span class="stop-meta">${s.code} · ${escapeHtml(s.road)}</span>
        </button>
      </li>`).join('')}</ul>`;
  };

  const searchBox = (field) => `
    <form class="trip-search" data-field="${field}">
      <div class="row">
        <input name="q" type="search" autocomplete="off" placeholder="Search for a stop"
               value="${picker && picker.field === field ? escapeHtml(picker.query) : ''}">
        <button type="submit">Find</button>
      </div>
    </form>`;

  const canSwap = trip.from && trip.from.kind === 'stop' && trip.to;

  viewEl.innerHTML = `
    <h2>Plan a trip</h2>
    <p class="subtitle">Direct buses only (no changing buses yet).</p>

    <section class="trip-field">
      <div class="trip-label">From</div>
      <div class="trip-value">${escapeHtml(tripFromText())}</div>
      <div class="choices">
        <button class="chip" type="button" data-trip-near>📍 Near me</button>
        ${favChips('from')}
      </div>
      ${searchBox('from')}
      ${pickerResults('from')}
    </section>

    ${canSwap ? '<button class="back" type="button" data-trip-swap>⇅ Swap</button>' : ''}

    <section class="trip-field">
      <div class="trip-label">To</div>
      <div class="trip-value">${escapeHtml(tripToText())}</div>
      <div class="choices">${favChips('to')}</div>
      ${searchBox('to')}
      ${pickerResults('to')}
    </section>

    <button class="trip-go" type="button" data-trip-go${trip.from && trip.to ? '' : ' disabled'}>
      Find buses
    </button>`;
  statusEl.textContent = '';
}

// Picking the destination (with a start already chosen) runs the search straight away.
// Picking the start stays on the planner, so both ends can be changed without a wasted search;
// the user taps "Find buses" if they only wanted to change the start.
function afterTripChange(field) {
  if (field === 'to' && trip.from) {
    planTrip();
  } else {
    showTripPlanner();
  }
}

async function useMyLocationForTrip() {
  statusEl.textContent = 'Finding your location…';
  try {
    const position = await getPosition();
    trip.from = { kind: 'near', lat: position.coords.latitude, lng: position.coords.longitude };
    afterTripChange('from');
  } catch (error) {
    statusEl.textContent = locationErrorMessage(error);
  }
}

// --- The results screen ---

function planTrip() {
  const id = changeScreen(() => renderTrip(id, true));
  backTo = null;
  lastList = planTrip;
  renderTrip(id, false);
}

async function renderTrip(id, isRefresh) {
  if (!isRefresh) {
    viewEl.innerHTML = '';
    statusEl.textContent = 'Finding direct buses…';
  }
  await dataReady;
  if (id !== screenId) return;
  if (dataError) {
    statusEl.textContent = 'Could not load bus data. Try reloading the page.';
    return;
  }

  const heading = `
    <h2>${escapeHtml(tripFromText())} → ${escapeHtml(stopName(trip.to))}</h2>
    <button class="secondary fav-toggle" type="button" data-trip-edit>Change trip</button>`;

  const boarding = boardingStops();
  if (boarding.length === 0) {
    viewEl.innerHTML = heading;
    statusEl.textContent = `No bus stops within ${ORIGIN_RADIUS} m of you.`;
    return;
  }

  const allOptions = findDirectOptions(boarding, alightingStops());
  // Hide buses that don't run today or have finished for the night, then keep the best few
  const options = allOptions
    .filter((option) => runsNow(option.board, option.no))
    .slice(0, MAX_TRIP_OPTIONS);

  if (options.length === 0) {
    viewEl.innerHTML = heading + (allOptions.length === 0
      ? `<div class="empty">
           <p><strong>No direct bus</strong></p>
           <p>This trip needs a change of bus, which the app can't plan yet.</p>
         </div>`
      : `<div class="empty">
           <p><strong>No direct bus running now</strong></p>
           <p>${allOptions.length} direct service${allOptions.length === 1 ? '' : 's'} (e.g. bus
              ${escapeHtml(allOptions[0].no)}) ${allOptions.length === 1 ? 'goes' : 'go'} there,
              but not at this time of day.</p>
         </div>`);
    statusEl.textContent = '';
    return;
  }

  await addLiveTimes(options);
  if (id !== screenId) return;

  viewEl.innerHTML = heading +
    `<ul class="list">${options.map(tripCard).join('')}</ul>` +
    '<p class="hint">"live" ride times come from tracking the actual bus; "~" times are estimates. ' +
    'Tap an option to see that stop\'s arrivals.</p>';
  statusEl.textContent = `${options.length} direct option${options.length === 1 ? '' : 's'} · updated ${new Date().toLocaleTimeString()}`;
}

// ---------------------------------------------------------------------------
// Wiring up clicks and forms
// ---------------------------------------------------------------------------

// The buttons inside the view are created and replaced all the time, so instead of adding
// a listener to each one, we listen on the whole view and check what was clicked
// (this is called "event delegation").
viewEl.addEventListener('click', (event) => {
  const target = event.target;

  const stopButton = target.closest('[data-stop]:not(form)');
  if (stopButton) {
    backTo = lastList;
    openStop(stopButton.dataset.stop, stopButton.dataset.service || null);
    return;
  }

  const directionButton = target.closest('[data-direction]');
  if (directionButton) {
    showService(directionButton.dataset.serviceNo, Number(directionButton.dataset.direction));
    return;
  }

  const favButton = target.closest('[data-edit-favourite]');
  if (favButton) {
    showFavouriteForm(favButton.dataset.editFavourite, favButton.dataset.service || null);
    return;
  }

  // Buttons inside the favourite form
  const favForm = target.closest('form.fav-form');
  if (favForm && target.closest('[data-cancel]')) {
    openStop(favForm.dataset.stop, favForm.dataset.highlight || null);
    return;
  }
  if (favForm && target.closest('[data-remove]')) {
    removeFavourite(favForm.dataset.stop);
    showHome();
    return;
  }

  // Trip planner buttons
  const pick = target.closest('[data-trip-pick]');
  if (pick) {
    const field = pick.dataset.tripPick;
    if (field === 'from') {
      trip.from = { kind: 'stop', code: pick.dataset.code };
    } else {
      trip.to = pick.dataset.code;
    }
    afterTripChange(field);
    return;
  }
  if (target.closest('[data-trip-near]')) {
    useMyLocationForTrip();
    return;
  }
  if (target.closest('[data-trip-swap]')) {
    trip = { from: { kind: 'stop', code: trip.to }, to: trip.from.code };
    planTrip();
    return;
  }
  if (target.closest('[data-trip-go]')) {
    planTrip();
    return;
  }
  if (target.closest('[data-trip-edit]')) {
    showTripPlanner();
    return;
  }

  if (target.closest('[data-back]') && backTo) {
    const goBack = backTo;
    backTo = null;
    goBack();
  }
});

// Picking an icon fills in the name, unless the user has typed their own
viewEl.addEventListener('change', (event) => {
  if (event.target.name !== 'icon') return;
  const labelInput = event.target.form.querySelector('input[name="label"]');
  const iconNames = Object.values(ICONS).map((icon) => icon.name);
  if (labelInput.value.trim() === '' || iconNames.includes(labelInput.value.trim())) {
    labelInput.value = ICONS[event.target.value].name;
  }
});

// Searching for a stop inside the trip planner
viewEl.addEventListener('submit', (event) => {
  if (!event.target.matches('form.trip-search')) return;
  event.preventDefault();
  const query = event.target.querySelector('input[name="q"]').value.trim();
  if (query) showTripPlanner({ field: event.target.dataset.field, query });
});

// Saving the favourite form
viewEl.addEventListener('submit', (event) => {
  if (!event.target.matches('form.fav-form')) return;
  event.preventDefault();
  const saved = saveFavourite(event.target.dataset.stop, readFavouriteForm(event.target));
  if (saved) {
    showHome();
  } else {
    statusEl.textContent = 'Could not save. Your browser may be blocking storage (e.g. private browsing).';
  }
});

// When the search form is submitted, search instead of reloading the page
form.addEventListener('submit', (event) => {
  event.preventDefault();
  handleSearch(input.value);
});

homeButton.addEventListener('click', showHome);
nearbyButton.addEventListener('click', findNearby);
document.getElementById('trip').addEventListener('click', openTripPlanner);

// ---------------------------------------------------------------------------
// Installable app (step 6)
// ---------------------------------------------------------------------------

// Register the service worker (sw.js), which saves the app for offline use.
// It only works on http(s) pages, not when index.html is opened straight from a folder.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Not essential: the app still works online without it
  });
}

// Chrome, Edge and Android fire `beforeinstallprompt` when the app can be installed.
// We keep hold of it and show our own "Install app" button.
// (iPhone Safari doesn't support this; there you use Share → Add to Home Screen.)
const installButton = document.getElementById('install');
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // don't show the browser's own banner; we have a button
  installPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null; // each prompt can only be used once
  installButton.hidden = true;
});

window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
});

// Start on the favourites screen
showHome();
