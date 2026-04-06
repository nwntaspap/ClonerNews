/**
 * ui.js
 * All DOM creation and rendering lives here.
 * This module never calls the API — it only receives data and renders it.
 */

/* ============================================================
   TIME HELPER
   ============================================================ */
function timeAgo(unixSeconds) {
  const seconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/* ============================================================
   DOMAIN HELPER
   ============================================================ */
function domain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return null;
  }
}

/* ============================================================
   POST CARD  (used in the list view)
   ============================================================ */
function createPostCard(item) {
  const card = document.createElement("div");
  card.className = "post-card";
  card.dataset.id = item.id;

  const type = item.type || "story";

  // Title
  const title = document.createElement("div");
  title.className = "post-card__title";
  title.textContent = item.title || "(untitled)";

  // Badge
  const badge = document.createElement("span");
  badge.className = `post-card__badge post-card__badge--${type}`;
  badge.textContent = type;

  // Optional URL line
  const urlHost = domain(item.url);
  let urlEl = null;
  if (urlHost) {
    urlEl = document.createElement("div");
    urlEl.className = "post-card__url";
    urlEl.textContent = urlHost;
  }

  // Meta row
  const meta = document.createElement("div");
  meta.className = "post-card__meta";

  const metaItems = [];

  if (item.by) {
    metaItems.push({ label: item.by, cls: "post-card__meta-item--author" });
  }
  if (typeof item.score === "number") {
    metaItems.push({
      label: `▲ ${item.score}`,
      cls: "post-card__meta-item--score",
    });
  }
  if (item.descendants != null) {
    metaItems.push({ label: `${item.descendants} comments`, cls: "" });
  }
  if (item.time) {
    metaItems.push({ label: timeAgo(item.time), cls: "" });
  }

  metaItems.forEach(({ label, cls }) => {
    const span = document.createElement("span");
    span.className = `post-card__meta-item ${cls}`.trim();
    span.textContent = label;
    meta.appendChild(span);
  });

  card.appendChild(title);
  card.appendChild(badge);
  if (urlEl) card.appendChild(urlEl);
  card.appendChild(meta);

  return card;
}

/**
 * Append an array of items to the post list element.
 */
function renderPostCards(items, listEl) {
  items.forEach((item) => {
    const card = createPostCard(item);
    listEl.appendChild(card);
  });
}

/* ============================================================
   POST DETAIL  (full view)
   ============================================================ */
function renderPostDetail(item, detailEl) {
  detailEl.innerHTML = "";

  const type = item.type || "story";

  // Type label
  const typeLabel = document.createElement("div");
  typeLabel.className = "post-detail__type-label";
  typeLabel.textContent = type;
  detailEl.appendChild(typeLabel);

  // Title
  const title = document.createElement("h1");
  title.className = "post-detail__title";
  title.textContent = item.title || "(untitled)";
  detailEl.appendChild(title);

  // External URL
  if (item.url) {
    const link = document.createElement("a");
    link.className = "post-detail__url";
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.url;
    detailEl.appendChild(link);
  }

  // Body text (HN sends HTML)
  if (item.text) {
    const body = document.createElement("div");
    body.className = "post-detail__text";
    body.innerHTML = item.text; // HN already sanitises this
    detailEl.appendChild(body);
  }

  // Meta
  const meta = document.createElement("div");
  meta.className = "post-detail__meta";

  const metaParts = [];
  if (item.by)
    metaParts.push({ t: item.by, c: "post-detail__meta-item--author" });
  if (typeof item.score === "number")
    metaParts.push({
      t: `▲ ${item.score} points`,
      c: "post-detail__meta-item--score",
    });
  if (item.time) metaParts.push({ t: timeAgo(item.time), c: "" });

  metaParts.forEach(({ t, c }) => {
    const span = document.createElement("span");
    span.className = c;
    span.textContent = t;
    meta.appendChild(span);
  });

  detailEl.appendChild(meta);

  return detailEl;
}

/**
 * Render poll options below the post detail.
 */
function renderPollOptions(opts, detailEl) {
  if (!opts || opts.length === 0) return;

  const section = document.createElement("div");
  section.className = "poll-options";

  const heading = document.createElement("div");
  heading.className = "poll-options__heading";
  heading.textContent = "options";
  section.appendChild(heading);

  opts.forEach((opt) => {
    const row = document.createElement("div");
    row.className = "poll-option";

    const text = document.createElement("span");
    text.className = "poll-option__text";
    text.textContent = opt.text || "";

    const score = document.createElement("span");
    score.className = "poll-option__score";
    score.textContent = `▲ ${opt.score || 0}`;

    row.appendChild(text);
    row.appendChild(score);
    section.appendChild(row);
  });

  detailEl.appendChild(section);
}

/* ============================================================
   COMMENT CARD
   ============================================================ */
function createCommentCard(comment) {
  const card = document.createElement("div");
  card.className = "comment-card";

  // Header
  const header = document.createElement("div");
  header.className = "comment-card__header";

  const author = document.createElement("span");
  author.className = "comment-card__author";
  author.textContent = comment.by || "[deleted]";

  const time = document.createElement("span");
  time.className = "comment-card__time";
  time.textContent = comment.time ? timeAgo(comment.time) : "";

  header.appendChild(author);
  header.appendChild(time);

  // Body
  const body = document.createElement("div");
  body.className = "comment-card__body";
  body.innerHTML = comment.text || "";

  card.appendChild(header);
  card.appendChild(body);

  return card;
}

/**
 * Render an array of comments (tree structure) into the comment list element.
 */
function renderComments(comments, listEl) {
  listEl.innerHTML = "";

  if (comments.length === 0) {
    const empty = document.createElement("div");
    empty.className = "state-message";
    empty.innerHTML = '<div class="state-message__icon">○</div>no comments yet';
    listEl.appendChild(empty);
    return;
  }

  comments.forEach((comment) => {
    const card = createCommentCard(comment);
    listEl.appendChild(card);
  });
}

/* ============================================================
   LOADING / ERROR STATES
   ============================================================ */
function showListLoading(listEl) {
  if (listEl.children.length > 0) return;
  const msg = document.createElement("div");
  msg.className = "state-message";
  msg.id = "loading-message";
  msg.innerHTML = '<div class="state-message__icon">·</div>loading...';
  listEl.appendChild(msg);
}

function hideListLoading(listEl) {
  const msg = listEl.querySelector("#loading-message");
  if (msg) msg.remove();
}

function showListError(listEl, message) {
  listEl.innerHTML = "";
  const msg = document.createElement("div");
  msg.className = "state-message";
  msg.innerHTML = `<div class="state-message__icon">!</div>${message}`;
  listEl.appendChild(msg);
}

function showSpinner(spinnerEl) {
  spinnerEl.classList.add("load-more-sentinel__spinner--visible");
}

function hideSpinner(spinnerEl) {
  spinnerEl.classList.remove("load-more-sentinel__spinner--visible");
}

/* ============================================================
   LIVE BANNER
   ============================================================ */
function showLiveBanner(bannerEl, textEl, message) {
  textEl.textContent = message;
  bannerEl.hidden = false;

  const height = bannerEl.offsetHeight;
  document.body.style.setProperty("--banner-height", `${height}px`);
  document.body.classList.add("banner-visible");
}

function hideLiveBanner(bannerEl) {
  bannerEl.hidden = true;
  document.body.classList.remove("banner-visible");
  document.body.style.removeProperty("--banner-height");
}
