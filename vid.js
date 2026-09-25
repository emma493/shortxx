import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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

// Each entry is now { id, url } so a view can be attributed to the right
// Firestore video document. (Previously this only stored the bare URL,
// which made it impossible to know which video to increment.)
let fetchedVideos = [];
let currentVideoIndex = 0;
let preloaderElement = null;

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
 * Fetches all active videos from Firestore, restores playback state, and shuffles.
 */
export async function loadVideosFromFirestore() {
  try {
    const videosRef = collection(db, "videos");
    const q = query(videosRef, where("is_active", "==", true));
    const querySnapshot = await getDocs(q);

    let rawVideos = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.direct_url) {
        rawVideos.push({
          id: doc.id,
          url: data.direct_url,
          // Populated once the admin dashboard's transcodeVideo Cloud
          // Function has processed this video. Only trust hlsUrl for
          // adaptive playback when status is explicitly "ready" - a
          // video mid-transcode (or one that failed) still has a
          // perfectly playable `url` (direct_url) to fall back to.
          hlsUrl: data.status === 'ready' ? data.hls_url || null : null,
          posterUrl: data.poster_url || null,
        });
      }
    });

    if (rawVideos.length === 0) {
      console.warn("No active videos found in Firestore.");
      return [];
    }

    // Shuffle videos randomly for new visitors
    fetchedVideos = shuffleArray(rawVideos);

    // Retrieve previous index session if available
    const savedIndex = parseInt(localStorage.getItem("currentVideoIndex") || "0", 10);
    currentVideoIndex = isNaN(savedIndex) || savedIndex >= fetchedVideos.length ? 0 : savedIndex;

    console.log(`Loaded and randomized ${fetchedVideos.length} active videos from Firestore.`);
    preloadNextVideo();
    return fetchedVideos;
  } catch (error) {
    console.error("Error fetching videos from Firestore:", error);
    return [];
  }
}

/**
 * Returns the current/next video ({ id, url }) sequentially from the
 * randomized pool, and records a real view for it in Firestore via
 * window.trackVideoView (defined in tracking.js).
 */
export function getNextVideo() {
  if (fetchedVideos.length === 0) {
    console.warn("No active videos available.");
    return null;
  }

  const videoData = fetchedVideos[currentVideoIndex];

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