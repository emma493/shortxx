/* js/features/mute.js — mute / unmute only. */

export async function init() {
  const video = document.getElementById("main-video");
  const muteBtns = document.querySelectorAll(".mute-btn");
  const hint = document.getElementById("unmute-hint");
  const dismiss = document.getElementById("unmute-dismiss");
  if (!video) return;

  const update = (muted) => {
    video.muted = muted;
    if (hint) hint.style.display = muted ? "" : "none";
  };

  muteBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = !video.muted;
      try {
        localStorage.setItem("videoMuted", String(next));
      } catch (err) {}
      update(next);
    });
  });

  if (dismiss && hint) {
    dismiss.addEventListener("click", (e) => {
      e.stopPropagation();
      hint.style.display = "none";
    });
  }

  let saved = null;
  try {
    saved = localStorage.getItem("videoMuted");
  } catch (e) {}
  if (saved === null) {
    try {
      localStorage.setItem("videoMuted", "true");
    } catch (e) {}
    update(true);
  } else {
    update(saved === "true");
  }
}
