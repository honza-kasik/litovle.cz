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

  const q = document.getElementById("usn-q");
  const res = document.getElementById("usn-results");
  const info = document.getElementById("usn-info");
  const yearsBox = document.getElementById("usn-years");
  const sortSel = document.getElementById("usn-sort");

  // ============================================================
  // NORMALIZACE (JEDINÝ ZDROJ PRAVDY)
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

  function idFromHash() {
    if (!location.hash) return null;
    return location.hash.substring(1).replace(/-/g, "/");
  }

  function firstSentence(u) {
    if (u.subject) return u.subject;
    if (u.items && u.items.length) return u.items[0].text;
    return "";
  }

  function hasDetail(u) {
    if ((u.items && u.items.length) || u.tail) return true;
    if (u.subject && u.subject.length > SNIPPET_LEN) return true;
    return false;
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

  // ============================================================
  // SUMMARY / DETAIL
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

  function renderDetail(u) {
    let html = "";

    if (u.subject && u.items && u.items.length) {
      html += `<p class="usn-p">${u.subject}</p>`;
    }

    if (u.items && u.items.length) {
      for (const it of u.items) {
        html += `
          <p class="usn-p">
            <strong>${it.label})</strong>
            ${it.text}
          </p>
        `;
      }
    }

    if (
      (!u.items || !u.items.length) &&
      u.subject &&
      u.subject.length > SNIPPET_LEN
    ) {
      html += `<p class="usn-p">${u.subject}</p>`;
    }

    if (u.tail) {
      html += `<p class="usn-p">${u.tail}</p>`;
    }

    return html;
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

    if (!results.length && parsed.longWords.length > 1) {
      results = candidates.filter(u =>
        matchesAllTerms(u, parsed.longWords)
      );
    }

    results = sortResults(results);

    if (seq !== SEARCH_SEQ) return;
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

    for (const u of pageItems) {
      const anchor = anchorFromId(u.id);
      const detail = hasDetail(u);

      const li = document.createElement("li");
      li.className = "usn-result";
      li.id = anchor;

      li.innerHTML = `
        <div class="usn-head ${detail ? "" : "usn-noclick"}">
          <a href="#${anchor}" class="usn-permalink">#</a>
          <strong>${u.id}</strong>
          <span class="usn-date">${u.datum || ""}</span>
        </div>

        <div class="usn-summary">${summaryLabel(u)}</div>

        <div class="usn-snippet">
          ${(firstSentence(u) || "").slice(0, SNIPPET_LEN)}
        </div>

        ${detail ? `<div class="usn-detail">${renderDetail(u)}</div>` : ""}
      `;

      li.querySelector(".usn-head").onclick = () => {
        if (detail) li.classList.toggle("usn-open");
        history.replaceState(null, "", `#${anchor}`);
      };

      if (location.hash === `#${anchor}` && detail) {
        li.classList.add("usn-open");
      }

      res.appendChild(li);
    }

    renderPager(list.length);
  }

  // ============================================================
  // DEEP LINK
  // ============================================================

  async function showFromHash() {
    const id = idFromHash();
    if (!id) return;

    const year = id.split("/").pop();

    [...yearsBox.querySelectorAll("input")].forEach(i => {
      i.checked = i.value === year;
    });

    await loadYear(year);
    const u = DATA_MAP[year][id];
    if (!u) return;

    renderResults([u]);

    if (hasDetail(u)) {
      setTimeout(() => {
        const el = document.getElementById(anchorFromId(id));
        if (el) el.classList.add("usn-open");
      }, 0);
    }
  }

  // ============================================================
  // INIT
  // ============================================================

  async function init() {
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

    q.addEventListener("input", search);
    yearsBox.addEventListener("change", search);
    sortSel.addEventListener("change", search);

    if (location.hash) await showFromHash();
    window.addEventListener("hashchange", showFromHash);

    info.textContent = "Zadejte hledaný výraz";
  }

  init();
})();
