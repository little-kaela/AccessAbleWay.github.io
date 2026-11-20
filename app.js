const DIRECTORY_URL = "./omaha_businesses_glide.csv";
const REPORT_LIFETIME_HOURS = 72;
const STORAGE_KEYS = {
  ratings: "openway-omaha-ratings-v1",
  reports: "openway-omaha-reports-v1",
  favorites: "openway-omaha-favorites-v1",
};
const FALLBACK_PLACES = [
  { id: "sample-archetype", name: "Archetype Coffee", category: "Coffee", address: "3926 Farnam Street, Omaha, NE", city: "Omaha", status: "Accessible", lat: 41.257917, lon: -95.973071 },
  { id: "sample-legend", name: "Legend Comics & Coffee", category: "Books", address: "6068 Maple Street, Omaha, NE", city: "Omaha", status: "Accessible", lat: 41.285202, lon: -96.006928 },
  { id: "sample-roast", name: "ROAST Coffeehouse", category: "Cafe", address: "1904 South 67th Street, Omaha, NE", city: "Omaha", status: "Accessible", lat: 41.241402, lon: -96.014837 },
  { id: "sample-benson-library", name: "Benson Branch Library", category: "Library", address: "6015 Binney Street, Omaha, NE", city: "Omaha", status: "Accessible", lat: 41.2832, lon: -96.0078 },
  { id: "sample-spielbound", name: "Spielbound", category: "Cafe", address: "3229 Harney Street, Omaha, NE", city: "Omaha", status: "Accessible", lat: 41.256499, lon: -95.961202 },
  { id: "sample-common-grounds", name: "Common Grounds", category: "Cafe", address: "1600 Dodge Street, Omaha, NE", city: "Omaha", status: "Unknown", lat: 41.258926, lon: -95.938006 },
];
const CATEGORY_MATCHES = {
  food: ["restaurant", "fast food", "cafe", "coffee", "bakery", "bar", "pub", "food", "ice cream", "confectionery"],
  coffee: ["cafe", "coffee", "bakery", "tea", "restaurant"],
  outdoors: ["park", "garden", "playground", "nature", "campground", "recreation", "sports", "trail"],
  culture: ["museum", "art", "gallery", "theatre", "theater", "cinema", "music", "library", "historic", "culture"],
  shopping: ["shop", "store", "market", "clothes", "books", "department", "mall", "supermarket", "gift"],
  community: ["library", "community", "social facility", "place of worship", "government", "civic", "arts"],
};
const CATEGORY_ICONS = {
  food: "◒", cafe: "☕", coffee: "☕", culture: "✳", arts: "✳", outdoors: "⌁",
  park: "☼", library: "▤", shopping: "◈", restaurant: "♨", books: "▧",
  default: "✳",
};

const state = {
  places: [],
  ratings: {},
  reports: [],
  query: "",
  filter: "all",
  activeView: "explore",
  selectedRating: 0,
  activePlaceId: null,
};

const supabaseSettings = window.ACCESSABLE_SUPABASE || {};
const hasSupabaseConfig = Boolean(supabaseSettings.url && supabaseSettings.anonKey);
const supabaseClient = hasSupabaseConfig && window.supabase
  ? window.supabase.createClient(supabaseSettings.url, supabaseSettings.anonKey)
  : null;
if (hasSupabaseConfig && !supabaseClient) {
  console.error("Supabase is configured, but its client library did not load.");
}

const mapState = {
  community: null,
  placeMarkers: null,
  reportMarkers: null,
  picker: null,
  pickerMarker: null,
};

const elements = {
  grid: document.querySelector("#places-grid"),
  search: document.querySelector("#place-search"),
  resultsTitle: document.querySelector("#results-title"),
  resultsSubtitle: document.querySelector("#results-subtitle"),
  mapCanvas: document.querySelector("#map-canvas"),
  reportList: document.querySelector("#report-list"),
  reportCount: document.querySelector("#report-count"),
  detailDialog: document.querySelector("#detail-dialog"),
  detailContent: document.querySelector("#detail-content"),
  reportDialog: document.querySelector("#report-dialog"),
  reportForm: document.querySelector("#report-form"),
  photo: document.querySelector("#report-photo"),
  photoName: document.querySelector("#photo-name"),
  reportLocationMap: document.querySelector("#report-location-map"),
  reportLatitude: document.querySelector("#report-latitude"),
  reportLongitude: document.querySelector("#report-longitude"),
  reportCoordinates: document.querySelector("#report-coordinates"),
  useCurrentLocation: document.querySelector("#use-current-location"),
  toast: document.querySelector("#toast"),
};

function readStorage(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch (error) {
    console.error(`Could not read ${key} from local storage.`, error);
    showToast("Saved data could not be read. You can still explore places.");
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Could not save ${key} to local storage.`, error);
    showToast("This change could not be saved on this device.");
    return false;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value.length || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("The Omaha places directory did not contain any rows.");
  const headers = rows.shift();
  return rows.filter((item) => item.length >= headers.length).map((item) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, item[index] || ""]));
    const city = record.city.trim().length > 2 ? record.city.trim() : "Omaha area";
    const street = record.street.trim().length > 4 ? record.street.trim() : "";
    const address = street
      ? [
      street,
      record.city.trim().length > 2 ? record.city : "",
      [record.state, record.zip].filter(Boolean).join(" "),
      ].filter(Boolean).join(", ")
      : /^(?:NE|Nebraska)(?:\s+\d{5})?$/i.test(record.full_address.trim())
        ? ""
        : record.full_address;
    return {
      id: record.business_id,
      name: record.name,
      category: record.category || "Local place",
      address,
      city,
      status: normalizeStatus(record.wheelchair_status),
      description: record.wheelchair_description,
      lat: parseFloat(record.lat),
      lon: parseFloat(record.lon),
      website: record.website,
      phone: record.phone,
    };
  }).filter((place) => place.id && place.name);
}

function normalizeStatus(status) {
  const normalized = (status || "").trim().toLowerCase();
  if (normalized === "accessible") return "Accessible (listed)";
  if (normalized.includes("partial")) return "Partially accessible (listed)";
  if (normalized.includes("not accessible")) return "Not accessible (listed)";
  return "No access information";
}

async function loadPlaces() {
  try {
    const response = await fetch(DIRECTORY_URL);
    if (!response.ok) throw new Error(`The local directory returned ${response.status}.`);
    const csv = await response.text();
    state.places = parseCsv(csv);
  } catch (error) {
    console.error("Could not load the Omaha places directory.", error);
    state.places = FALLBACK_PLACES;
    showToast("Showing a small starter list; run the app with its local CSV to browse the full directory.");
  }
  renderPlaces();
  renderMap();
}

async function loadRatings() {
  if (!hasSupabaseConfig) {
    state.ratings = readStorage(STORAGE_KEYS.ratings, {});
    return;
  }
  if (!supabaseClient) {
    showToast("Supabase could not be initialized. Check your connection and configuration.");
    return;
  }

  let result;
  try {
    result = await supabaseClient
      .from("ratings")
      .select("place_id, rating, note, created_at")
      .order("created_at", { ascending: true });
  } catch (error) {
    console.error("Could not load shared ratings from Supabase.", error);
    showToast("Community ratings could not be loaded. Please try again later.");
    return;
  }

  if (result.error) {
    console.error("Could not load shared ratings from Supabase.", result.error);
    showToast("Community ratings could not be loaded. Please try again later.");
    return;
  }

  state.ratings = (result.data || []).reduce((ratings, entry) => {
    if (!ratings[entry.place_id]) ratings[entry.place_id] = [];
    ratings[entry.place_id].push({
      rating: entry.rating,
      note: entry.note,
      date: entry.created_at,
    });
    return ratings;
  }, {});
}

async function loadReports() {
  if (!hasSupabaseConfig) {
    const storedReports = readStorage(STORAGE_KEYS.reports, []);
    const reports = Array.isArray(storedReports) ? storedReports : [];
    state.reports = reports.filter(isActiveReport);
    if (state.reports.length !== reports.length) writeStorage(STORAGE_KEYS.reports, state.reports);
    return;
  }
  if (!supabaseClient) {
    showToast("Supabase could not be initialized. Community reports are unavailable.");
    return;
  }

  let result;
  try {
    result = await supabaseClient
      .from("reports")
      .select("id, latitude, longitude, type, location, note, created_at, expires_at")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
  } catch (error) {
    console.error("Could not load community reports from Supabase.", error);
    showToast("Community reports could not be loaded. Please try again later.");
    return;
  }

  if (result.error) {
    console.error("Could not load community reports from Supabase.", result.error);
    showToast("Community reports could not be loaded. Check that the reports table is set up.");
    return;
  }

  state.reports = (result.data || []).map((report) => ({
    id: report.id,
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    type: report.type,
    location: report.location,
    note: report.note,
    createdAt: report.created_at,
    expiresAt: report.expires_at,
  })).filter(isActiveReport);
}

function safeText(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function getRatings() {
  return state.ratings;
}

function getReports() {
  return state.reports;
}

function getFavorites() {
  return readStorage(STORAGE_KEYS.favorites, []);
}

function categoryIcon(place) {
  const category = `${place.category} ${place.name}`.toLowerCase();
  const match = Object.keys(CATEGORY_ICONS).find((key) => key !== "default" && hasCategory(category, [key]));
  return CATEGORY_ICONS[match] || CATEGORY_ICONS.default;
}

function hasCategory(text, keywords) {
  return keywords.some((keyword) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text));
}

function accessClass(status) {
  if (status.startsWith("Accessible")) return "known";
  if (status.startsWith("Partially")) return "partial";
  if (status.startsWith("Not accessible")) return "no";
  return "unknown";
}

function ratingsSummary(placeId) {
  const entries = getRatings()[placeId] || [];
  if (!entries.length) return { count: 0, average: 0 };
  const average = entries.reduce((sum, entry) => sum + Number(entry.rating), 0) / entries.length;
  return { count: entries.length, average };
}

function isInFilter(place, filter) {
  const category = `${place.category} ${place.name}`.toLowerCase();
  if (filter === "all") return true;
  if (filter === "known") return place.status !== "No access information";
  if (filter === "food") return hasCategory(category, CATEGORY_MATCHES.food);
  if (filter === "outdoors") return hasCategory(category, CATEGORY_MATCHES.outdoors);
  if (filter === "culture") return hasCategory(category, CATEGORY_MATCHES.culture);
  return true;
}

function getFilteredPlaces() {
  const query = normalizeSearchText(state.query);
  return state.places.filter((place) => {
    const searchable = normalizeSearchText(`${place.name} ${place.category} ${place.address} ${place.city}`);
    return (!query || searchable.includes(query)) && isInFilter(place, state.filter);
  });
}

function normalizeSearchText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function distanceFromDowntown(place) {
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return Infinity;
  return Math.hypot((place.lat - 41.2565) * 1.15, place.lon + 95.9345);
}

function prioritizePlaces(places) {
  return [...places].sort((a, b) => {
    const aAccessible = a.status.startsWith("Accessible") ? 1 : 0;
    const bAccessible = b.status.startsWith("Accessible") ? 1 : 0;
    const aCategory = `${a.category} ${a.name}`.toLowerCase();
    const bCategory = `${b.category} ${b.name}`.toLowerCase();
    const aRelevant = ["food", "outdoors", "culture", "shopping", "community"].some((key) => hasCategory(aCategory, CATEGORY_MATCHES[key]));
    const bRelevant = ["food", "outdoors", "culture", "shopping", "community"].some((key) => hasCategory(bCategory, CATEGORY_MATCHES[key]));
    const aCoffee = hasCategory(aCategory, CATEGORY_MATCHES.coffee);
    const bCoffee = hasCategory(bCategory, CATEGORY_MATCHES.coffee);
    const aRank = aAccessible * 3 + (aRelevant ? 2 : 0) + (aCoffee ? 1 : 0);
    const bRank = bAccessible * 3 + (bRelevant ? 2 : 0) + (bCoffee ? 1 : 0);
    return bRank - aRank || distanceFromDowntown(a) - distanceFromDowntown(b);
  });
}

function renderPlaceCard(place, index) {
  const rating = ratingsSummary(place.id);
  const favorites = getFavorites();
  const favorite = favorites.includes(place.id);
  const ratingLabel = rating.count
    ? `<span class="rating-mini"><span class="star" aria-hidden="true">★</span>${rating.average.toFixed(1)} <span class="note-count">(${rating.count})</span></span>`
    : `<span class="rating-mini muted-rating">No ratings yet</span>`;
  const address = place.address || `${place.city || "Omaha area"} · Address not listed`;
  return `
    <article class="place-card" tabindex="0" role="button" aria-label="View ${safeText(place.name)} details" data-place-id="${safeText(place.id)}">
      <div class="place-art tone-${index % 6}">
        <span class="place-category">${safeText(place.category)}</span>
        <span class="place-art-icon" aria-hidden="true">${safeText(categoryIcon(place))}</span>
        <button class="favorite-button ${favorite ? "saved" : ""}" data-favorite-id="${safeText(place.id)}" aria-label="${favorite ? "Remove from" : "Save to"} favorites" aria-pressed="${favorite}">${favorite ? "♥" : "♡"}</button>
      </div>
      <div class="place-info">
        <div class="place-title-row"><h3 title="${safeText(place.name)}">${safeText(place.name)}</h3>${ratingLabel}</div>
        <p class="place-address">${safeText(address)}</p>
        <div class="place-meta"><span class="access-badge ${accessClass(place.status)}">${safeText(place.status)}</span><span class="note-count">${rating.count ? (supabaseClient ? "Community ratings" : "Saved on this device") : "Add your perspective"}</span></div>
      </div>
    </article>`;
}

function renderPlaces() {
  const places = prioritizePlaces(getFilteredPlaces());
  const displayPlaces = (state.query || state.filter !== "all" ? places : places.slice(0, 9));
  if (!displayPlaces.length) {
    elements.grid.innerHTML = `<div class="empty-state"><strong>No places found just yet</strong><p>Try a different search or clear your filters.</p><button class="text-button clear-filters">Clear search and filters <span aria-hidden="true">→</span></button></div>`;
  } else {
    elements.grid.innerHTML = displayPlaces.slice(0, 30).map(renderPlaceCard).join("");
  }
  if (state.query) {
    elements.resultsTitle.textContent = `${places.length} ${places.length === 1 ? "place" : "places"} for “${state.query}”`;
    elements.resultsSubtitle.textContent = "Directory listings are not a guarantee of current access.";
  } else if (state.filter !== "all") {
    elements.resultsTitle.textContent = state.filter === "known" ? "Places with listed access information" : `${filterTitle(state.filter)} around Omaha`;
    elements.resultsSubtitle.textContent = `${places.length} directory ${places.length === 1 ? "listing" : "listings"} match this filter.`;
  } else {
    elements.resultsTitle.textContent = "Places to get you started";
    elements.resultsSubtitle.textContent = "Local listings with room for your perspective.";
  }
}

function filterTitle(filter) {
  return ({ food: "Food & drink", outdoors: "Outdoors", culture: "Arts & culture" })[filter] || filter;
}

function isActiveReport(report) {
  const expiresAt = new Date(report.expiresAt).getTime();
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function initializeCommunityMap() {
  if (mapState.community) return true;
  if (!window.L || !window.L.markerClusterGroup) {
    elements.mapCanvas.textContent = "The interactive map could not load. Check your internet connection and reload.";
    showToast("The map service could not be loaded.");
    return false;
  }

  mapState.community = window.L.map(elements.mapCanvas, { scrollWheelZoom: false }).setView([41.2565, -95.9345], 12);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapState.community);
  mapState.placeMarkers = window.L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 45,
    showCoverageOnHover: false,
  }).addTo(mapState.community);
  mapState.reportMarkers = window.L.layerGroup().addTo(mapState.community);
  return true;
}

function initializeReportPicker() {
  if (mapState.picker) {
    setTimeout(() => mapState.picker.invalidateSize(), 0);
    return;
  }
  if (!window.L) {
    showToast("The location picker could not load. Check your internet connection.");
    return;
  }

  mapState.picker = window.L.map(elements.reportLocationMap, { scrollWheelZoom: false }).setView([41.2565, -95.9345], 13);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapState.picker);
  mapState.picker.on("click", (event) => selectReportLocation(event.latlng));
  setTimeout(() => mapState.picker.invalidateSize(), 0);
}

function selectReportLocation(point) {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)
    || point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return;

  if (!mapState.pickerMarker) {
    mapState.pickerMarker = window.L.marker(point).addTo(mapState.picker);
  } else {
    mapState.pickerMarker.setLatLng(point);
  }
  elements.reportLatitude.value = point.lat.toFixed(7);
  elements.reportLongitude.value = point.lng.toFixed(7);
  elements.reportCoordinates.textContent = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

function reportPopup(report) {
  const content = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = report.type;
  const location = document.createElement("p");
  location.textContent = report.location || "Pinned location";
  content.append(title, location);
  if (report.note) {
    const note = document.createElement("p");
    note.textContent = report.note;
    content.append(note);
  }
  const submitted = document.createElement("p");
  submitted.textContent = `Reported ${new Date(report.createdAt).toLocaleString()}`;
  content.append(submitted);
  return content;
}

function renderMap() {
  if (!initializeCommunityMap()) return;

  const places = state.places.filter((place) =>
    Number.isFinite(place.lat) && Number.isFinite(place.lon)
    && place.lat >= 41.19 && place.lat <= 41.33
    && place.lon >= -96.13 && place.lon <= -95.86,
  );
  const placeMarkers = prioritizePlaces(places).map((place) => {
    const marker = window.L.marker([place.lat, place.lon], {
      title: place.name,
      alt: `Place: ${place.name}`,
      icon: window.L.divIcon({
        className: "place-map-icon",
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    });
    marker.on("click", () => openPlace(place.id));
    return marker;
  });
  mapState.placeMarkers.clearLayers();
  mapState.placeMarkers.addLayers(placeMarkers);

  const reports = getReports().filter(isActiveReport);
  mapState.reportMarkers.clearLayers();
  reports.forEach((report) => {
    const marker = window.L.marker([report.latitude, report.longitude], {
      title: `${report.type}: ${report.location || "Pinned location"}`,
      alt: `Community report: ${report.type}`,
      icon: window.L.divIcon({
        className: "community-report-icon",
        html: "!",
        iconSize: [26, 26],
        iconAnchor: [13, 26],
      }),
    });
    marker.bindPopup(reportPopup(report));
    marker.addTo(mapState.reportMarkers);
  });

  elements.reportCount.textContent = String(reports.length);
  elements.reportList.innerHTML = reports.length
    ? reports.map((report) => `
      <article class="report-item">
        <span class="report-icon" aria-hidden="true">!</span>
        <div><h3>${safeText(report.type)}</h3>
        <p>${safeText(report.location || "Pinned map location")}${report.note ? ` · ${safeText(report.note)}` : ""}</p>
        <span class="report-meta">Reported ${safeText(new Date(report.createdAt).toLocaleString())}</span></div>
      </article>`).join("")
    : `<p class="report-list-empty">No active roadblock reports nearby. Share a pin to help others plan.</p>`;
}

function openPlace(placeId) {
  const place = state.places.find((item) => item.id === placeId);
  if (!place) return;
  state.activePlaceId = placeId;
  state.selectedRating = 0;
  const summary = ratingsSummary(placeId);
  const reviewNotes = (getRatings()[placeId] || []).filter((entry) => entry.note).map((entry) => `
    <div class="community-note"><span aria-hidden="true">“</span><p>${safeText(entry.note)}</p><span class="note-rating">★ ${Number(entry.rating)}/5 · ${supabaseClient ? "Community rating" : "Saved on this device"}</span></div>`).join("");
  const statusText = place.status.startsWith("No access")
    ? "No accessibility details are included in this listing."
    : `The directory lists: ${place.status.replace(" (listed)", "").toLowerCase()}. This detail has not been independently verified.`;
  const description = place.description ? `<p>${safeText(place.description)}</p>` : "";
  const ratingSummary = summary.count
    ? `<div class="review-summary"><span aria-hidden="true">★</span><strong>${summary.average.toFixed(1)}</strong><span class="muted">from ${summary.count} ${summary.count === 1 ? "rating" : "ratings"} ${supabaseClient ? "from the community" : "on this device"}</span></div>`
    : `<p class="detail-disclaimer">No community ratings yet. Your perspective can help someone plan.</p>`;
  elements.detailContent.innerHTML = `
    <div class="eyebrow small-eyebrow"><span class="eyebrow-line"></span> OMAHA PLACES DIRECTORY</div>
    <p class="detail-kicker">${safeText(place.category)}</p>
    <h2 id="detail-title">${safeText(place.name)}</h2>
    <p class="detail-address">${safeText(place.address || place.city || "Omaha area")} ${place.phone ? `· ${safeText(place.phone)}` : ""}</p>
    <div class="detail-access"><span class="access-badge ${accessClass(place.status)}">${safeText(place.status)}</span><div><strong>Access details may change.</strong>${safeText(statusText)}${description}</div></div>
    <p class="detail-disclaimer">Directory information is community/open-data sourced and may be incomplete or out of date. Call ahead to confirm what matters for your visit.</p>
    ${ratingSummary}
    ${reviewNotes}
    <form class="review-form" id="review-form">
      <h3>How was your experience?</h3>
      <label id="rating-label">Your rating <span class="required">*</span></label>
      <div class="star-picker" role="group" aria-labelledby="rating-label">
        ${[1, 2, 3, 4, 5].map((rating) => `<button type="button" data-rating="${rating}" aria-label="${rating} ${rating === 1 ? "star" : "stars"}" aria-pressed="false">★</button>`).join("")}
      </div>
      <label for="review-note">Access note <span class="optional">(optional)</span></label>
      <textarea id="review-note" name="note" rows="2" maxlength="240" placeholder="Share a helpful detail about your visit…"></textarea>
      <button class="primary-button review-submit" type="submit">Save my rating <span aria-hidden="true">→</span></button>
    </form>`;
  elements.detailDialog.showModal();
}

async function addRating(placeId, rating, note) {
  const entry = { rating, note, date: new Date().toISOString() };

  if (supabaseClient) {
    const { error } = await supabaseClient.from("ratings").insert({
      place_id: placeId,
      rating,
      note,
    });
    if (error) {
      console.error("Could not save rating to Supabase.", error);
      showToast("Your rating could not be saved. Please try again.");
      return;
    }
  } else {
    if (hasSupabaseConfig) {
      showToast("Supabase is not ready, so your rating was not saved.");
      return;
    }
    const ratings = { ...getRatings() };
    ratings[placeId] = [...(ratings[placeId] || []), entry];
    if (!writeStorage(STORAGE_KEYS.ratings, ratings)) return;
    state.ratings = ratings;
  }

  if (supabaseClient) state.ratings[placeId] = [...(state.ratings[placeId] || []), entry];
  renderPlaces();
  openPlace(placeId);
  showToast(supabaseClient ? "Thanks for sharing with the community." : "Thanks! This rating is saved on this device.");
}

function clearReportLocation() {
  if (mapState.pickerMarker && mapState.picker) {
    mapState.picker.removeLayer(mapState.pickerMarker);
    mapState.pickerMarker = null;
  }
  elements.reportLatitude.value = "";
  elements.reportLongitude.value = "";
  elements.reportCoordinates.textContent = "No location selected";
}

async function addReport(formData) {
  const location = String(formData.get("location") || "").trim();
  const type = String(formData.get("type") || "").trim();
  const latitudeValue = String(formData.get("latitude") || "");
  const longitudeValue = String(formData.get("longitude") || "");
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  if (!latitudeValue || !longitudeValue || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    showToast("Choose the report location on the map first.");
    return;
  }
  if (!type) {
    showToast("Choose a report type before submitting.");
    return;
  }

  const createdAt = new Date().toISOString();
  const report = {
    id: `report-${Date.now()}`,
    latitude,
    longitude,
    location: location || "Pinned map location",
    type,
    note: String(formData.get("note") || "").trim(),
    createdAt,
    expiresAt: new Date(Date.now() + REPORT_LIFETIME_HOURS * 60 * 60 * 1000).toISOString(),
  };

  if (supabaseClient) {
    const { error } = await supabaseClient.from("reports").insert({
      latitude,
      longitude,
      location: report.location,
      type,
      note: report.note,
    });
    if (error) {
      console.error("Could not save community report to Supabase.", error);
      showToast("Your report could not be saved. Check that the reports table is set up.");
      return;
    }
  } else {
    if (hasSupabaseConfig) {
      showToast("Supabase is not ready, so your report was not saved.");
      return;
    }
    const reports = [report, ...getReports()];
    if (!writeStorage(STORAGE_KEYS.reports, reports)) return;
  }

  state.reports = [report, ...getReports()];
  elements.reportForm.reset();
  elements.photoName.textContent = "";
  clearReportLocation();
  elements.reportDialog.close();
  renderMap();
  showToast(supabaseClient ? "Report shared with the community." : "Report saved on this device.");
}

function showToast(message) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove("visible"), 3900);
}

const menu = {
  toggle: document.querySelector(".menu-toggle"),
  panel: document.querySelector("#site-menu"),
  query: window.matchMedia("(max-width: 800px)"),
};

function isMenuOpen() {
  return document.body.classList.contains("menu-open");
}

function openMenu() {
  document.body.classList.add("menu-open");
  menu.toggle.setAttribute("aria-expanded", "true");
  menu.panel.querySelector(".menu-close").focus();
}

function closeMenu({ restoreFocus = false } = {}) {
  if (!isMenuOpen()) return;
  document.body.classList.remove("menu-open");
  menu.toggle.setAttribute("aria-expanded", "false");
  if (restoreFocus) menu.toggle.focus();
}

menu.toggle.addEventListener("click", () => (isMenuOpen() ? closeMenu() : openMenu()));
menu.query.addEventListener("change", (event) => {
  if (!event.matches) closeMenu();
});
menu.panel.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || !isMenuOpen()) return;
  const focusable = [...menu.panel.querySelectorAll("a[href], button:not([disabled])")];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

function switchView(view) {
  if (!["explore", "map"].includes(view)) return;
  closeMenu();
  state.activeView = view;
  document.querySelectorAll(".view-panel").forEach((panel) => {
    const active = panel.id === `${view}-view`;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (button.classList.contains("nav-link")) {
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });
  document.querySelector("#topbar-context").textContent = ({ explore: "Find your next stop", map: "Community access map" })[view];
  if (view === "map") {
    renderMap();
    setTimeout(() => mapState.community?.invalidateSize(), 0);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-menu]")) {
    closeMenu({ restoreFocus: true });
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    switchView(viewButton.dataset.view);
    return;
  }
  const filterButton = event.target.closest(".filter-chip");
  if (filterButton) {
    state.filter = filterButton.dataset.filter;
    document.querySelectorAll(".filter-chip").forEach((button) => {
      const selected = button === filterButton;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    renderPlaces();
    return;
  }
  const favoriteButton = event.target.closest("[data-favorite-id]");
  if (favoriteButton) {
    event.stopPropagation();
    const favorites = getFavorites();
    const id = favoriteButton.dataset.favoriteId;
    const updated = favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
    if (writeStorage(STORAGE_KEYS.favorites, updated)) {
      renderPlaces();
      showToast(updated.includes(id) ? "Saved to your favorites." : "Removed from your favorites.");
    }
    return;
  }
  const placeCard = event.target.closest("[data-place-id]");
  if (placeCard) {
    openPlace(placeCard.dataset.placeId);
    return;
  }
  const ratingButton = event.target.closest("[data-rating]");
  if (ratingButton) {
    state.selectedRating = Number(ratingButton.dataset.rating);
    document.querySelectorAll(".star-picker [data-rating]").forEach((button) => {
      const selected = Number(button.dataset.rating) <= state.selectedRating;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(Number(button.dataset.rating) === state.selectedRating));
    });
    return;
  }
  const reportButton = event.target.closest(".report-open");
  if (reportButton) {
    elements.reportDialog.showModal();
    initializeReportPicker();
    return;
  }
  const closeButton = event.target.closest("[data-close-dialog]");
  if (closeButton) closeButton.closest("dialog").close();
  if (event.target.closest(".clear-filters")) {
    state.query = "";
    state.filter = "all";
    elements.search.value = "";
    document.querySelectorAll(".filter-chip").forEach((button) => {
      const selected = button.dataset.filter === "all";
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    renderPlaces();
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".place-card")) {
    event.preventDefault();
    openPlace(event.target.dataset.placeId);
  }
  if (event.key === "Escape") {
    closeMenu({ restoreFocus: true });
    document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  }
});

elements.search.addEventListener("input", () => {
  state.query = elements.search.value;
  renderPlaces();
});
document.querySelector("#search-button").addEventListener("click", () => {
  state.query = elements.search.value;
  renderPlaces();
  elements.search.focus();
});
elements.photo.addEventListener("change", () => {
  const file = elements.photo.files[0];
  elements.photoName.textContent = file ? `Selected: ${file.name} (file itself is not uploaded in this prototype)` : "";
});
elements.reportForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitButton = elements.reportForm.querySelector("[type='submit']");
  submitButton.disabled = true;
  addReport(new FormData(elements.reportForm))
    .catch((error) => {
      console.error("Could not submit community report.", error);
      showToast("Your report could not be saved. Please try again.");
    })
    .finally(() => {
      if (submitButton.isConnected) submitButton.disabled = false;
    });
});
elements.useCurrentLocation.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showToast("This browser does not support location sharing.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const point = window.L.latLng(position.coords.latitude, position.coords.longitude);
      initializeReportPicker();
      if (!mapState.picker) return;
      mapState.picker.setView(point, 17);
      selectReportLocation(point);
    },
    (error) => {
      console.error("Could not get the visitor's location.", error);
      showToast("Location was unavailable. You can still place a pin on the map.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
});
elements.detailContent.addEventListener("submit", (event) => {
  if (event.target.id !== "review-form") return;
  event.preventDefault();
  if (!state.selectedRating) {
    showToast("Choose a star rating before saving.");
    return;
  }
  const note = new FormData(event.target).get("note");
  const submitButton = event.target.querySelector("[type='submit']");
  submitButton.disabled = true;
  addRating(state.activePlaceId, state.selectedRating, String(note || "").trim())
    .catch((error) => {
      console.error("Could not submit rating.", error);
      showToast("Your rating could not be saved. Please try again.");
    })
    .finally(() => {
      if (submitButton.isConnected) submitButton.disabled = false;
    });
});

document.querySelectorAll(".app-dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

renderMap();
Promise.all([loadPlaces(), loadRatings(), loadReports()]).then(() => {
  renderPlaces();
  renderMap();
  if (!hasSupabaseConfig) showToast("Ratings are saved only on this device until Supabase is configured.");
});
