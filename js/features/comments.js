import { formatCount, getComments, postComment } from "../../vid.js";
import { store, displayIdentity } from "../store.js";

/* js/features/comments.js — comments drawer only. */

export async function init(ctx) {
  const commentsBtn = document.querySelector(".comments-btn");
  const commentsCountEl = document.querySelector(".comments-count");
  if (!commentsBtn) return;
  const toast = ctx.toast || (() => {});
  let sheet = null;
  let listEl = null;
  let titleEl = null;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));

  function build() {
    if (sheet) return sheet;
    const wrap = document.createElement("div");
    wrap.className = "sx-comments";
    wrap.style.display = "none";
    wrap.innerHTML =
      '<div data-close class="sx-comments-backdrop"></div>' +
      '<div role="dialog" aria-label="Comments" class="sx-comments-card">' +
      '<div class="sx-comments-head"><div data-title>Comments (0)</div>' +
      '<button data-close aria-label="Close comments" class="sx-comments-x">✕</button></div>' +
      '<div data-list class="sx-comments-list"></div>' +
      '<form data-form class="sx-comments-form">' +
      '<input data-input maxlength="300" placeholder="Add a comment…" autocomplete="off" class="sx-comments-input" />' +
      '<button type="submit" class="sx-comments-post">Post</button></form></div>';
    document.body.appendChild(wrap);
    sheet = wrap;
    listEl = wrap.querySelector("[data-list]");
    titleEl = wrap.querySelector("[data-title]");
    wrap.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", () => {
        wrap.style.display = "none";
      }),
    );
    wrap.querySelector("[data-form]").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = wrap.querySelector("[data-input]");
      const id = await postComment(store.videoId, displayIdentity(), input.value);
      if (id) {
        input.value = "";
        await refresh();
      } else {
        toast("Could not post — check connection");
      }
    });
    return wrap;
  }

  async function refresh() {
    const list = await getComments(store.videoId);
    if (titleEl) titleEl.textContent = "Comments (" + list.length + ")";
    if (commentsCountEl) commentsCountEl.textContent = formatCount(list.length);
    if (listEl) {
      listEl.innerHTML = list.length
        ? list
            .map(
              (c) =>
                '<div class="sx-comment-row"><div class="sx-comment-avatar">' +
                esc((c.name || "?").slice(0, 1).toUpperCase()) +
                '</div><div class="sx-comment-body"><div class="sx-comment-name">' +
                esc(c.name) +
                '</div><div class="sx-comment-text">' +
                esc(c.text) +
                "</div></div></div>",
            )
            .join("")
        : '<div class="sx-comments-empty">No comments yet — be the first.</div>';
      listEl.scrollTop = listEl.scrollHeight;
    }
  }

  commentsBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    build().style.display = "";
    if (listEl) listEl.innerHTML = '<div class="sx-comments-empty">Loading…</div>';
    await refresh();
  });
}
