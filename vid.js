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

/* Guest-only: no per-user synced profiles. Stubs kept so legacy
 * imports (script.js) never break. */
export async function loadUserProfile(uid) {
  return null;
}

export async function saveUserProfile(uid, data) {
  return;
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
// Paged feed: boot fetches a small batch in one round trip and shuffles
// it, so the first video is random every visit instead of always the same
// doc. After boot the pool keeps growing one video at a time as you swipe.
// Grids bulk-fill via ensurePoolSize below.
const FIRST_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
let pageCursor = null;
let morePages = true;
let pagingInFlight = false;
let filling = false;

/** True while further pages can still be fetched. */
export function hasMoreVideos() {
  return morePages;
}

/** Orders ONLY new arrivals per current pref (never reshuffles the
 *  live pool — swipe windows are index-keyed and must stay stable). */
function orderPage(newRaw) {
  const scoped = applyPreference(newRaw);
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

function applyPreference(list, prefOverride) {
  const pref = prefOverride || getContentPreference();
  if (pref === "all") return list;
  const hasAnyLabeled = list.some((v) => effectiveCategory(v) !== null);
  const kept = list.filter((v) => {
    const c = effectiveCategory(v);
    // Strict once any video is labeled: unresolvable videos must NOT leak
    // Girls into the Couples feed (or vice versa). Only when the whole pool
    // is legacy (nothing labeled at all) do we stay permissive so the feed
    // can never blank on a data gap.
    if (!c) return !hasAnyLabeled;
    return c === pref;
  });
  // Empty-result guard (silent): never hand downstream an empty pool when
  // videos exist — fall back to the full list with NO event/toast. The user
  // must never see "no videos in this category".
  if (kept.length === 0 && list.length > 0) return list;
  return kept;
}

/* Persist a new preference, rebuild the pool + order, restart at the head.
 * Grids, swipe window and player all follow via sx:videos-ready. Always
 * returns true and stays silent: an empty category silently falls back to
 * the full pool (no toast, no popup). When the current in-memory pool has
 * no match but more pages exist server-side, it backfills in the background
 * and re-seeds so Couples appear even when they sit beyond the first page. */
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
    window.dispatchEvent(new CustomEvent("sx:videos-ready", { detail: { reset: true } }));
  } catch (e) {}
  // Backfill: first page may hold zero matches (e.g. all Girls) while Couples
  // exist deeper. Pull more pages until the category appears or we exhaust.
  if (p !== "all" && morePages && !allRawVideos.some((v) => effectiveCategory(v) === p)) {
    void backfillForPreference(p);
  }
  return true;
}

/** Background backfill for a category missing from the in-memory pool.
 *  Pages forward (unfiltered query, client-side match) until a video with
 *  the wanted effective category arrives or the collection is exhausted,
 *  then re-seeds the live pool silently. */
async function backfillForPreference(pref) {
  if (pagingInFlight) return;
  try {
    for (let attempt = 0; attempt < 20 && morePages; attempt++) {
      const before = allRawVideos.length;
      await requestMoreVideos(MAX_PAGE_SIZE);
      if (allRawVideos.length === before) break;
      if (allRawVideos.some((v) => effectiveCategory(v) === pref)) {
        // Only re-seed when our live pool was the silent fallback (i.e. it
        // currently holds videos outside the wanted category).
        const want = getContentPreference();
        if (want === pref) {
          fetchedVideos = applyFeedOrder(allRawVideos);
          currentVideoIndex = 0;
          try {
            localStorage.setItem("currentVideoIndex", "0");
          } catch (e) {}
          try {
            window.dispatchEvent(new CustomEvent("sx:videos-ready", { detail: { reset: true } }));
          } catch (e) {}
        }
        break;
      }
    }
  } catch (e) {}
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

/* Guest-only: single shuffled feed ordered by content preference
 * (Girls / Couples / All). No Following / Top modes. */
export function getFeedMode() {
  return "foryou";
}

export function setFeedMode(mode) {
  return;
}

function applyFeedOrder(list) {
  const pref = getContentPreference();
  if (pref === "all") return interleaveAll(list);
  return shuffleArray([...applyPreference(list, pref)]);
}

/** 'All' mix: ~70% Girls / ~30% Couples. Each bucket is shuffled, then
 *  emitted in 7-girls / 3-couples blocks so the blend is visible even when
 *  counts are skewed. Unlabeled (legacy) videos ride with the Girls bucket
 *  (majority) so they never blank the feed. Either bucket empty degrades to
 *  a plain shuffle of what exists. */
function interleaveAll(list) {
  if (!list.length) return [];
  const girls = [];
  const couples = [];
  list.forEach((v) => {
    const c = effectiveCategory(v);
    if (c === "couples") couples.push(v);
    else girls.push(v);
  });
  shuffleArray(girls);
  shuffleArray(couples);
  if (!girls.length) return couples;
  if (!couples.length) return girls;
  const out = [];
  let gi = 0;
  let ci = 0;
  while (gi < girls.length || ci < couples.length) {
    for (let k = 0; k < 7 && gi < girls.length; k++) out.push(girls[gi++]);
    for (let k = 0; k < 3 && ci < couples.length; k++) out.push(couples[ci++]);
  }
  return out;
}

/** New random order for the NEXT cycle after the user has watched every
 *  video in the current pool. Never reshuffles mid-cycle (swipe windows are
 *  index-keyed) — only called exactly on wrap. */
function reshuffleLivePool() {
  const pref = getContentPreference();
  if (pref === "all") fetchedVideos = interleaveAll(allRawVideos.length ? allRawVideos : fetchedVideos);
  else {
    const base = allRawVideos.length ? applyPreference(allRawVideos, pref) : fetchedVideos;
    fetchedVideos = shuffleArray([...(base.length ? base : fetchedVideos)]);
  }
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
    // Metadata ONLY, always: a full "auto" preload downloads the entire
    // next file and starves the playing video on slow links (audio flows,
    // picture never arrives). Headers + first bytes are enough to make the
    // next swipe instant without halving live bandwidth.
    preloaderElement.preload = "metadata";
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
    // Creator directory is best-effort: never let it block videos. A hung
    // creators query (offline SDK) loses the race after 8s and videos
    // proceed with stable pseudonyms.
    await Promise.race([
      loadCreators(),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);

    // Same guard for the videos query itself: a hung SDK request must not
    // wedge the boot — time out into the REST fallback below.
    let first;
    try {
      first = await Promise.race([
        fetchRawPage(null, FIRST_PAGE_SIZE),
        new Promise((_, reject) => setTimeout(() => reject(new Error("sdk-timeout")), 20000)),
      ]);
    } catch (e) {
      first = { raw: [], lastDoc: null, exhausted: true };
    }
    pageCursor = first.lastDoc;
    morePages = !first.exhausted;

    let rawVideos = first.raw;

    // SDK yielded nothing (offline mode / blocked stream): one plain-HTTPS
    // attempt before giving up. REST returns the full set, so paging ends.
    // No-op cost on the normal path.
    if (rawVideos.length === 0) {
      try {
        rawVideos = await loadVideosViaRest();
        if (rawVideos.length) {
          morePages = false;
          console.info("[shortxx] videos via REST fallback: " + rawVideos.length);
        }
      } catch (e) {}
    }

    if (rawVideos.length === 0) {
      console.warn("No active videos found in Firestore.");
      return [];
    }

    // Guest feed: fresh random shuffle EVERY visit (no resume).
    allRawVideos = rawVideos;
    // Boot coverage: the first page alone can miss a whole category (e.g.
    // all Girls while Couples sit deeper). When the persisted pref has zero
    // matches in page one but more pages exist, pull follow-up pages NOW so
    // the first paint already honors the filter instead of silently
    // falling back to Girls.
    try {
      const bootPref = getContentPreference();
      if (bootPref !== "all" && morePages && !rawVideos.some((v) => effectiveCategory(v) === bootPref)) {
        let cursor = pageCursor;
        for (let attempt = 0; attempt < 6 && morePages; attempt++) {
          let extra = null;
          try {
            extra = await Promise.race([
              fetchRawPage(cursor, MAX_PAGE_SIZE),
              new Promise((_, reject) => setTimeout(() => reject(new Error("sdk-timeout")), 20000)),
            ]);
          } catch (e) {
            break;
          }
          if (!extra || !extra.raw.length) {
            if (extra && extra.exhausted) morePages = false;
            break;
          }
          cursor = extra.lastDoc || cursor;
          if (extra.exhausted) morePages = false;
          rawVideos = [...rawVideos, ...extra.raw];
          if (rawVideos.some((v) => effectiveCategory(v) === bootPref)) break;
        }
        pageCursor = cursor;
        allRawVideos = rawVideos;
      }
    } catch (e) {}
    fetchedVideos = applyFeedOrder(rawVideos);
    currentVideoIndex = 0;

    // Discover/Trending grid pick: jump straight to the chosen video.
    try {
      const pick = sessionStorage.getItem("shortxx_pick");
      if (pick) {
        const pi = fetchedVideos.findIndex((v) => v.id === pick);
        if (pi >= 0) currentVideoIndex = pi;
        sessionStorage.removeItem("shortxx_pick");
      }
    } catch (e) { /* storage blocked: ignore */ }
    try {
      localStorage.setItem("currentVideoIndex", String(currentVideoIndex));
    } catch (e) {}

    preloadNextVideo();
    loadSettled = true;
    lastLoadError = null;
    // If the persisted category still has no match after the boot top-up,
    // keep backfilling quietly in the background and re-seed on arrival.
    try {
      const bootPref = getContentPreference();
      if (bootPref !== "all" && morePages && !allRawVideos.some((v) => effectiveCategory(v) === bootPref)) {
        void backfillForPreference(bootPref);
      }
    } catch (e) {}
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

  // Advance index and save state to prevent repeats on page switches.
  // On full-cycle wrap, reshuffle silently so the next round plays in a
  // different random order instead of repeating the same sequence.
  const wrapped = currentVideoIndex >= fetchedVideos.length - 1;
  currentVideoIndex = (currentVideoIndex + 1) % fetchedVideos.length;
  if (wrapped && fetchedVideos.length > 1) {
    try {
      reshuffleLivePool();
    } catch (e) {}
  }
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
  return "guest";
}

/* Guest-only: no per-user telemetry docs. Stubs kept for legacy imports. */
export async function upsertUserTelemetry(uid, extra) {
  return;
}

export async function incrementUserCounters(uid, counters) {
  return;
}

export async function markUserOffline(uid) {
  return;
}

/* Guest-only: comments removed. Stubs kept for legacy imports. */
export async function getComments(videoId) {
  return [];
}

export async function postComment(videoId, name, text) {
  return null;
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
