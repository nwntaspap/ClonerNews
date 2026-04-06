/**
 * app.js
 * Wires the API and UI modules together.
 * Handles:
 *   - Tab navigation (stories / jobs / polls)
 *   - Infinite scroll via IntersectionObserver
 *   - Post detail + comments view
 *   - Live update ticker (polls maxitem every 5 seconds)
 */

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const postListEl = document.getElementById("post-list");
const postListView = document.getElementById("post-list-view");
const postDetailView = document.getElementById("post-detail-view");
const postDetailEl = document.getElementById("post-detail-content");
const commentListEl = document.getElementById("comment-list");
const commentHeadingEl = document.getElementById("comment-section-heading");
const backBtn = document.getElementById("back-btn");
const loadSentinel = document.getElementById("load-more-sentinel");
const loadSpinner = document.getElementById("load-spinner");
const navBtns = document.querySelectorAll(".nav-btn");
const logoLink = document.getElementById("logo-link");
const liveBanner = document.getElementById("live-banner");
const liveBannerText = document.getElementById("live-banner-text");
const liveBannerDismiss = document.getElementById("live-banner-dismiss");

/* ============================================================
   APP STATE
   ============================================================ */
let currentType = "story"; // 'story' | 'job' | 'poll'
let currentOffset = 0;
let isLoading = false;
let hasMore = true;
let lastMaxItemId = null; // baseline for the live ticker
let lastScrollY = 0; // restored when going back to the list

/* ============================================================
   NAVIGATION — switch between story / job / poll tabs
   ============================================================ */
navBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const type = btn.dataset.type;
    if (type === currentType) return;

    navBtns.forEach((b) => b.classList.remove("nav-btn--active"));
    btn.classList.add("nav-btn--active");

    currentType = type;
    currentOffset = 0;
    hasMore = true;
    postListEl.innerHTML = "";
    hideLiveBanner(liveBanner);
    showListView();
    loadNextPage();
  });
});

// Logo click resets to top of the stories list
logoLink.addEventListener("click", (e) => {
  e.preventDefault();
  lastScrollY = 0;
  showListView();
});

/* ============================================================
   VIEWS — toggle between list and detail
   ============================================================ */
function showListView() {
  postDetailView.hidden = true;
  postListView.hidden = false;
  window.scrollTo({ top: lastScrollY, behavior: "smooth" });
}

function showDetailView() {
  postListView.hidden = true;
  postDetailView.hidden = false;
  window.scrollTo({ top: 0 });
}

backBtn.addEventListener("click", showListView);

/* ============================================================
   LOAD A PAGE OF POSTS
   ============================================================ */
async function loadNextPage() {
  if (isLoading || !hasMore) return;

  isLoading = true;
  showSpinner(loadSpinner);

  if (currentOffset === 0) {
    showListLoading(postListEl);
  }

  try {
    const {
      items,
      nextOffset,
      hasMore: more,
    } = await fetchFeedPage(currentType, currentOffset);

    hideListLoading(postListEl);

    if (items.length === 0 && currentOffset === 0) {
      showListError(postListEl, "no posts found");
    } else {
      renderPostCards(items, postListEl);
    }

    currentOffset = nextOffset;
    hasMore = more;
  } catch (err) {
    console.error("Failed to load posts:", err);
    hideListLoading(postListEl);
    if (currentOffset === 0) {
      showListError(postListEl, "could not load posts — check your connection");
    }
  }

  isLoading = false;
  hideSpinner(loadSpinner);
}

/* ============================================================
   INFINITE SCROLL via IntersectionObserver
   The sentinel div lives permanently at the bottom of the list.
   When it enters the viewport (with 200px early margin), load more.
   ============================================================ */
let lastScrollLoad = 0;
const SCROLL_THROTTLE_MS = 1000;

const observer = new IntersectionObserver(
  (entries) => {
    const entry = entries[0];
    if (!entry.isIntersecting) return;

    const now = Date.now();
    if (now - lastScrollLoad < SCROLL_THROTTLE_MS) return;
    lastScrollLoad = now;

    if (!postListView.hidden) {
      loadNextPage();
    }
  },
  { rootMargin: "200px" },
);

observer.observe(loadSentinel);

/* ============================================================
   POST DETAIL — open on card click
   ============================================================ */
postListEl.addEventListener("click", (e) => {
  const card = e.target.closest(".post-card");
  if (!card) return;
  openPostDetail(Number(card.dataset.id));
});

async function openPostDetail(id) {
  lastScrollY = window.scrollY;
  showDetailView();

  postDetailEl.innerHTML = '<div class="state-message">loading…</div>';
  commentListEl.innerHTML = "";
  commentHeadingEl.textContent = "";

  try {
    const item = await fetchItem(id);

    if (!item) {
      postDetailEl.innerHTML =
        '<div class="state-message">could not load post</div>';
      return;
    }

    renderPostDetail(item, postDetailEl);

    // Poll options
    if (item.type === "poll" && item.parts) {
      const opts = await fetchPollOpts(item.parts);
      renderPollOptions(opts, postDetailEl);
    }

    // Comments heading uses descendants (same count HN shows)
    const commentCount = item.descendants || 0;
    commentHeadingEl.textContent = `comments (${commentCount})`;

    if (item.kids && item.kids.length > 0) {
      const comments = await fetchComments(item.kids);
      renderComments(comments, commentListEl);
    } else {
      renderComments([], commentListEl);
    }
  } catch (err) {
    console.error("Failed to load post:", err);
    postDetailEl.innerHTML =
      '<div class="state-message">could not load post</div>';
  }
}

/* ============================================================
   LIVE TICKER
   Checks /maxitem every 5 seconds.
   Shows banner if new items appeared since last check.
   ============================================================ */
const LIVE_INTERVAL_MS = 5000;

async function checkForUpdates() {
  const maxId = await fetchMaxItemIdThrottled();
  if (!maxId) return;

  if (lastMaxItemId === null) {
    lastMaxItemId = maxId; // first run — just seed the baseline
    return;
  }

  if (maxId > lastMaxItemId) {
    const newCount = maxId - lastMaxItemId;
    lastMaxItemId = maxId;

    if (!postListView.hidden) {
      showLiveBanner(
        liveBanner,
        liveBannerText,
        `${newCount} new item${newCount > 1 ? "s" : ""} on Hacker News — switch tabs to refresh`,
      );
    }
  }
}

// Dismiss via button or Escape key
liveBannerDismiss.addEventListener("click", () => hideLiveBanner(liveBanner));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideLiveBanner(liveBanner);
});

// Clicking the banner body (not the dismiss button) resets the current feed
liveBanner.addEventListener("click", (e) => {
  if (e.target === liveBannerDismiss) return;
  currentOffset = 0;
  hasMore = true;
  postListEl.innerHTML = "";
  hideLiveBanner(liveBanner);
  loadNextPage();
});

setInterval(checkForUpdates, LIVE_INTERVAL_MS);

/* ============================================================
   INITIAL LOAD
   ============================================================ */
loadNextPage();
checkForUpdates(); // seeds lastMaxItemId baseline immediately
