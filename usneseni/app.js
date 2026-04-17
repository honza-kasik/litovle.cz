(() => {
  // ============================================================
  // KONSTANTY & STAV
  // ============================================================

  const PAGE_SIZE = 20;
  const SNIPPET_LEN = 180;

  let META = {};
  let INDEX = {};
  let DATA = {};
  let DATA_MAP = {};
  let LOADED = {};
  let PAGE = 1;
  let SEARCH_SEQ = 0;
  let currentResults = [];
  let LAST_PARSED = null;

  const q = document.getElementById("usn-q");
  const res = document.getElementById("usn-results");
  const info = document.getElementById("usn-info");
  const yearsBox = document.getElementById("usn-years");
  const sortSel = document.getElementById("usn-sort");
  const orgBox = document.getElementById("usn-org");

  // ============================================================
  // NORMALIZACE
  // ============================================================

  function normalize(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // ============================================================
  // UTIL
  // ============================================================

  function anchorFromId(id) {
    return id.replace(/\//g, "-");
  }

  function staticUrlFromId(id) {
    const year = id.split("/").pop();
    const slug = anchorFromId(id);
    return `/usneseni/${year}/${slug}/`;
  }

  function idFromHash() {
    if (!location.hash) return null;
    return location.hash.substring(1).replace(/-/g, "/");
  }

  function firstSentence(u) {
    if (u.subject) return u.subject;
    if (u.items && u.items.length) return u.items[0].text;
    return "";
  }

  function extractFullText(u) {
    return normalize(
      [
        u.subject || "",
        ...(u.items || []).map(i => i.text),
        u.tail || ""
      ].join(" ")
    );
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(text, terms) {
    let out = text;

    for (const t of terms) {
      if (!t) continue;
      const re = new RegExp(`(${escapeRegExp(t)})`, "gi");
      out = out.replace(re, "<mark>$1</mark>");
    }

    return out;
  }

  // ============================================================
  // URL STATE
  // ============================================================

  function updateUrl() {
    const params = new URLSearchParams();

    if (q.value) params.set("q", q.value);

    for (const y of selectedYears()) params.append("y", y);
    for (const o of selectedOrgans()) params.append("org", o);

    params.set("sort", sortSel.value);

    history.replaceState(null, "", "?" + params.toString());
  }

  function loadFromUrl() {
    const params = new URLSearchParams(location.search);

    if (params.get("q")) q.value = params.get("q");

    const years = params.getAll("y");
    if (years.length) {
      yearsBox.querySelectorAll("input").forEach(i => {
        i.checked = years.includes(i.value);
      });
    }

    const orgs = params.getAll("org");
    if (orgs.length) {
      orgBox.querySelectorAll("input").forEach(i => {
        i.checked = orgs.includes(i.value);
      });
    }

    if (params.get("sort")) {
      sortSel.value = params.get("sort");
    }
  }

  // ============================================================
  // DATA LOAD
  // ============================================================

  async function loadYear(year) {
    if (LOADED[year]) return;

    const [index, data] = await Promise.all([
      fetch(`/assets/usneseni/index/${year}.json`).then(r => r.json()),
      fetch(`/assets/usneseni/data/${year}.json`).then(r => r.json())
    ]);

    INDEX[year] = index;
    DATA[year] = data;
    DATA_MAP[year] = Object.fromEntries(data.map(u => [u.id, u]));
    LOADED[year] = true;
  }

  function selectedYears() {
    return [...yearsBox.querySelectorAll("input:checked")].map(i => i.value);
  }

  function selectedOrgans() {
    return [...orgBox.querySelectorAll("input:checked")].map(i => i.value);
  }

  // ============================================================
  // SUMMARY
  // ============================================================

  function summaryLabel(u) {
    if (!u.items || u.items.length === 0) {
      return (u.actions || []).join(", ");
    }
    if (u.items.length === 1) {
      return u.actions && u.actions[0] ? u.actions[0] : "";
    }
    return `${u.items.length} rozhodnutí`;
  }

  // ============================================================
  // SORT & PAGING
  // ============================================================

  function sortResults(list) {
    return list.sort((a, b) => {
      if (!a.datum || !b.datum) return 0;
      return sortSel.value === "asc"
        ? a.datum.localeCompare(b.datum)
        : b.datum.localeCompare(a.datum);
    });
  }

  function paginate(list) {
    const start = (PAGE - 1) * PAGE_SIZE;
    return list.slice(start, start + PAGE_SIZE);
  }

  function renderPager(total) {
    const pages = Math.ceil(total / PAGE_SIZE);
    if (pages <= 1) return;

    const nav = document.createElement("div");
    nav.className = "usn-pager";

    function pageLink(label, page, disabled = false, current = false) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = label;

      if (current) {
        a.className = "usn-page-current";
        return a;
      }

      if (disabled) {
        a.className = "usn-page-disabled";
        return a;
      }

      a.onclick = e => {
        e.preventDefault();
        PAGE = page;
        renderResults(currentResults);
      };
      return a;
    }

    nav.appendChild(pageLink("‹ předchozí", PAGE - 1, PAGE === 1));

    const radius = 2;
    let start = Math.max(1, PAGE - radius);
    let end = Math.min(pages, PAGE + radius);

    if (start > 1) {
      nav.appendChild(pageLink("1", 1));
      if (start > 2) nav.appendChild(pageLink("…", null, true));
    }

    for (let i = start; i <= end; i++) {
      nav.appendChild(pageLink(i, i, false, i === PAGE));
    }

    if (end < pages) {
      if (end < pages - 1) nav.appendChild(pageLink("…", null, true));
      nav.appendChild(pageLink(pages, pages));
    }

    nav.appendChild(pageLink("další ›", PAGE + 1, PAGE === pages));
    res.appendChild(nav);
  }

  // ============================================================
  // SEARCH
  // ============================================================

  function parseQuery(input) {
    const raw = normalize(input);
    if (!raw) return null;

    const words = raw.split(" ");
    const longWords = words.filter(w => w.length >= 3);

    const anchor = longWords.length
      ? longWords.slice().sort((a, b) => b.length - a.length)[0]
      : null;

    return { raw, words, longWords, anchor };
  }

  async function collectCandidates(anchor, years) {
    const out = [];

    for (const y of years) {
      await loadYear(y);

      const hit = INDEX[y][anchor];
      if (!hit) continue;

      for (const id of hit) {
        const u = DATA_MAP[y][id];
        if (u) out.push(u);
      }
    }
    return out;
  }

  function matchesPhrase(u, phrase) {
    return extractFullText(u).includes(phrase);
  }

  function matchesAllTerms(u, terms) {
    const text = extractFullText(u);
    return terms.every(t => text.includes(t));
  }

  async function search() {
    PAGE = 1;
    const seq = ++SEARCH_SEQ;

    const parsed = parseQuery(q.value);
    LAST_PARSED = parsed;

    if (!parsed || !parsed.anchor) {
      res.innerHTML = "";
      info.textContent = "Zadejte hledaný výraz";
      return;
    }

    const years = selectedYears();
    const candidates = await collectCandidates(parsed.anchor, years);

    let results = candidates.filter(u =>
      matchesPhrase(u, parsed.raw)
    );

    const organs = selectedOrgans();
    results = results.filter(u => organs.includes(u.organ));

    if (!results.length && parsed.longWords.length > 1) {
      results = candidates.filter(u =>
        matchesAllTerms(u, parsed.longWords)
      );
      results = results.filter(u => organs.includes(u.organ));
    }

    results = sortResults(results);

    if (seq !== SEARCH_SEQ) return;
    updateUrl();
    renderResults(results);
  }

  // ============================================================
  // RENDER RESULTS
  // ============================================================

  function renderResults(list) {
    res.innerHTML = "";
    info.textContent = `${list.length} výsledků`;

    currentResults = list;
    const pageItems = paginate(list);

    const parsed = LAST_PARSED;

    for (const u of pageItems) {
      const staticUrl = staticUrlFromId(u.id);
      const back = encodeURIComponent(location.pathname + location.search);
      const href = `${staticUrl}?back=${back}`;

      const snippetRaw = (firstSentence(u) || "").slice(0, SNIPPET_LEN);
      const snippet = parsed
        ? highlight(snippetRaw, parsed.longWords)
        : snippetRaw;

      const hasMore = (firstSentence(u) || "").length > SNIPPET_LEN;

      const li = document.createElement("li");
      li.className = "usn-result";

      li.innerHTML = `
        <a href="${href}" class="usn-card">
          <div class="usn-head">
            <strong>${u.id}</strong>
            <span class="usn-date">${u.datum || ""}</span>
          </div>

          <div class="usn-summary">${summaryLabel(u)}</div>

          <div class="usn-snippet">${snippet}</div>

          ${hasMore ? `<div class="usn-more">…</div>` : ""}
        </a>
      `;

      res.appendChild(li);
    }

    renderPager(list.length);
  }

  // ============================================================
  // DEEP LINK
  // ============================================================

  function redirectFromHash() {
    const id = idFromHash();
    if (!id) return false;

    if (!/^(RM|ZM)\/\d+\/\d+\/\d+$/.test(id)) return false;

    window.location.replace(staticUrlFromId(id));
    return true;
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    if (redirectFromHash()) return;

    META = await fetch("/assets/usneseni/meta.json").then(r => r.json());

    for (const year of Object.keys(META).sort().reverse()) {
      const label = document.createElement("label");
      label.className = "usn-year";
      label.innerHTML = `
        <input type="checkbox" value="${year}" checked>
        ${year} (${META[year].count})
      `;
      yearsBox.appendChild(label);
    }

    loadFromUrl();

    q.addEventListener("input", search);
    yearsBox.addEventListener("change", search);
    orgBox.addEventListener("change", search);
    sortSel.addEventListener("change", search);

    search();
  }

  init();
})();