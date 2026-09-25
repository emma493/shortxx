/**
 * tracking.js - Shortxx Video Data Engine (Reliable Views Fix)
 */

const firebaseConfig = {
  apiKey: "AIzaSyBQoIKWaWPKg8luwCjpN8LPaTd-43A1Vqo",
  authDomain: "shortxx-live.firebaseapp.com",
  projectId: "shortxx-live",
  storageBucket: "shortxx-live.firebasestorage.app",
  messagingSenderId: "820851084501",
  appId: "1:820851084501:web:5965dc2eabf120f710265c",
  measurementId: "G-G211R5K286",
};

(function loadFirebaseSDKs() {
  const scripts = [
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-compat.js",
  ];

  let loadedCount = 0;
  scripts.forEach((src) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      loadedCount++;
      if (loadedCount === scripts.length) {
        initFirebase();
      }
    };
    document.head.appendChild(script);
  });
})();

function initFirebase() {
  let app = !firebase.apps.length ? firebase.initializeApp(firebaseConfig) : firebase.app();
  
  // Default Firestore database instance (project: shortxx-live)
  const db = app.firestore();

  window.shortxxDb = db;

  // Flush any pending views queued prior to SDK load
  if (window._shortxxPendingViews && window._shortxxPendingViews.length) {
    const pending = [...window._shortxxPendingViews];
    window._shortxxPendingViews = [];
    pending.forEach((id) => recordView(id));
  }
}

function detectDeviceType() {
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/tablet|ipad|playbook|silk/.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|android|blackberry|windows phone/.test(ua)) return "Mobile";
  return "Desktop";
}

async function recordView(videoId) {
  if (!videoId || !window.shortxxDb) return;

  const docRef = window.shortxxDb.collection("videos").doc(videoId);
  const eventsRef = window.shortxxDb.collection("events");

  // Perform view increment directly on video document
  docRef.update({
    views: firebase.firestore.FieldValue.increment(1),
    last_viewed: firebase.firestore.FieldValue.serverTimestamp()
  }).catch((err) => {
    // If update fails because document missing views field, fallback to set with merge
    docRef.set(
      { views: firebase.firestore.FieldValue.increment(1), last_viewed: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  });

  // Log granular video_view event for the 24H analytics filter
  eventsRef.add({
    event_type: "video_view",
    video_id: videoId,
    userId: "ANONYMOUS",
    device_type: detectDeviceType(),
    country: "GH",
    referrer: document.referrer || "Direct",
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    createdAt: new Date().toISOString() // Backup ISO string for legacy queries
  }).catch((err) => {
    console.warn("Error logging video_view event:", err);
  });
}

window.trackVideoView = async function (videoId) {
  if (!videoId) return;

  if (!window.shortxxDb) {
    window._shortxxPendingViews = window._shortxxPendingViews || [];
    window._shortxxPendingViews.push(videoId);
    return;
  }

  await recordView(videoId);
};