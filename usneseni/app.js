(() => {
  // ============================================================
  // KONSTANTY & STAV
  // ============================================================

  const PAGE_SIZE = 20;
  const SNIPPET_LEN = 180;

  let META = {};
  let INDEX = {};
  let DATA = {};
  let LOADED = {};
  let PAGE = 1;
  // guard pro vracení výsledků v sekvenci (přechozí výsledek nepřepíše aktuální vyhledávání)
  let SEARCH_SEQ = 0;
  let currentResults = [];

  const q = document.getElementById("usn-q");
  const res = document.getElementById("usn-results");
  const info = document.getElementById("usn-info");
  const yearsBox = document.getElementById("usn-years");
  const sortSel = document.getElementById("usn-sort");

  // ============================================================
  // UTIL
  // ============================================================

  function norm(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

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

  /**
   * Má detail smysl?
   * - má položky nebo tail
   * - nebo je subject delší než snippet
   */
  function hasDetail(u) {
    if ((u.items && u.items.length) || u.tail) return true;
    if (u.subject && u.subject.length > SNIPPET_LEN) return true;
    return false;
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

    // subject jen pokud jsou i položky (aby se neduplikoval snippet)
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

    // dlouhý subject bez položek
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

    // ← předchozí
    nav.appendChild(
      pageLink("‹ předchozí", PAGE - 1, PAGE === 1)
    );

    const window = 2;
    let start = Math.max(1, PAGE - window);
    let end = Math.min(pages, PAGE + window);

    if (start > 1) {
      nav.appendChild(pageLink("1", 1));
      if (start > 2) {
        nav.appendChild(pageLink("…", null, true));
      }
    }

    for (let i = start; i <= end; i++) {
      nav.appendChild(
        pageLink(i, i, false, i === PAGE)
      );
    }

    if (end < pages) {
      if (end < pages - 1) {
        nav.appendChild(pageLink("…", null, true));
      }
      nav.appendChild(pageLink(pages, pages));
    }

    // další →
    nav.appendChild(
      pageLink("další ›", PAGE + 1, PAGE === pages)
    );

    res.appendChild(nav);
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

      const li = document.createElement("li");
      li.className = "usn-result";
      li.id = anchor;

      li.innerHTML = `
        <div class="usn-head ${hasDetail(u) ? "" : "usn-noclick"}">
          <a href="#${anchor}" class="usn-permalink">#</a>
          <strong>${u.id}</strong>
          <span class="usn-date">${u.datum || ""}</span>
        </div>

        <div class="usn-summary">${summaryLabel(u)}</div>

        <div class="usn-snippet">
          ${firstSentence(u).slice(0, SNIPPET_LEN)}
        </div>

        ${hasDetail(u)
          ? `<div class="usn-detail">${renderDetail(u)}</div>`
          : ""
        }
      `;

      li.querySelector(".usn-head").onclick = () => {
        if (hasDetail(u)) {
          li.classList.toggle("usn-open");
        }
        history.replaceState(null, "", `#${anchor}`);
      };

      if (location.hash === `#${anchor}` && hasDetail(u)) {
        li.classList.add("usn-open");
      }

      res.appendChild(li);
    }

    renderPager(list.length);
  }

  // ============================================================
  // SEARCH
  // ============================================================

  function parseQuery(input) {
    const raw = normalizeText(input);
    if (!raw) return null;

    const words = raw.split(/\s+/);
    const longWords = words.filter(w => w.length >= 3);

    return {
      raw,        // "tv nova"
      words,      // ["tv", "nova"]
      longWords   // ["nova"]
    };
  }

  // vyber část dotazu, která je nejlépe idnexovaná a kolem které se hledají další slova. Prostě vezmeme nejdelší slovo.
  function chooseAnchor(parsed) {
    if (!parsed || !parsed.longWords.length) return null;

    return parsed.longWords
      .slice()
      .sort((a, b) => b.length - a.length)[0];
  }

  async function collectCandidates(anchor, years) {
    const candidates = [];

    for (const y of years) {
      await loadYear(y);

      const hit = INDEX[y][anchor];
      if (!hit) continue;

      for (const id of hit) {
        const u = DATA[y].find(x => x.id === id);
        if (u) candidates.push(u);
      }
    }

    return candidates;
  }

  function matchesPhrase(u, phrase) {
    return extractFullText(u).includes(phrase);
  }


  function extractFullText(u) {
    return normalizeText(
      [
        u.subject || "",
        ...(u.items || []).map(i => i.text),
        u.tail || ""
      ].join(" ")
    );
  }

  async function search() {
    PAGE = 1;
    const seq = ++SEARCH_SEQ;

    const parsed = parseQuery(q.value);
    if (!parsed) {
      res.innerHTML = "";
      info.textContent = "";
      return;
    }

    const anchor = chooseAnchor(parsed);
    if (!anchor) {
      res.innerHTML = "";
      info.textContent = "Zadejte prosím delší výraz.";
      return;
    }

    const years = selectedYears();
    const candidates = await collectCandidates(anchor, years);

    let results = candidates.filter(u =>
      matchesPhrase(u, parsed.raw)
    );

    results = sortResults(results);

    if (seq !== SEARCH_SEQ) return;
    renderResults(results);
  }

  // ============================================================
  // DEEP LINK (HASH)
  // ============================================================

  async function showFromHash() {
    const id = idFromHash();
    if (!id) return;

    const parts = id.split("/");
    const year = parts[parts.length - 1];

    [...yearsBox.querySelectorAll("input")].forEach(i => {
      i.checked = (i.value === year);
    });

    await loadYear(year);

    const u = DATA[year].find(x => x.id === id);
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

    if (location.hash) {
      await showFromHash();
    }

    window.addEventListener("hashchange", showFromHash);

    info.textContent = "Zadejte hledaný výraz";
  }

  init();
})();
