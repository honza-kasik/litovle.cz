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
  let IS_LOADING = false;

  const q = document.getElementById("usn-q");
  const res = document.getElementById("usn-results");
  const info = document.getElementById("usn-info");
  const yearsBox = document.getElementById("usn-years");
  const sortSel = document.getElementById("usn-sort");
  const typeBox = document.getElementById("usn-type");
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

  function cleanRoSnippet(text) {
    return (text || "").replace(/\s*\(RZ\s+\d+\/\d{4}\/(?:RM|ZM)\)\s*$/i, "").trim();
  }

  function setLoading(loading, text = "Načítám výsledky") {
    IS_LOADING = loading;
    info.classList.toggle("usn-info-loading", loading);
    info.textContent = loading ? text : info.textContent;
    res.setAttribute("aria-busy", loading ? "true" : "false");
  }

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

  function updateUrl() {
    const params = new URLSearchParams();

    if (q.value) params.set("q", q.value);

    for (const y of selectedYears()) params.append("y", y);
    for (const t of selectedTypes()) params.append("type", t);
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

  function selectedYears() {
    return [...yearsBox.querySelectorAll("input:checked")].map(i => i.value);
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

  async function search() {
    PAGE = 1;
    const seq = ++SEARCH_SEQ;

    const parsed = parseQuery(q.value);
    LAST_PARSED = parsed;

    if (!parsed || !parsed.anchor) {
      setLoading(false);
      res.innerHTML = "";
      info.textContent = "Zadejte hledaný výraz";
      return;
    }

    setLoading(true);

    const years = selectedYears();
    const candidates = await collectCandidates(parsed.anchor, years);
    const types = selectedTypes();

    let results = candidates.filter(u =>
      matchesPhrase(u, parsed.raw)
    );

    results = results.filter(u =>
      (u.id.startsWith("RO/") && types.includes("ro"))
      || (!u.id.startsWith("RO/") && types.includes("usneseni"))
    );

    const organs = selectedOrgans();
    results = results.filter(u => organs.includes(normalizedOrgan(u)));

    if (!results.length && parsed.longWords.length > 1) {
      results = candidates.filter(u =>
        matchesAllTerms(u, parsed.longWords)
      );
      results = results.filter(u =>
        (u.id.startsWith("RO/") && types.includes("ro"))
        || (!u.id.startsWith("RO/") && types.includes("usneseni"))
      );
      results = results.filter(u => organs.includes(normalizedOrgan(u)));
    }

    results = sortResults(results);

    if (seq !== SEARCH_SEQ) return;
    updateUrl();
    renderResults(results);
    setLoading(false);
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
      const roMatch = u.id.startsWith("RO/")
        ? findRoMatchContext(u, parsed)
        : null;
      const href = `${staticUrl}?back=${encodeURIComponent(location.pathname + location.search)}`;

      const snippetRaw = ((roMatch && roMatch.snippet) || firstSentence(u) || "").slice(0, SNIPPET_LEN);
      const snippet = parsed
        ? highlight(snippetRaw, parsed.longWords)
        : snippetRaw;

      const hasMore = (((roMatch && roMatch.snippet) || firstSentence(u) || "").length > SNIPPET_LEN);
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

          ${!isRo && hasMore ? `<div class="usn-more">…</div>` : ""}
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

    setLoading(true, "Načítám vyhledávání");

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

    const years = [...new Set([...Object.keys(META), ...Object.keys(RO_META)])]
      .sort()
      .reverse();

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

    loadFromUrl();

    q.addEventListener("input", search);
    yearsBox.addEventListener("change", search);
    typeBox.addEventListener("change", search);
    orgBox.addEventListener("change", search);
    sortSel.addEventListener("change", search);

    search();
  }

  init();
})();
