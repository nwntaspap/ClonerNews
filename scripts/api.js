/**
 * api.js
 * All communication with the HN Firebase API and Algolia search API.
 *
 * Stories / Jobs  → HN Firebase REST API
 * Polls           → Algolia HN search API (HN has no dedicated poll endpoint
 *                   and polls are too rare to find via topstories scanning)
 */

const API_BASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA_BASE = "https://hn.algolia.com/api/v1/search_by_date?tags=poll";

/* ============================================================
   SIMPLE IN-MEMORY CACHE
   key -> { value, expiresAt }
   ============================================================ */
const cache = new Map();
const CACHE_TTL_MS = 60_000; // 1 minute

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

/* ============================================================
   THROTTLE
   Returns a version of fn that can only fire once per delay ms.
   ============================================================ */
function throttle(fn, delay) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

/* ============================================================
   CORE FETCH HELPER (HN Firebase)
   ============================================================ */
async function apiFetch(path) {
  const cached = cacheGet(path);
  if (cached !== null) return cached;

  const response = await fetch(`${API_BASE}${path}.json`);
  if (!response.ok)
    throw new Error(`API error: ${response.status} for ${path}`);

  const data = await response.json();
  cacheSet(path, data);
  return data;
}

/* ============================================================
   PUBLIC API — HN Firebase
   ============================================================ */

/**
 * Fetch the list of IDs for a given story type.
 * name: 'topstories' | 'newstories' | 'jobstories' | 'askstories' | 'showstories'
 */
async function fetchIdList(name) {
  return apiFetch(`/${name}`);
}

/**
 * Fetch a single item by its ID.
 */
async function fetchItem(id) {
  return apiFetch(`/item/${id}`);
}

/**
 * Fetch multiple items by an array of IDs.
 * Uses Promise.allSettled so one failure does not block the rest.
 */
async function fetchItems(ids) {
  const promises = ids.map((id) => fetchItem(id));
  const results = await Promise.allSettled(promises);
  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}

/* ============================================================
   PUBLIC API — Algolia (polls only)
   ============================================================ */

/**
 * Fetch one page of polls from Algolia and normalise to HN item shape.
 * Algolia uses 0-based page numbers.
 */
async function fetchPollItems(page = 0) {
  const path = `${ALGOLIA_BASE}&page=${page}`;

  const cached = cacheGet(path);
  if (cached !== null) return cached;

  const response = await fetch(path);
  if (!response.ok)
    throw new Error(`Algolia error: ${response.status} for ${path}`);

  const data = await response.json();

  // Normalise Algolia fields to match the HN item shape our UI expects
  const items = data.hits.map((poll) => ({
    by: poll.author,
    descendants: poll.num_comments,
    id: poll.objectID,
    kids: poll.children,
    parts: poll.parts,
    score: poll.points,
    time: poll.created_at_i,
    title: poll.title,
    type: "poll",
  }));

  const result = { items, totalHits: data.nbHits };
  cacheSet(path, result); // cache so switching back to polls tab is instant
  return result;
}

/**
 * Fetch a page of polls, returning the same { items, nextOffset, hasMore }
 * shape as fetchFeedPage so app.js does not need to know the difference.
 *
 * offset here is the item index (0, 20, 40...) we convert to Algolia
 * 0-based page number internally.
 */
async function fetchPolls(offset = 0, pageSize = 20) {
  const page = Math.floor(offset / pageSize);
  const { items, totalHits } = await fetchPollItems(page);
  const nextOffset = offset + pageSize;
  const hasMore = nextOffset < totalHits;
  return { items, nextOffset, hasMore };
}

/* ============================================================
   UNIFIED FEED PAGE
   ============================================================ */

/**
 * Fetch the next page of items for the current tab type.
 *
 * Stories -> /newstories  (HN pre-filters to type=story, newest first)
 * Jobs    -> /jobstories  (HN pre-filters to type=job, newest first)
 * Polls   -> Algolia poll search (HN has no dedicated poll list)
 *
 * Returns { items, nextOffset, hasMore }
 */
async function fetchFeedPage(type, offset = 0, pageSize = 20) {
  // Polls use a completely separate data source
  if (type === "poll") {
    return fetchPolls(offset, pageSize);
  }

  // Stories and jobs use the HN named lists
  const listName = type === "job" ? "jobstories" : "newstories";
  const allIds = await fetchIdList(listName);

  // Fetch 3x the page size so after filtering out any null/dead items
  // we still have enough to fill a full page of pageSize
  const sliceIds = allIds.slice(offset, offset + pageSize * 3);
  const rawItems = await fetchItems(sliceIds);

  // The named lists are pre-filtered by HN but double-check type anyway
  const filtered = rawItems.filter((item) => item.type === type);
  filtered.sort((a, b) => b.time - a.time);

  const items = filtered.slice(0, pageSize);
  const nextOffset = offset + pageSize * 3;
  const hasMore = nextOffset < allIds.length;

  return { items, nextOffset, hasMore };
}

/* ============================================================
   COMMENTS 
   ============================================================ */

/**
 * Fetch all top-level comments for a post, sorted newest -> oldest.
 * Filters out deleted and dead comments.
 */
async function fetchComments(kids) {
  if (!kids || kids.length === 0) return [];
  const comments = await fetchItems(kids);
  const alive = comments.filter((c) => c && !c.deleted && !c.dead && c.text);
  alive.sort((a, b) => b.time - a.time);
  return alive;
}

/**
 * Fetch poll option items (type === 'pollopt') for a poll.
 */
async function fetchPollOpts(parts) {
  if (!parts || parts.length === 0) return [];
  const opts = await fetchItems(parts);
  return opts.filter((o) => o && o.type === "pollopt");
}

/* ============================================================
   LIVE TICKER
   ============================================================ */

/**
 * Fetch the current highest item ID on HN.
 * Not cached — must always be fresh.
 */
async function fetchMaxItemId() {
  const response = await fetch(`${API_BASE}/maxitem.json`);
  if (!response.ok) return null;
  return response.json();
}

/**
 * Throttled version — safe to call as often as you like,
 * but the actual network request fires at most once per 5 seconds.
 */
const fetchMaxItemIdThrottled = throttle(fetchMaxItemId, 5000);
