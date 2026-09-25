/* js/features/nav.js — swipe / wheel / keyboard page navigation only.
 * index.html <-> vid2.html page-reload model (unchanged). */

export async function init() {
  const nextPage = document.body.dataset.next;
  const prevPage = document.body.dataset.prev;
  const toNext = () => {
    if (nextPage) window.location.href = nextPage;
  };
  const toPrev = () => {
    if (prevPage) window.location.href = prevPage;
  };

  let touchY = 0;
  window.addEventListener("touchstart", (e) => {
    touchY = e.changedTouches[0].screenY;
  });

  window.addEventListener("touchend", (e) => {
    const y = e.changedTouches[0].screenY;
    if (touchY - y > 50) toNext();
    if (y - touchY > 50) toPrev();
  });

  let scrolling = false;
  window.addEventListener("wheel", (e) => {
    if (scrolling) return;
    if (e.deltaY > 30) {
      scrolling = true;
      toNext();
    } else if (e.deltaY < -30) {
      scrolling = true;
      toPrev();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      toNext();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      toPrev();
    }
  });
}
