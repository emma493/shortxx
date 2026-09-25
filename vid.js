import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, doc, updateDoc, increment, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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

// Default Firestore database instance
const db = getFirestore(app);

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
  const mode = getFeedMode();
  if (mode === "top") {
    return [...list].sort((a, b) => (b.views || 0) - (a.views || 0));
  }
  if (mode === "following") {
    const follows = readFollows();
    const filtered = list.filter((v) => follows.includes(v.creator));
    // Empty following feed falls back to everything (caller toasts a hint).
    return filtered.length > 0 ? filtered : [...list];
  }
  return shuffleArray([...list]);
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
    preloaderElement.preload = "auto";
  }

  preloaderElement.src = nextVideo.url;
  preloaderElement.load();
}

/**
 * Fetches all active videos from Firestore, restores playback state, and
 * orders them per the active feed mode.
 */
export async function loadVideosFromFirestore() {
  try {
    const videosRef = collection(db, "videos");
    const q = query(videosRef, where("is_active", "==", true));
    const querySnapshot = await getDocs(q);

    let rawVideos = [];
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.direct_url) {
        rawVideos.push({
          id: docSnap.id,
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
          creator: creatorFor(docSnap.id),
        });
      }
    });

    if (rawVideos.length === 0) {
      console.warn("No active videos found in Firestore.");
      return [];
    }

    // Order per active feed (For You shuffle / Following / Top).
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

    console.log(`Loaded ${fetchedVideos.length} active videos from Firestore (feed: ${getFeedMode()}).`);
    preloadNextVideo();
    return fetchedVideos;
  } catch (error) {
    console.error("Error fetching videos from Firestore:", error);
    return [];
  }
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
      country: "GH",
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
