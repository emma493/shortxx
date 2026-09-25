/* js/features/progress.js — video progress bar seek + fill only. */

export async function init() {
  const video = document.getElementById("main-video");
  const wrap = document.getElementById("ntok-progress");
  const fill = document.getElementById("ntok-progress-fill");
  if (!video || !wrap || !fill) return;

  const setFill = () => {
    if (!video.duration) return;
    const ratio = video.currentTime / video.duration;
    fill.style.transform = "scaleX(" + ratio + ")";
    wrap.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  };

  video.addEventListener("timeupdate", setFill);
  video.addEventListener("loadedmetadata", setFill);

  const seek = (e) => {
    const rect = wrap.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const ratio = Math.min(Math.max(x / rect.width, 0), 1);
    if (video.duration) {
      video.currentTime = ratio * video.duration;
      setFill();
    }
  };

  let seeking = false;
  wrap.addEventListener("pointerdown", (e) => {
    seeking = true;
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch (err) {}
    seek(e);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (seeking) seek(e);
  });
  wrap.addEventListener("pointerup", () => {
    seeking = false;
  });
  wrap.addEventListener("pointercancel", () => {
    seeking = false;
  });
}
