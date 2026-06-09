(() => {
  const RECORDS_URL = "/assets/uzemni-plan/pripominky/records.json";
  const META_URL = "/assets/uzemni-plan/pripominky/meta.json";
  const PAGE_SIZE = 40;
  const DEBOUNCE_MS = 140;

  const RESULT_LABELS = {
    vyhoveno: "Vyhověno",
    castecne_vyhoveno: "Částečně vyhověno",
    nevyhoveno: "Nevyhověno",
    neprihlizi_se: "Nepřihlíží se",
    mixed: "Více výsledků",
    unknown: "Výsledek nerozpoznán",
  };

  const SECTION_LABELS = {
    "N.1.1": "N.1.1 - včasné připomínky",
    "N.1.2": "N.1.2 - po termínu",
    "N.1.3": "N.1.3 - oprávnění investoři",
  };

  const state = {
    records: [],
    meta: null,
    query: "",
    result: "",
    section: "",
    visible: PAGE_SIZE,
    timer: null,
  };

  const nodes = {
    search: document.getElementById("search"),
    resultFilter: document.getElementById("result-filter"),
    sectionFilter: document.getElementById("section-filter"),
    summary: document.getElementById("summary"),
    results: document.getElementById("results"),
  };

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(text, terms) {
    let output = escapeHtml(text);
    for (const term of terms) {
      if (!term) continue;
      output = output.replace(new RegExp(`(${escapeRegExp(escapeHtml(term))})`, "gi"), "<mark>$1</mark>");
    }
    return output;
  }

  function snippet(text, limit = 420) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (clean.length <= limit) return clean;
    return `${clean.slice(0, limit).trim()}…`;
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Nepodařilo se načíst ${url}`);
    return response.json();
  }

  async function boot() {
    const [meta, records] = await Promise.all([getJson(META_URL), getJson(RECORDS_URL)]);
    state.meta = meta;
    state.records = records;
    fillFilters(records);
    syncFromUrl();
    render();
    bindEvents();
  }

  function fillFilters(records) {
    const results = [...new Set(records.map(record => record.result))].sort();
    for (const result of results) {
      const option = document.createElement("option");
      option.value = result;
      option.textContent = RESULT_LABELS[result] || result;
      nodes.resultFilter.appendChild(option);
    }

    const sections = [...new Set(records.map(record => record.section))].sort();
    for (const section of sections) {
      const option = document.createElement("option");
      option.value = section;
      option.textContent = SECTION_LABELS[section] || section;
      nodes.sectionFilter.appendChild(option);
    }
  }

  function syncFromUrl() {
    const params = new URLSearchParams(location.search);
    state.query = params.get("q") || "";
    state.result = params.get("vysledek") || "";
    state.section = params.get("sekce") || "";
    nodes.search.value = state.query;
    nodes.resultFilter.value = state.result;
    nodes.sectionFilter.value = state.section;
  }

  function bindEvents() {
    nodes.search.addEventListener("input", () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.query = nodes.search.value.trim();
        state.visible = PAGE_SIZE;
        updateUrl();
        render();
      }, DEBOUNCE_MS);
    });

    nodes.resultFilter.addEventListener("change", () => {
      state.result = nodes.resultFilter.value;
      state.visible = PAGE_SIZE;
      updateUrl();
      render();
    });

    nodes.sectionFilter.addEventListener("change", () => {
      state.section = nodes.sectionFilter.value;
      state.visible = PAGE_SIZE;
      updateUrl();
      render();
    });

    nodes.results.addEventListener("click", async event => {
      const button = event.target.closest("[data-copy-link]");
      if (!button) return;
      const url = `${location.origin}${location.pathname}#${button.dataset.copyLink}`;
      await navigator.clipboard.writeText(url);
      button.textContent = "Odkaz zkopírován";
      setTimeout(() => { button.textContent = "Kopírovat odkaz"; }, 1400);
    });
  }

  function updateUrl() {
    const url = new URL(location.href);
    if (state.query) url.searchParams.set("q", state.query);
    else url.searchParams.delete("q");
    if (state.result) url.searchParams.set("vysledek", state.result);
    else url.searchParams.delete("vysledek");
    if (state.section) url.searchParams.set("sekce", state.section);
    else url.searchParams.delete("sekce");
    url.hash = "";
    history.replaceState(null, "", url);
  }

  function filteredRecords() {
    const terms = normalize(state.query).split(" ").filter(Boolean);
    let records = state.records;

    if (location.hash && !state.query && !state.result && !state.section) {
      const id = decodeURIComponent(location.hash.slice(1));
      records = records.filter(record => record.id === id);
    }

    if (terms.length) {
      records = records.filter(record => terms.every(term => record.search_text.includes(term)));
    }
    if (state.result) {
      records = records.filter(record => record.result === state.result);
    }
    if (state.section) {
      records = records.filter(record => record.section === state.section);
    }
    return records;
  }

  function render() {
    const records = filteredRecords();
    const terms = state.query.split(/\s+/).filter(Boolean);
    const visible = records.slice(0, state.visible);

    if (!state.query && !state.result && !state.section && !location.hash) {
      nodes.summary.textContent = `Index obsahuje ${state.records.length} záznamů z PDF stran ${state.meta.indexed_pdf_pages[0]}-${state.meta.indexed_pdf_pages[1]}. Zadejte hledaný výraz nebo použijte filtr.`;
      nodes.results.innerHTML = "";
      return;
    }

    nodes.summary.textContent = records.length
      ? `Nalezeno ${records.length} záznamů.`
      : "Nic nenalezeno. Zkuste kratší nebo obecnější výraz.";

    if (!records.length) {
      nodes.results.innerHTML = `<div class="item-card empty">Nic nenalezeno.</div>`;
      return;
    }

    nodes.results.innerHTML = visible.map(record => renderRecord(record, terms)).join("");
    if (records.length > state.visible) {
      const button = document.createElement("button");
      button.className = "copy-link";
      button.type = "button";
      button.textContent = `Načíst další výsledky (${records.length - state.visible})`;
      button.addEventListener("click", () => {
        state.visible += PAGE_SIZE;
        render();
      });
      nodes.results.appendChild(button);
    }
  }

  function renderRecord(record, terms) {
    const pageLabel = record.page_start === record.page_end
      ? `PDF strana ${record.page_start}`
      : `PDF strany ${record.page_start}-${record.page_end}`;
    const resultLabel = RESULT_LABELS[record.result] || record.result;
    const confidenceWarning = record.confidence === "high"
      ? ""
      : `<span class="pill warn">Automaticky rozpoznaný blok - ověřte v původním PDF.</span>`;

    return `
      <article class="item-card record" id="${escapeHtml(record.id)}">
        <header class="record-head">
          <span class="record-id">${escapeHtml(record.display_id)}</span>
          <span class="pill">${escapeHtml(resultLabel)}</span>
          ${confidenceWarning}
        </header>
        <div class="record-section">${escapeHtml(SECTION_LABELS[record.section] || record.section)} · ${escapeHtml(record.section_title)}</div>
        <div class="record-meta">
          ${escapeHtml(record.submitter || "typ podatele neuveden")} · ${pageLabel}
        </div>
        <div class="record-body">
          ${renderField("Obsah připomínky", record.request_text, terms)}
          ${renderField("Vyhodnocení", record.evaluation_text, terms)}
          ${renderField("Odůvodnění", record.reasoning_text, terms)}
        </div>
        <div class="actions">
          <a href="${escapeHtml(record.pdf_url)}" rel="noopener">Otevřít v PDF</a>
          <a href="#${escapeHtml(record.id)}">Permalink</a>
          <button class="copy-link" type="button" data-copy-link="${escapeHtml(record.id)}">Kopírovat odkaz</button>
        </div>
      </article>
    `;
  }

  function renderField(label, value, terms) {
    if (!value) return "";
    return `
      <section class="field">
        <h3>${escapeHtml(label)}</h3>
        <p>${highlight(snippet(value), terms)}</p>
      </section>
    `;
  }

  boot().catch(error => {
    nodes.summary.textContent = `Vyhledávání se nepodařilo načíst: ${error.message}`;
  });
})();
