(() => {
  // ============================================================
  // KONSTANTY & STAV
  // ============================================================

  const PAGE_SIZE = 20;
  const SNIPPET_LEN = 180;

  let META = {};
  let RO_META = {};
  let INDEX = {};
  let DATA = {};
  let DATA_MAP = {};
  let RO_INDEX = {};
  let RO_DATA = {};
  let RO_DATA_MAP = {};
  let LOADED = {};
  let PAGE = 1;
  let SEARCH_SEQ = 0;
  let currentResults = [];
  let LAST_PARSED = null;
  let HAS_ACTIVE_SEARCH = false;
  let LANDING_MANUALLY_OPEN = false;
  let LANDING_HIDE_TIMER = null;
  let LANDING_VISIBLE = true;

  const q = document.getElementById("usn-q");
  const res = document.getElementById("usn-results");
  const resultsPanel = document.getElementById("usn-results-panel");
  const resultsCount = document.getElementById("usn-results-count");
  const resultsKicker = document.getElementById("usn-results-kicker");
  const resultsActions = document.getElementById("usn-results-actions");
  const startBox = document.getElementById("usn-start");
  const searchPanel = document.querySelector(".usn-search-panel");
  const backToTopButton = document.getElementById("usn-back-to-top");
  const refineToggle = document.getElementById("usn-refine-toggle");
  const yearsBox = document.getElementById("usn-years");
  const yearPresetsBox = document.getElementById("usn-year-presets");
  const sortSel = document.getElementById("usn-sort");
  const sortOptions = document.getElementById("usn-sort-options");
  const typeBox = document.getElementById("usn-type");
  const orgBox = document.getElementById("usn-org");
  const LOCAL_PARTS = ["Unčovice", "Nasobůrky", "Myslechovice", "Chořelice", "Nová Ves"];
  const STARTER_QUERIES = [
    { label: "Školy a školky", query: "škola" },
    { label: "Doprava a chodníky", query: "chodník" },
    { label: "Sport a kultura", query: "sokolovna" },
    { label: "Místní části", queries: LOCAL_PARTS },
    { label: "Dotace a dary", query: "dotace" },
    { label: "Odpady a zeleň", query: "odpad" }
  ];
  const STARTER_PLACES = [
    "Litovel",
    ...LOCAL_PARTS
  ];

  // ============================================================
  // NORMALIZACE
  // ============================================================

  // Normalize both indexed text and user input to a comparable ASCII form.
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

  // Convert exported IDs into slug-like fragments used in URLs and anchors.
  function anchorFromId(id) {
    return id.replace(/\//g, "-");
  }

  function rzAnchorFromId(id) {
    return `rz-${anchorFromId(id).toLowerCase()}`;
  }

  function staticUrlFromId(id) {
    if (id.startsWith("RO/")) {
      return `/rozpoctova-opatreni/${anchorFromId(id)}/`;
    }

    const year = id.split("/").pop();
    const slug = anchorFromId(id);
    return `/usneseni/${year}/${slug}/`;
  }

  function idFromHash() {
    if (!location.hash) return null;
    return location.hash.substring(1).replace(/-/g, "/");
  }

  // Pick a short sentence that can stand in as a result snippet.
  function firstSentence(u) {
    if (u.id && u.id.startsWith("RO/")) {
      const note = u.notes && u.notes.length ? u.notes[0].text : "";
      if (note) return note;

      for (const section of u.sections || []) {
        const row = section.rows && section.rows.length ? section.rows[0] : null;
        if (row && row.description) return row.description;
      }

      return "";
    }

    if (u.subject) return u.subject;
    if (u.items && u.items.length) return u.items[0].text;
    return "";
  }

  // Build a broad searchable text blob from the exported payload.
  function extractFullText(u) {
    if (u.id && u.id.startsWith("RO/")) {
      return normalize(
        [
          u.id || "",
          u.approved_by || "",
          u.approval_date || "",
          ...(u.source_resolutions || []),
          ...(u.budget_change_ids || []),
          ...(u.notes || []).flatMap(note => [note.title || "", note.text || ""]),
          ...(u.sections || []).flatMap(section => [
            section.label || "",
            ...(section.rows || []).flatMap(row => [
              row.budget_change_id || "",
              ...(row.raw_codes || []),
              row.amount || "",
              row.description || ""
            ])
          ])
        ].join(" ")
      );
    }

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

  // Expand compact organ codes to the reader-facing labels used by filters.
  function normalizedOrgan(u) {
    if (!u || !u.organ) return "";
    if (u.organ === "RM") return "Rada města Litovel";
    if (u.organ === "ZM") return "Zastupitelstvo města Litovel";
    return u.organ;
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

  // Result cards are rendered from templates, so snippets must be escaped.
  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Some landing chips intentionally rotate through several related queries.
  function starterQueryFor(item) {
    if (Array.isArray(item.queries) && item.queries.length) {
      return item.queries[Math.floor(Math.random() * item.queries.length)];
    }
    return item.query || "";
  }

  function cleanRoSnippet(text) {
    return (text || "").replace(/\s*\(RZ\s+\d+\/\d{4}\/(?:RM|ZM)\)\s*$/i, "").trim();
  }

  // Keep ARIA busy in sync while async searches are in flight.
  function setBusy(loading) {
    res.setAttribute("aria-busy", loading ? "true" : "false");
  }

  // Return to the top where the search panel and page intro live.
  function scrollSearchIntoView() {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  // The mobile-only shortcut appears only after the user scrolls deeper down.
  function updateBackToTopVisibility() {
    if (!backToTopButton) return;
    backToTopButton.classList.toggle("is-visible", window.innerWidth <= 700 && window.scrollY > 700);
  }

  // Rank RO note/row snippets so the best contextual match appears first.
  function rankRoChunk(chunk, parsed) {
    const text = chunk.text;
    const hasPhrase = text.includes(parsed.raw);
    const hasAllTerms = parsed.longWords.length > 1
      && parsed.longWords.every(term => text.includes(term));
    const termHits = parsed.longWords.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
    const snippetLength = (chunk.snippet || "").length;

    if (hasPhrase && chunk.kind === "note") return 4000 + termHits * 100 + snippetLength;
    if (hasPhrase && chunk.kind === "row") return 3000 + termHits * 100 + snippetLength;
    if (hasAllTerms && chunk.kind === "note") return 2000 + termHits * 100 + snippetLength;
    if (hasAllTerms && chunk.kind === "row") return 1000 + termHits * 100 + snippetLength;
    return termHits * 100 + snippetLength;
  }

  function findRoMatchContext(u, parsed) {
    if (!u || !u.id || !u.id.startsWith("RO/") || !parsed) return null;

    const chunks = [];

    for (const note of u.notes || []) {
      const match = (note.title || "").match(/(\d+\/\d{4}\/(?:RM|ZM))/i);
      const text = normalize(`${note.title || ""} ${note.text || ""}`);
      if (!text) continue;
      chunks.push({
        kind: "note",
        anchor: match ? rzAnchorFromId(match[1]) : "",
        label: match ? match[1] : "Poznámka",
        snippet: note.text || note.title || "",
        text
      });
    }

    for (const section of u.sections || []) {
      const groups = new Map();

      for (const row of section.rows || []) {
        const budgetChangeId = row.budget_change_id || "";
        const key = budgetChangeId || `row-${groups.size}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(row);
      }

      for (const [budgetChangeId, rows] of groups) {
        const rowChunks = rows.map((row, index) => ({
          index,
          text: normalize([
            row.budget_change_id || "",
            ...(row.raw_codes || []),
            row.amount || "",
            row.description || ""
          ].join(" ")),
          snippet: row.description || row.budget_change_id || ""
        }));

        const matchingRows = rowChunks
          .filter(row =>
            row.text.includes(parsed.raw)
            || (parsed.longWords.length > 1 && parsed.longWords.every(term => row.text.includes(term)))
          )
          .sort((a, b) => {
            const aScore = rankRoChunk({ kind: "row", text: a.text, snippet: a.snippet }, parsed);
            const bScore = rankRoChunk({ kind: "row", text: b.text, snippet: b.snippet }, parsed);
            return bScore - aScore || a.index - b.index;
          });

        const bestRow = matchingRows[0] || rowChunks[0];
        const groupText = normalize(rows.map(row => [
          row.budget_change_id || "",
          ...(row.raw_codes || []),
          row.amount || "",
          row.description || ""
        ].join(" ")).join(" "));

        if (!groupText) continue;
        chunks.push({
          kind: "row",
          anchor: budgetChangeId ? rzAnchorFromId(budgetChangeId) : "",
          label: budgetChangeId || "Řádek",
          snippet: bestRow ? bestRow.snippet : budgetChangeId || "",
          text: groupText
        });
      }
    }

    const matched = chunks
      .filter(chunk =>
        chunk.text.includes(parsed.raw)
        || (parsed.longWords.length > 1 && parsed.longWords.every(term => chunk.text.includes(term)))
      )
      .map((chunk, index) => ({ ...chunk, score: rankRoChunk(chunk, parsed), index }))
      .sort((a, b) => b.score - a.score || a.index - b.index);

    if (!matched.length) return null;

    const seen = new Set();
    const topMatches = [];
    let totalMatches = 0;
    for (const match of matched) {
      const dedupeKey = `${match.anchor}|${match.label}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      totalMatches += 1;
      if (topMatches.length < 3) {
        topMatches.push(match);
      }
    }

    return {
      anchor: topMatches[0].anchor,
      snippet: cleanRoSnippet(topMatches[0].snippet),
      matches: topMatches,
      totalMatches
    };
  }

  // ============================================================
  // URL STATE
  // ============================================================

  // Keep the current search state in the URL so reload/share works.
  function updateUrl() {
    const params = new URLSearchParams();

    if (q.value) params.set("q", q.value);

    for (const y of selectedYears()) params.append("y", y);
    for (const t of selectedTypes()) params.append("type", t);
    for (const o of selectedOrgans()) params.append("org", o);

    params.set("sort", sortSel.value);

    history.replaceState(null, "", "?" + params.toString());
  }

  // Restore filters and the current query from the page URL.
  function loadFromUrl() {
    const params = new URLSearchParams(location.search);

    if (params.get("q")) q.value = params.get("q");

    const years = params.getAll("y");
    if (years.length) {
      yearsBox.querySelectorAll("input").forEach(i => {
        i.checked = years.includes(i.value);
      });
    }

    const types = params.getAll("type");
    if (types.length) {
      typeBox.querySelectorAll("input").forEach(i => {
        i.checked = types.includes(i.value);
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

  // Load one year's index and detail payload lazily on demand.
  async function loadYear(year) {
    if (LOADED[year]) return;

    const [indexRes, dataRes, roIndexRes, roDataRes] = await Promise.allSettled([
      fetch(`/assets/usneseni/index/${year}.json`),
      fetch(`/assets/usneseni/data/${year}.json`),
      fetch(`/assets/usneseni/ro/index/${year}.json`),
      fetch(`/assets/usneseni/ro/data/${year}.json`)
    ]);

    INDEX[year] = {};
    DATA[year] = [];
    DATA_MAP[year] = {};
    RO_INDEX[year] = {};
    RO_DATA[year] = [];
    RO_DATA_MAP[year] = {};

    if (indexRes.status === "fulfilled" && indexRes.value.ok) {
      INDEX[year] = await indexRes.value.json();
    }
    if (dataRes.status === "fulfilled" && dataRes.value.ok) {
      DATA[year] = await dataRes.value.json();
      DATA_MAP[year] = Object.fromEntries(DATA[year].map(u => [u.id, u]));
    }
    if (roIndexRes.status === "fulfilled" && roIndexRes.value.ok) {
      RO_INDEX[year] = await roIndexRes.value.json();
    }
    if (roDataRes.status === "fulfilled" && roDataRes.value.ok) {
      RO_DATA[year] = await roDataRes.value.json();
      RO_DATA_MAP[year] = Object.fromEntries(RO_DATA[year].map(u => [u.id, u]));
    }

    LOADED[year] = true;
  }

  // Read the current filter UI state.
  function selectedYears() {
    return [...yearsBox.querySelectorAll("input:checked")].map(i => i.value);
  }

  function setSelectedYears(years) {
    const selected = new Set(years);
    yearsBox.querySelectorAll("input").forEach(input => {
      input.checked = selected.has(input.value);
    });
  }

  function filtersAreDefault() {
    return (
      [...yearsBox.querySelectorAll("input")].every(input => input.checked)
      && [...typeBox.querySelectorAll("input")].every(input => input.checked)
      && [...orgBox.querySelectorAll("input")].every(input => input.checked)
      && sortSel.value === "desc"
    );
  }

  function syncSortChips() {
    if (!sortOptions) return;
    sortOptions.querySelectorAll("[data-sort-value]").forEach(button => {
      const active = button.dataset.sortValue === sortSel.value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function selectedOrgans() {
    return [...orgBox.querySelectorAll("input:checked")].map(i => i.value);
  }

  function selectedTypes() {
    return [...typeBox.querySelectorAll("input:checked")].map(i => i.value);
  }

  // ============================================================
  // SUMMARY
  // ============================================================

  // Produce the short line shown under each result header.
  function summaryLabel(u) {
    if (u.id && u.id.startsWith("RO/")) {
      return normalizedOrgan(u) || u.approved_by || "";
    }

    if (!u.items || u.items.length === 0) {
      return (u.actions || []).join(", ");
    }
    if (u.items.length === 1) {
      return u.actions && u.actions[0] ? u.actions[0] : "";
    }
    return `${u.items.length} rozhodnutí`;
  }

  // Shared renderer for “too short”, “not found” and cleared-search states.
  function renderEmptyResultsState({ title, message, hints = [] }) {
    res.innerHTML = `
      <li class="usn-empty-state">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${hints.length
          ? `<ul class="usn-empty-list">${hints.map(hint => `<li>${escapeHtml(hint)}</li>`).join("")}</ul>`
          : ""}
      </li>
    `;
  }

  // Animate the landing/tips block without removing it from layout immediately.
  function setLandingVisibility(visible) {
    LANDING_VISIBLE = visible;
    if (LANDING_HIDE_TIMER) {
      clearTimeout(LANDING_HIDE_TIMER);
      LANDING_HIDE_TIMER = null;
    }

    if (visible) {
      startBox.hidden = false;
      startBox.classList.add("is-collapsed");
      void startBox.offsetHeight;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          startBox.classList.remove("is-collapsed");
        });
      });
      return;
    }

    startBox.classList.add("is-collapsed");
    LANDING_HIDE_TIMER = window.setTimeout(() => {
      startBox.hidden = true;
      LANDING_HIDE_TIMER = null;
    }, 280);
  }

  // Mobile uses a collapsed filter tray; desktop keeps filters visible.
  function setMobileFiltersOpen(open) {
    if (!searchPanel) return;
    searchPanel.classList.toggle("is-open", open);
    if (refineToggle) {
      refineToggle.textContent = open ? "Skrýt upřesnění" : "Upřesnit hledání";
      refineToggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
  }

  // Secondary actions belong only in the results header.
  function setResultsActions({ showLandingToggle = false } = {}) {
    if (!resultsActions) return;
    const isMobile = window.innerWidth <= 700;
    const toggle = showLandingToggle && !isMobile
      ? `<button type="button" class="usn-start-toggle" data-toggle-start>${LANDING_VISIBLE ? "Skrýt" : "Zobrazit"} témata a tipy</button>`
      : "";
    resultsActions.innerHTML = toggle;
  }

  // The landing screen needs only light metadata, not the whole archive payload.
  async function loadLandingData() {
    const years = [...new Set([...Object.keys(META), ...Object.keys(RO_META)])]
      .sort()
      .reverse()
      .slice(0, 2);

    await Promise.all(years.map(year => loadYear(year)));
  }

  function renderStartState() {
    const totalResolutions = Object.values(META).reduce((sum, item) => sum + (item?.count || 0), 0);
    const totalBudgetDocs = Object.values(RO_META).reduce((sum, item) => sum + (item?.count || 0), 0);

    startBox.innerHTML = `
      <section class="usn-start-hero">
        <span class="usn-start-kicker">Co se ve městě řeší</span>
        <h2>Najděte usnesení podle tématu, místa nebo služby</h2>
        <p>
          Vyhledávání je dobré, když víte co hledat. Začněte některým z témat níže
          nebo si otevřete to, co se týká vaší části města.
        </p>
        <div class="usn-chip-list">
          ${STARTER_QUERIES.map(item => `
            <button type="button" class="usn-chip" data-query="${escapeHtml(starterQueryFor(item))}">
              ${escapeHtml(item.label)}
            </button>
          `).join("")}
        </div>
      </section>

      <div class="usn-start-grid">
        <section class="usn-start-section">
          <h3>Hledejte podle místa</h3>
          <p>Otevřete si přímo to, co se týká vaší části města nebo školy.</p>
          <div class="usn-chip-list">
            ${STARTER_PLACES.map(place => `
              <button type="button" class="usn-chip usn-chip-secondary" data-query="${escapeHtml(place)}">
                ${escapeHtml(place)}
              </button>
            `).join("")}
          </div>
        </section>

        <section class="usn-start-section">
          <h3>V datech najdete</h3>
          <p>${totalResolutions} usnesení a ${totalBudgetDocs} rozpočtových opatření v aktuálním období.</p>
          <div class="usn-start-links">
            <a href="/usneseni/2026/">Nejnovější rok</a>
            <a href="/rozpoctova-opatreni/">Rozpočtová opatření</a>
          </div>
        </section>
      </div>
    `;
  }

  // ============================================================
  // SORT & PAGING
  // ============================================================

  function sortResults(list) {
    return list.sort((a, b) => {
      const aDate = a.datum || a.approval_date || "";
      const bDate = b.datum || b.approval_date || "";

      if (!aDate || !bDate) return 0;
      return sortSel.value === "asc"
        ? aDate.localeCompare(bDate)
        : bDate.localeCompare(aDate);
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

  // Pull likely candidates only from selected years and the strongest anchor term.
  async function collectCandidates(anchor, years) {
    const out = new Map();

    for (const y of years) {
      await loadYear(y);

      const resolutionHit = INDEX[y][anchor] || [];
      const roHit = RO_INDEX[y][anchor] || [];

      for (const id of resolutionHit) {
        const u = DATA_MAP[y][id];
        if (u) out.set(id, u);
      }

      for (const id of roHit) {
        const u = RO_DATA_MAP[y][id];
        if (u) out.set(id, u);
      }
    }

    return [...out.values()];
  }

  function matchesPhrase(u, phrase) {
    return extractFullText(u).includes(phrase);
  }

  function matchesAllTerms(u, terms) {
    const text = extractFullText(u);
    return terms.every(t => text.includes(t));
  }

  // Keep all header/result-state toggles in one place.
  function showResultsState({ count = "", query = "", showLandingToggle = false } = {}) {
    resultsPanel.hidden = false;
    resultsCount.textContent = count;
    resultsKicker.textContent = query ? `pro dotaz „${query}”` : "";
    setResultsActions({ showLandingToggle });
  }

  function clearResultsState() {
    resultsPanel.hidden = true;
    resultsCount.textContent = "";
    resultsKicker.textContent = "";
    setResultsActions();
    res.innerHTML = "";
  }

  function renderClearedSearchState() {
    showResultsState({ showLandingToggle: true });
    renderEmptyResultsState({
      title: "Začněte znovu novým dotazem",
      message: "Napište téma, místo, službu nebo část města, která vás zajímá.",
      hints: [
        "zkuste například „škola“, „Nová Ves“, „dotace“ nebo „chodník“",
        "můžete použít i filtry pro rok, typ dokumentu nebo schvalující orgán"
      ]
    });
  }

  function renderShortQueryState(query) {
    showResultsState({
      query,
      showLandingToggle: true
    });
    renderEmptyResultsState({
      title: "Zkuste přidat přesnější výraz",
      message: "Vyhledávání funguje nejlépe od tří písmen nebo z více slov.",
      hints: [
        "místo „šk“ zkuste „škola“, „školka“ nebo konkrétní školu",
        "místo „no“ zkuste „Nová Ves“ nebo „chodník“",
        "můžete přidat i místo: „Unčovice“, „Nasobůrky“, „Litovel“"
      ]
    });
  }

  function documentMatchesCurrentFilters(u, types, organs) {
    const matchesType = (u.id.startsWith("RO/") && types.includes("ro"))
      || (!u.id.startsWith("RO/") && types.includes("usneseni"));
    return matchesType && organs.includes(normalizedOrgan(u));
  }

  function filterByCurrentFilters(list, types, organs) {
    return list.filter(u => documentMatchesCurrentFilters(u, types, organs));
  }

  // Search in two passes: exact normalized phrase first, all terms second.
  async function findResults(parsed) {
    const candidates = await collectCandidates(parsed.anchor, selectedYears());
    const types = selectedTypes();
    const organs = selectedOrgans();

    let results = filterByCurrentFilters(
      candidates.filter(u => matchesPhrase(u, parsed.raw)),
      types,
      organs
    );

    if (!results.length && parsed.longWords.length > 1) {
      results = filterByCurrentFilters(
        candidates.filter(u => matchesAllTerms(u, parsed.longWords)),
        types,
        organs
      );
    }

    return sortResults(results);
  }

  function renderResultCard(u, parsed) {
    const staticUrl = staticUrlFromId(u.id);
    const roMatch = u.id.startsWith("RO/")
      ? findRoMatchContext(u, parsed)
      : null;
    const href = `${staticUrl}?back=${encodeURIComponent(location.pathname + location.search)}`;

    const snippetRaw = ((roMatch && roMatch.snippet) || firstSentence(u) || "").slice(0, SNIPPET_LEN);
    const snippet = parsed
      ? highlight(snippetRaw, parsed.longWords)
      : snippetRaw;

    const isRo = u.id.startsWith("RO/");
    const typeLabel = isRo ? "Rozpočtové opatření" : "Usnesení";
    const li = document.createElement("li");

    li.className = "usn-result";
    li.innerHTML = `
      <a href="${href}" class="usn-card">
        <div class="usn-head">
          <strong>${u.id}</strong>
          <span class="usn-date">${u.datum || u.approval_date || ""}</span>
          <span class="usn-doc-type ${isRo ? "usn-doc-type-ro" : "usn-doc-type-usn"}">${typeLabel}</span>
        </div>

        <div class="usn-summary">${summaryLabel(u)}</div>

        ${isRo ? "" : `<div class="usn-snippet">${snippet}</div>`}

        ${roMatch && roMatch.matches && roMatch.matches.length
          ? `<div class="usn-ro-matches">${
            roMatch.matches.map((match, index) => `
              <a href="${href}${match.anchor ? `#${match.anchor}` : ""}" class="usn-ro-match-item">
                <span class="usn-ro-match-badge">${index === 0 ? "Shoda" : "Další"}</span>
                <strong>${match.label}</strong>
                <span>${highlight((cleanRoSnippet(match.snippet) || match.label).slice(0, SNIPPET_LEN), parsed.longWords)}</span>
              </a>
            `).join("")
          }${
            roMatch.totalMatches > roMatch.matches.length
              ? `<div class="usn-ro-match-more">+${roMatch.totalMatches - roMatch.matches.length} další shody v tomto rozpočtovém opatření</div>`
              : ""
          }</div>`
          : ""}
      </a>
    `;

    return li;
  }

  // Main search orchestration: parse input, load candidates, then render state/results.
  async function search() {
    PAGE = 1;
    const seq = ++SEARCH_SEQ;
    const hasQuery = Boolean(q.value.trim());

    const parsed = parseQuery(q.value);
    LAST_PARSED = parsed;

    if (!parsed || !parsed.anchor) {
      setLandingVisibility(hasQuery ? LANDING_MANUALLY_OPEN : (!HAS_ACTIVE_SEARCH || LANDING_MANUALLY_OPEN));
      setBusy(false);
      if (!parsed) {
        if (HAS_ACTIVE_SEARCH) {
          renderClearedSearchState();
        } else {
          clearResultsState();
        }
        return;
      }

      renderShortQueryState(q.value.trim());
      return;
    }

    HAS_ACTIVE_SEARCH = true;
    if (window.innerWidth <= 700) {
      setMobileFiltersOpen(false);
    }
    setLandingVisibility(LANDING_MANUALLY_OPEN);
    setBusy(true);
    const results = await findResults(parsed);

    if (seq !== SEARCH_SEQ) return;
    updateUrl();
    renderResults(results);
    setBusy(false);
  }

  // ============================================================
  // RENDER RESULTS
  // ============================================================

  function renderResults(list) {
    res.innerHTML = "";
    setLandingVisibility(LANDING_MANUALLY_OPEN);
    showResultsState({
      count: `${list.length} výsledků`,
      query: q.value.trim(),
      showLandingToggle: true
    });

    currentResults = list;
    if (!list.length) {
      renderEmptyResultsState({
        title: "Nic jsme nenašli",
        message: "Zkuste jiný výraz nebo uvolněte některý z filtrů.",
        hints: [
          "zkuste obecnější pojem, například „škola“, „dotace“ nebo „chodník“",
          "zkuste konkrétní místo, například „Nová Ves“ nebo „Unčovice“",
          "pokud nic nenacházíte, zkontrolujte vybraný rok, typ dokumentu a schvalující orgán"
        ]
      });
      return;
    }

    const pageItems = paginate(list);
    const parsed = LAST_PARSED;
    for (const u of pageItems) {
      res.appendChild(renderResultCard(u, parsed));
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

  async function loadMeta() {
    const [metaRes, roMetaRes] = await Promise.allSettled([
      fetch("/assets/usneseni/meta.json"),
      fetch("/assets/usneseni/ro/meta.json")
    ]);

    META = metaRes.status === "fulfilled" && metaRes.value.ok
      ? await metaRes.value.json()
      : {};
    RO_META = roMetaRes.status === "fulfilled" && roMetaRes.value.ok
      ? await roMetaRes.value.json()
      : {};
  }

  function sortedYearsFromMeta() {
    return [...new Set([...Object.keys(META), ...Object.keys(RO_META)])]
      .sort()
      .reverse();
  }

  function renderYearFilters(years) {
    for (const year of years) {
      const count = (META[year]?.count || 0) + (RO_META[year]?.count || 0);
      const label = document.createElement("label");
      label.className = "usn-year";
      label.innerHTML = `
        <input type="checkbox" value="${year}" checked>
        ${year} (${count})
      `;
      yearsBox.appendChild(label);
    }
  }

  function renderYearPresets() {
    yearPresetsBox.innerHTML = `
      <button type="button" class="usn-year-preset" data-year-preset="all">Vše</button>
      <button type="button" class="usn-year-preset" data-year-preset="recent">Poslední 2 roky</button>
    `;
  }

  function searchWithOpenFilters() {
    setMobileFiltersOpen(true);
    search();
  }

  // Split event binding by concern so init stays readable.
  function bindFilterEvents(years) {
    yearPresetsBox?.addEventListener("click", event => {
      const button = event.target.closest("[data-year-preset]");
      if (!button) return;
      const preset = button.dataset.yearPreset;
      if (preset === "all") {
        setSelectedYears(years);
      } else if (preset === "recent") {
        setSelectedYears(years.slice(0, 2));
      }
      searchWithOpenFilters();
    });

    yearsBox.addEventListener("change", searchWithOpenFilters);
    typeBox.addEventListener("change", searchWithOpenFilters);
    orgBox.addEventListener("change", searchWithOpenFilters);

    sortSel.addEventListener("change", () => {
      setMobileFiltersOpen(true);
      syncSortChips();
      search();
    });

    sortOptions?.addEventListener("click", event => {
      const button = event.target.closest("[data-sort-value]");
      if (!button) return;
      sortSel.value = button.dataset.sortValue || "desc";
      setMobileFiltersOpen(true);
      syncSortChips();
      search();
    });
  }

  function bindUiEvents() {
    q.addEventListener("input", search);
    q.addEventListener("search", search);

    startBox.addEventListener("click", event => {
      const button = event.target.closest("[data-query]");
      if (!button) return;
      q.value = button.dataset.query || "";
      search();
    });

    refineToggle?.addEventListener("click", () => {
      setMobileFiltersOpen(!searchPanel.classList.contains("is-open"));
    });

    resultsActions?.addEventListener("click", event => {
      const button = event.target.closest("[data-toggle-start]");
      if (!button) return;
      const wasVisible = LANDING_VISIBLE;
      LANDING_MANUALLY_OPEN = !LANDING_VISIBLE;
      setLandingVisibility(LANDING_MANUALLY_OPEN);
      if (!wasVisible && window.innerWidth > 700) {
        scrollSearchIntoView();
      }
      setResultsActions({ showLandingToggle: HAS_ACTIVE_SEARCH });
    });

    backToTopButton?.addEventListener("click", scrollSearchIntoView);
    window.addEventListener("scroll", updateBackToTopVisibility, { passive: true });
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
    if (redirectFromHash()) return;

    await loadMeta();
    const years = sortedYearsFromMeta();
    renderYearFilters(years);
    renderYearPresets();

    loadFromUrl();
    syncSortChips();
    await loadLandingData();
    renderStartState();
    bindFilterEvents(years);
    bindUiEvents();
    setMobileFiltersOpen(!filtersAreDefault());
    updateBackToTopVisibility();

    search();
  }

  init();
})();
