import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js";
import { getFirestore, initializeFirestore, collection, getDocs, query, where, limit, startAfter, doc, getDoc, setDoc, updateDoc, increment, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Firebase Configuration (project: shortxx-live)
const firebaseConfig = {
  apiKey: "AIzaSyBQoIKWaWPKg8luwCjpN8LPaTd-43A1Vqo",
  authDomain: "shortxx-live.firebaseapp.com",
  projectId: "shortxx-live",
  storageBucket: "shortxx-live.firebasestorage.app",
  messagingSenderId: "820851084501",
  appId: "1:820851084501:web:5965dc2eabf120f710265c",
  measurementId: "G-G211R5K286"
};

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Firebase Analytics (measurementId G-G211R5K286) — guarded: ad-blockers
// or unsupported environments must never break video playback.
try {
  getAnalytics(app);
} catch (e) {
  console.warn("Analytics init skipped:", e);
}

// Default Firestore database instance. Auto-detect long polling so networks
// that kill the SDK's persistent stream (proxies, firewalls, adblockers)
// transparently fall back to plain request/response instead of going
// "offline". Falls back to stock init if the option is ever unsupported.
let db;
try {
  db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
} catch (e) {
  db = getFirestore(app);
}

/** Shared Firebase app instance (powers Firebase Auth in script.js). */
export function getFirebaseApp() {
  return app;
}

/**
 * Per-user synced profile (rules allow public read/write on users/*).
 * Stores liked ids, saved ids and followed creators so they follow the
 * user across devices once signed in.
 */
export async function loadUserProfile(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn("Profile load failed:", err);
    return null;
  }
}

export async function saveUserProfile(uid, data) {
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), data, { merge: true });
  } catch (err) {
    console.warn("Profile save failed:", err);
  }
}

// Stable per-video creator pseudonyms (no Admin change needed).
// Same video id always maps to the same name on every device.
export const USERNAMES = [
  "LilyGrace", "AvaRose", "EmmaBelle", "SophiaMae", "IsabellaJoy",
  "MiaHope", "CharlotteSky", "AmeliaDawn", "HarperLee", "EvelynRose",
  "AbigailStar", "EmilyBloom", "EllaJune", "ScarlettRay", "GraceLynn",
  "ChloeKate", "PenelopeSue", "LaylaJo", "RileyQuinn", "ZoeyAnn",
  "NoraJane", "LilyPearl",
];

export function creatorFor(id) {
  if (!id) return USERNAMES[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return USERNAMES[h % USERNAMES.length];
}

export function formatCount(n) {
  const v = typeof n === "number" ? n : 0;
  if (v >= 1000) return (v / 1000).toFixed(1) + "K";
  return String(v);
}

// Each entry is now { id, url, views, likes, creator, ... } so likes,
// views and attribution travel with the video.
let fetchedVideos = [];
let currentVideoIndex = 0;
let currentVideo = null;
let preloaderElement = null;
// Unfiltered pool (preference + feed-mode ordering derive from this).
// Append-only after boot: swipe windows are index-keyed, so existing
// entries never move — new pages concatenate at the end.
let allRawVideos = [];
// Paged feed: the pool fills one video at a time (first video paints +
// plays immediately, the next is fetched as you watch). Single-doc pages
// keep every request tiny on slow links. Grids bulk-fill via
// ensurePoolSize below.
const FIRST_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 48;
let pageCursor = null;
let morePages = true;
let pagingInFlight = false;
let filling = false;

/** True while further pages can still be fetched. */
export function hasMoreVideos() {
  return morePages;
}

/** Orders ONLY new arrivals per current mode/pref (never reshuffles the
 *  live pool — swipe windows are index-keyed and must stay stable). */
function orderPage(newRaw) {
  const scoped = applyPreference(newRaw);
  const mode = getFeedMode();
  if (mode === "top") {
    return [...scoped].sort((a, b) => (b.views || 0) - (a.views || 0));
  }
  if (mode === "following") {
    const follows = readFollows();
    const filtered = scoped.filter((v) => follows.includes(v.creator));
    return filtered.length > 0 ? filtered : [...scoped];
  }
  return shuffleArray([...scoped]);
}

/** One raw page via the SDK (cursor null = first page). */
async function fetchRawPage(cursor, size) {
  const videosRef = collection(db, "videos");
  // Tiny pages: small JSON per request instead of the whole collection at
  // once, so first paint never waits on hundreds of docs.
  const lim = Math.min(Math.max(size || 1, 1), MAX_PAGE_SIZE);
  const q = cursor
    ? query(videosRef, where("is_active", "==", true), startAfter(cursor), limit(lim))
    : query(videosRef, where("is_active", "==", true), limit(lim));
  const snap = await getDocs(q);
  const raw = [];
  snap.forEach((docSnap) => {
    const v = toVideoObject(docSnap.id, docSnap.data());
    if (v) raw.push(v);
  });
  const docs = snap.docs || [];
  return { raw, lastDoc: docs.length ? docs[docs.length - 1] : null, exhausted: docs.length < lim };
}
// Load-state tracking: lets the boot sequence tell "still loading" apart
// from "failed", retry a hung request, and surface the real cause instead
// of a silent black feed.
let loadSettled = false;
let lastLoadError = null;

/** True once the initial Firestore load resolved (success or failure). */
export function didVideosLoad() {
  return loadSettled;
}

/** Last load failure (Error or null). Null after any success. */
export function getLastLoadError() {
  return lastLoadError;
}

// Content preference: which creators' videos may enter the pool.
// 'all' = Girls + Couples mix. Persisted as shortxx_pref, default 'all'.
export function getContentPreference() {
  try {
    const p = localStorage.getItem("shortxx_pref");
    return p === "girls" || p === "couples" ? p : "all";
  } catch (e) {
    return "all";
  }
}

function effectiveCategory(v) {
  const c = v.creatorCategory || v.category;
  return c === "girls" || c === "couples" ? c : null;
}

function applyPreference(list) {
  const pref = getContentPreference();
  if (pref === "all") return list;
  const kept = list.filter((v) => {
    const c = effectiveCategory(v);
    // Unresolvable videos stay visible (Admin guarantees coverage; this is
    // belt-and-braces so a data gap can never blank the app).
    return !c || c === pref;
  });
  // Empty-result guard: never hand downstream an empty pool when videos exist.
  if (kept.length === 0 && list.length > 0) {
    try {
      window.dispatchEvent(new CustomEvent("sx:pref-empty", { detail: { pref } }));
    } catch (e) {}
    return list;
  }
  return kept;
}

/* Persist a new preference, rebuild the pool + order, restart at the head.
 * Grids, swipe window and player all follow via sx:videos-ready. Returns
 * false when the category matched nothing (pool fell back to full + the
 * caller should toast); true otherwise. */
export function setContentPreference(pref) {
  const p = pref === "girls" || pref === "couples" ? pref : "all";
  try {
    localStorage.setItem("shortxx_pref", p);
  } catch (e) {}
  if (!allRawVideos.length) return true;
  fetchedVideos = applyFeedOrder(allRawVideos);
  currentVideoIndex = 0;
  try {
    localStorage.setItem("currentVideoIndex", "0");
  } catch (e) {}
  try {
    window.dispatchEvent(new CustomEvent("sx:videos-ready"));
  } catch (e) {}
  if (p === "all") return true;
  return allRawVideos.some((v) => effectiveCategory(v) === p);
}

// Creator directory (Session A `creators` collection). Best-effort: rules
// may not be deployed yet — any failure falls back to stable pseudonyms.
let creatorsById = {};

export async function loadCreators() {
  try {
    const snap = await getDocs(
      query(collection(db, "creators"), where("is_active", "==", true)),
    );
    const map = {};
    snap.forEach((d) => {
      const data = d.data();
      if (data.username) {
        const num = (v) => (typeof v === "number" ? v : null);
        const cat = data.category === "girls" || data.category === "couples" ? data.category : null;
        map[d.id] = {
          username: data.username,
          avatarUrl: data.avatarUrl || null,
          bio: typeof data.bio === "string" ? data.bio : null,
          followers: num(data.followers),
          following: num(data.following),
          likesTotal: num(data.likesTotal),
          category: cat,
        };
      }
    });
    creatorsById = map;
  } catch (err) {
    console.warn("Creators lookup skipped (rules/data pending):", err);
    creatorsById = {};
  }
  return creatorsById;
}

function resolveCreator(data, docId) {
  const ref = data.creatorId && creatorsById[data.creatorId];
  if (ref) {
    return {
      name: ref.username,
      avatarUrl: ref.avatarUrl || null,
      bio: ref.bio || null,
      followers: ref.followers,
      following: ref.following,
      likesTotal: ref.likesTotal,
      creatorCategory: ref.category || null,
      linked: true,
    };
  }
  // Unlinked legacy video: fall back to stable pseudonym so /@name
  // profiles (sitemap, creators grid, feed avatar) always resolve to
  // videos instead of rendering empty. linked=true keeps the feed avatar
  // visible and the standalone /@ route grouped by the same name.
  return { name: creatorFor(docId), avatarUrl: null, bio: null, followers: null, following: null, likesTotal: null, creatorCategory: null, linked: true };
}

function readFollows() {
  try {
    return JSON.parse(localStorage.getItem("shortxx_follows") || "[]");
  } catch (e) {
    return [];
  }
}

export function getFeedMode() {
  const m = localStorage.getItem("shortxx_feed");
  return m === "following" || m === "top" ? m : "foryou";
}

export function setFeedMode(mode) {
  localStorage.setItem(
    "shortxx_feed",
    mode === "following" || mode === "top" ? mode : "foryou",
  );
}

function applyFeedOrder(list) {
  // Content preference first (Girls / Couples / All), then feed mode.
  const scoped = applyPreference(list);
  const mode = getFeedMode();
  if (mode === "top") {
    return [...scoped].sort((a, b) => (b.views || 0) - (a.views || 0));
  }
  if (mode === "following") {
    const follows = readFollows();
    const filtered = scoped.filter((v) => follows.includes(v.creator));
    // Empty following feed falls back to everything (caller toasts a hint).
    return filtered.length > 0 ? filtered : [...scoped];
  }
  return shuffleArray([...scoped]);
}

/**
 * Fisher-Yates Shuffle Algorithm for true randomness.
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Preloads the next video in memory in the background for fast, instant
 * switching. Always warms the plain `direct_url` (not the HLS manifest) -
 * this is a throwaway <video> just to prime the browser's HTTP cache/DNS,
 * not the element that will actually play; hls.js does its own buffering
 * once a video is actually attached and playing.
 */
function preloadNextVideo() {
  if (fetchedVideos.length <= 1) return;
  const nextIndex = (currentVideoIndex + 1) % fetchedVideos.length;
  const nextVideo = fetchedVideos[nextIndex];
  if (!nextVideo) return;

  if (!preloaderElement) {
    preloaderElement = document.createElement("video");
    // Save-Data / 2G: metadata only until the video is actually next —
    // a full "auto" preload per swipe stalls low-end phones.
    try {
      const c = navigator.connection || {};
      preloaderElement.preload = (c.saveData || /2g/.test(c.effectiveType || "")) ? "metadata" : "auto";
    } catch (e) {
      preloaderElement.preload = "auto";
    }
  }

  preloaderElement.src = nextVideo.url;
  preloaderElement.load();
}

/**
 * Maps one plain video doc ({direct_url, ...}) to a pool entry.
 * Returns null when there is no playable URL. Shared by the SDK path
 * and the REST fallback below so both produce identical entries.
 */
function toVideoObject(id, data) {
  if (!data || !data.direct_url) return null;
  const who = resolveCreator(data, id);
  let createdAtMillis = 0;
  const ts = data.created_at || data.createdAt;
  if (ts && typeof ts.toMillis === "function") {
    try {
      createdAtMillis = ts.toMillis();
    } catch (e) {}
  } else if (ts && typeof ts._seconds === "number") {
    createdAtMillis = ts._seconds * 1000;
  } else if (typeof ts === "string") {
    const p = Date.parse(ts);
    if (!isNaN(p)) createdAtMillis = p;
  }
  return {
    id,
    url: data.direct_url,
    // Populated once the admin dashboard's transcodeVideo Cloud
    // Function has processed this video. Only trust hlsUrl for
    // adaptive playback when status is explicitly "ready" - a
    // video mid-transcode (or one that failed) still has a
    // perfectly playable `url` (direct_url) to fall back to.
    hlsUrl: data.status === 'ready' ? data.hls_url || null : null,
    posterUrl: data.poster_url || null,
    views: typeof data.views === 'number' ? data.views : 0,
    likes: typeof data.likes === 'number' ? data.likes : 0,
    creator: who.name,
    creatorLinked: who.linked,
    creatorCategory: who.creatorCategory || null,
    avatarUrl: who.avatarUrl,
    // Optional Session-A fields (captionAI / Upload page). Absent on
    // legacy docs — every consumer must tolerate missing values.
    category: typeof data.category === 'string' ? data.category : null,
    caption: typeof data.caption === 'string' ? data.caption : null,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags.filter((t) => typeof t === 'string' && t) : [],
    createdAtMillis,
  };
}

// --- REST fallback unwrappers (Firestore REST wraps every value in a
// typed envelope: {stringValue}, {integerValue: "5"}, {booleanValue}, ...).
const restStr = (f) => (f && typeof f.stringValue === "string" ? f.stringValue : null);
const restBool = (f) => !!(f && (f.booleanValue === true || f.booleanValue === "true"));
const restNum = (f) => {
  if (!f) return 0;
  if (typeof f.integerValue !== "undefined") {
    const n = parseInt(f.integerValue, 10);
    return isNaN(n) ? 0 : n;
  }
  if (typeof f.doubleValue !== "undefined") return Number(f.doubleValue) || 0;
  return 0;
};

/**
 * Plain-HTTPS fallback for the videos list. Used only when the Firestore
 * SDK path yields nothing (offline mode / blocked watch stream): the SDK
 * needs a persistent stream, plain fetch does not, so proxies that kill
 * long-lived streams can still serve this. Returns pool entries (same
 * shape as the SDK path) or [].
 */
async function loadVideosViaRest() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 45000);
  try {
    const url =
      "https://firestore.googleapis.com/v1/projects/" + firebaseConfig.projectId +
      "/databases/(default)/documents/videos?pageSize=200&key=" + firebaseConfig.apiKey;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res || !res.ok) {
      console.warn("[shortxx] REST fallback HTTP " + (res ? res.status : "no-response"));
      return [];
    }
    const json = await res.json();
    const docs = json && Array.isArray(json.documents) ? json.documents : [];
    const out = [];
    for (const d of docs) {
      try {
        const f = d.fields || {};
        if (!restBool(f.is_active)) continue;
        const tags = f.hashtags && Array.isArray(f.hashtags.arrayValue && f.hashtags.arrayValue.values)
          ? f.hashtags.arrayValue.values.map((t) => (t && t.stringValue) || "").filter(Boolean)
          : [];
        const v = toVideoObject(String((d.name || "").split("/").pop() || ""), {
          direct_url: restStr(f.direct_url),
          hls_url: restStr(f.hls_url),
          poster_url: restStr(f.poster_url),
          status: restStr(f.status),
          views: restNum(f.views),
          likes: restNum(f.likes),
          creatorId: restStr(f.creatorId),
          category: restStr(f.category),
          caption: restStr(f.caption),
          hashtags: tags,
          created_at: restStr(f.created_at) || restStr(f.createdAt),
        });
        if (v) out.push(v);
      } catch (e) {}
    }
    return out;
  } catch (e) {
    console.warn("[shortxx] REST fallback failed:", String((e && e.message) || e));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches all active videos from Firestore, restores playback state, and
 * orders them per the active feed mode.
 */
export async function loadVideosFromFirestore() {
  // Fresh pool (boot, feed switch, retry): reset paging, load page one.
  pageCursor = null;
  morePages = true;
  try {
    // Creator directory first (best-effort) so names/avatars resolve below.
    await loadCreators();

    const first = await fetchRawPage(null, FIRST_PAGE_SIZE);
    pageCursor = first.lastDoc;
    morePages = !first.exhausted;

    let rawVideos = first.raw;

    // SDK yielded nothing (offline mode / blocked stream): one plain-HTTPS
    // attempt before giving up. REST returns the full set, so paging ends.
    // No-op cost on the normal path.
    if (rawVideos.length === 0) {
      try {
        rawVideos = await loadVideosViaRest();
        if (rawVideos.length) morePages = false;
      } catch (e) {}
    }

    if (rawVideos.length === 0) {
      console.warn("No active videos found in Firestore.");
      return [];
    }

    // Order per active feed (For You shuffle / Following / Top).
    allRawVideos = rawVideos;
    fetchedVideos = applyFeedOrder(rawVideos);

    // Retrieve previous index session if available
    const savedIndex = parseInt(localStorage.getItem("currentVideoIndex") || "0", 10);
    currentVideoIndex = isNaN(savedIndex) || savedIndex >= fetchedVideos.length ? 0 : savedIndex;

    // Discover grid pick: jump straight to the chosen video after reload.
    try {
      const pick = sessionStorage.getItem("shortxx_pick");
      if (pick) {
        const pi = fetchedVideos.findIndex((v) => v.id === pick);
        if (pi >= 0) {
          currentVideoIndex = pi;
          localStorage.setItem("currentVideoIndex", String(pi));
        }
        sessionStorage.removeItem("shortxx_pick");
      }
    } catch (e) { /* storage blocked: ignore */ }

    preloadNextVideo();
    loadSettled = true;
    lastLoadError = null;
    return fetchedVideos;
  } catch (error) {
    console.error("Error fetching videos from Firestore:", error);
    loadSettled = true;
    lastLoadError = error instanceof Error ? error : new Error(String(error));
    // Surface the cause to the boot sequence (toast + retry UI) instead
    // of failing silently with an empty pool.
    try {
      window.dispatchEvent(new CustomEvent("sx:videos-error", { detail: { message: String((error && error.message) || error) } }));
    } catch (e) {}
    return [];
  }
}

/**
 * Fetches the next page (default: exactly 1 video) and appends it to the
 * live pool — steady state is 1 playing + 1 fetched ahead. Existing indices
 * never move; grids + swipe extend via sx:videos-ready. Returns pool size.
 * No-op while a fetch is in flight or exhausted. Pages fully filtered out
 * (e.g. Following with no match) auto-advance to the next page.
 */
export async function requestMoreVideos(count = 1) {
  if (!morePages || pagingInFlight) return getVideoCount();
  pagingInFlight = true;
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const page = await fetchRawPage(pageCursor, count);
      pageCursor = page.lastDoc || pageCursor;
      if (page.exhausted) morePages = false;
      if (page.raw.length) {
        allRawVideos = [...allRawVideos, ...page.raw];
        fetchedVideos = [...fetchedVideos, ...orderPage(page.raw)];
        try {
          window.dispatchEvent(new CustomEvent("sx:videos-ready"));
        } catch (e) {}
        return getVideoCount();
      }
      if (!morePages) break;
    }
    return getVideoCount();
  } catch (e) {
    return getVideoCount();
  } finally {
    pagingInFlight = false;
  }
}

/**
 * Bulk-fill for grids (Discover/Trending/Saved/Liked/Creators): pages up
 * until the pool holds n videos or the collection is exhausted. Single
 * runner at a time; fire-and-forget from paint code.
 */
export async function ensurePoolSize(n) {
  if (filling) return getVideoCount();
  filling = true;
  try {
    while (morePages && getVideoCount() < n) {
      await requestMoreVideos(Math.min(MAX_PAGE_SIZE, n - getVideoCount()));
    }
  } catch (e) {} finally {
    filling = false;
  }
  return getVideoCount();
}

/**
 * Returns the current/next video sequentially from the ordered pool, and
 * records a real view for it in Firestore via window.trackVideoView
 * (defined in tracking.js).
 */
export function getNextVideo() {
  if (fetchedVideos.length === 0) {
    console.warn("No active videos available.");
    return null;
  }

  const videoData = fetchedVideos[currentVideoIndex];
  currentVideo = videoData;

  // Advance index and save state to prevent repeats on page switches
  currentVideoIndex = (currentVideoIndex + 1) % fetchedVideos.length;
  localStorage.setItem("currentVideoIndex", currentVideoIndex.toString());

  // Trigger background preloading for the upcoming video
  preloadNextVideo();

  // Record the view for the video that's actually about to be shown
  if (videoData && videoData.id && typeof window.trackVideoView === "function") {
    window.trackVideoView(videoData.id);
  }

  return videoData;
}

export function getCurrentVideo() {
  return currentVideo;
}

/** Random access into the ordered pool (swipe feed) without advancing
 * the rotation pointer. Wraps modulo. Records a view like getNextVideo. */
export function getVideoAt(i) {
  if (!fetchedVideos.length) return null;
  const idx = ((i % fetchedVideos.length) + fetchedVideos.length) % fetchedVideos.length;
  const videoData = fetchedVideos[idx];
  if (!videoData) return null;
  currentVideo = videoData;
  try {
    localStorage.setItem("currentVideoIndex", String(idx));
  } catch (e) {}
  if (videoData && videoData.id && typeof window.trackVideoView === "function") {
    window.trackVideoView(videoData.id);
  }
  return videoData;
}

/** Pool size for the swipe window (0 until Firestore loads). */
export function getVideoCount() {
  return fetchedVideos.length;
}

/** Full ordered pool (powers Discover grid + search). */
export function getAllVideos() {
  return [...fetchedVideos];
}

/** Jump the rotation to a specific pool index (Discover picks). */
export function jumpToIndex(i) {
  if (!fetchedVideos.length) return;
  currentVideoIndex = ((i % fetchedVideos.length) + fetchedVideos.length) % fetchedVideos.length;
  localStorage.setItem("currentVideoIndex", currentVideoIndex.toString());
}

/**
 * Persist a like/unlike on the video document (public write allowed by
 * Firestore rules on videos/*). Returns silently on failure.
 */
export async function persistLike(videoId, like) {
  if (!videoId) return;
  try {
    await updateDoc(doc(db, "videos", videoId), {
      likes: increment(like ? 1 : -1),
    });
    const item = fetchedVideos.find((v) => v.id === videoId);
    if (item) item.likes = Math.max(0, (item.likes || 0) + (like ? 1 : -1));
  } catch (err) {
    console.warn("Like persist failed:", err);
  }
}

function detectDeviceType() {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|android|blackberry|windows phone/.test(ua)) return "Mobile";
  return "Desktop";
}

/* ---- User telemetry for the Admin Users tab (merge-safe, country-only) ----
 * PWA detection reuses the standalone display-mode check from pwa-banner.js.
 * Referral is normalized to Direct/Google/Organic/Social from utm_source +
 * document.referrer. Country is resolved client-side (timezone + optional
 * ip-api fallback) — raw IPs are never stored. */

export function detectAppType() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return "PWA";
  } catch (e) {}
  if (window.navigator && window.navigator.standalone === true) return "PWA";
  return "Browser";
}

export function classifyReferral() {
  try {
    const params = new URLSearchParams(location.search || "");
    const utm = (params.get("utm_source") || "").toLowerCase();
    const ref = document.referrer || "";
    let host = "";
    try { host = ref ? new URL(ref).hostname.toLowerCase() : ""; } catch (e) { host = ref.toLowerCase(); }
    const raw = ref || (utm ? utm : "Direct");
    if (utm.includes("google") || host.includes("google")) return { group: "Google", raw: raw || "google" };
    if (!ref && !utm) return { group: "Direct", raw: "Direct" };
    if (/facebook|instagram|tiktok|twitter|x\.com|youtube|snap|whatsapp|telegram/.test(utm + " " + host)) {
      return { group: "Social", raw: raw.slice(0, 120) || "Social" };
    }
    if (host && host !== location.hostname) return { group: "Organic", raw: host.slice(0, 120) };
    if (utm) return { group: "Organic", raw: utm.slice(0, 120) };
    return { group: "Direct", raw: (raw || "Direct").slice(0, 120) };
  } catch (e) {
    return { group: "Direct", raw: "Direct" };
  }
}

let _cachedCountry = null;

export async function resolveCountry() {
  if (_cachedCountry) return _cachedCountry;
  // 1. Timezone heuristic (offline, free): Accra/Africa -> GH.
  try {
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").toLowerCase();
    if (tz.includes("accra")) { _cachedCountry = { code: "GH", source: "client-locale" }; return _cachedCountry; }
  } catch (e) {}
  // 2. Optional ip-api lookup (country code only, fail-soft to GH).
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch("https://ip-api.com/json/?fields=countryCode", { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      if (j && typeof j.countryCode === "string" && j.countryCode.length === 2) {
        _cachedCountry = { code: j.countryCode.toUpperCase(), source: "ip-api" };
        return _cachedCountry;
      }
    }
  } catch (e) {}
  _cachedCountry = { code: "GH", source: "client-locale" };
  return _cachedCountry;
}

export function authProviderLabel(user) {
  if (!user) return "guest";
  if (user.isAnonymous) return "guest";
  try {
    const pid = (user.providerData && user.providerData[0] && user.providerData[0].providerId) || "";
    if (pid.includes("google")) return "google";
    if (pid.includes("password")) return "email";
  } catch (e) {}
  return user.email ? "email" : "guest";
}

/** Upsert merge-safe user doc: presence + device/platform/auth/geo.
 * NOTE: firstSeen is intentionally NOT written here — merge:true would
 * overwrite it on every 25 s heartbeat, destroying the original value the
 * Admin date-range filter depends on. First-seen defaults are applied
 * read-side (Admin subscribeToUsers falls back to `new Date()`). */
export async function upsertUserTelemetry(uid, extra) {
  if (!uid) return;
  try {
    const appType = detectAppType();
    const { group, raw } = classifyReferral();
    const geo = await resolveCountry();
    await setDoc(doc(db, "users", uid), {
      userId: uid,
      deviceType: detectDeviceType(),
      appType: appType,
      isPWA: appType === "PWA",
      trafficSource: raw,
      referralGroup: group,
      country: geo.code,
      countrySource: geo.source,
      status: "Online",
      lastActive: serverTimestamp(),
      currentPage: location.pathname + location.search,
      authProvider: (extra && extra.authProvider) || "guest",
    }, { merge: true });
  } catch (err) {
    console.warn("User telemetry upsert failed:", err);
  }
}

/** Increment engagement counters without overwriting profile fields. */
export async function incrementUserCounters(uid, counters) {
  if (!uid || !counters) return;
  try {
    const payload = { lastActive: serverTimestamp(), status: "Online" };
    if (counters.watchSeconds) payload.totalDurationSeconds = increment(counters.watchSeconds);
    if (counters.completed) payload.videosWatched = increment(1);
    if (counters.saveDelta) payload.totalSaves = increment(counters.saveDelta);
    if (counters.downloadDelta) payload.totalDownloads = increment(counters.downloadDelta);
    await setDoc(doc(db, "users", uid), payload, { merge: true });
  } catch (err) {
    console.warn("User counter increment failed:", err);
  }
}

/** Mark user offline on tab hide (best-effort; heartbeat is source of truth). */
export async function markUserOffline(uid) {
  if (!uid) return;
  try {
    await setDoc(doc(db, "users", uid), { status: "Offline", lastActive: serverTimestamp() }, { merge: true });
  } catch (err) {}
}

/**
 * Comments ride the public `events` collection (event_type 'comment') so no
 * rules/Admin change is needed. Single-field query avoids composite indexes.
 */
export async function getComments(videoId) {
  if (!videoId) return [];
  try {
    const eventsRef = collection(db, "events");
    const q = query(eventsRef, where("video_id", "==", videoId));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.event_type !== "comment") return;
      let ts = Date.now();
      const t = data.timestamp;
      if (t && typeof t.toMillis === "function") ts = t.toMillis();
      else if (typeof data.createdAt === "string") {
        const p = Date.parse(data.createdAt);
        if (!isNaN(p)) ts = p;
      }
      list.push({
        id: d.id,
        name: data.userId || "ANONYMOUS",
        text: data.details || "",
        ts,
      });
    });
    list.sort((a, b) => a.ts - b.ts);
    return list;
  } catch (err) {
    console.warn("Comments fetch failed:", err);
    return [];
  }
}

export async function postComment(videoId, name, text) {
  const clean = (text || "").trim().slice(0, 300);
  if (!videoId || !clean) return null;
  try {
    const ref = await addDoc(collection(db, "events"), {
      event_type: "comment",
      video_id: videoId,
      userId: (name || "ANONYMOUS").slice(0, 32),
      device_type: detectDeviceType(),
      app_type: detectAppType(),
      country: (typeof window !== "undefined" && window.shortxxCountry) || "GH",
      referrer: document.referrer || "Direct",
      timestamp: serverTimestamp(),
      createdAt: new Date().toISOString(),
      details: clean,
    });
    return ref.id;
  } catch (err) {
    console.warn("Comment post failed:", err);
    return null;
  }
}

/**
 * Recovers playback automatically if network dropouts or stream stalls occur.
 */
export function initializePlayerRecovery(videoElementId = "main-video") {
  const video = document.getElementById(videoElementId);
  if (!video) return;

  video.addEventListener("error", () => {
    console.warn("Video playback encountered a network/stream error. Recovering...");
    const fallback = getNextVideo();
    if (fallback && fallback.url) {
      video.src = fallback.url;
      video.load();
      video.play().catch((e) => console.warn("Auto-recovery play error:", e));
    }
  });

  video.addEventListener("stalled", () => {
    console.warn("Stream stalled. Attempting playback resume...");
    video.load();
    video.play().catch(() => {});
  });
}

// Make functions globally available
window.getNextVideo = getNextVideo;
window.loadVideosFromFirestore = loadVideosFromFirestore;
window.initializePlayerRecovery = initializePlayerRecovery;
