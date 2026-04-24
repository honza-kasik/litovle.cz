---
layout: default
title: Usnesení rady a zastupitelstva města – vyhledávání
permalink: /usneseni/
---

# Vyhledávání v usneseních

<p class=subtitle>
Vyhledávání v usneseních vydaných orgány města Litovel v aktuálním volebním období.
</p>

<style>
.usn-app {
  display: grid;
  gap: 1.25rem;
}

.usn-start {
  display: grid;
  gap: 1rem;
}

.usn-start-hero {
  background: linear-gradient(135deg, #f7f2e8 0%, #eef5ef 100%);
  border: 1px solid rgba(74, 93, 75, 0.18);
  border-radius: 22px;
  padding: 1.5rem;
  box-shadow: 0 16px 40px rgba(53, 61, 54, 0.08);
}

.usn-start-kicker {
  display: inline-block;
  margin-bottom: .5rem;
  padding: .3rem .6rem;
  border-radius: 999px;
  background: rgba(67, 90, 71, 0.10);
  color: #36513b;
  font-size: .85rem;
  font-weight: 600;
  letter-spacing: .01em;
}

.usn-start-hero h2,
.usn-start-section h3 {
  margin: 0 0 .5rem;
}

.usn-start-hero p,
.usn-start-section p {
  margin: 0;
}

.usn-start-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.usn-start-section {
  background: #fff;
  border: 1px solid rgba(74, 93, 75, 0.12);
  border-radius: 18px;
  padding: 1.1rem 1rem;
}

.usn-chip-list,
.usn-start-links {
  display: flex;
  flex-wrap: wrap;
  gap: .6rem;
  margin-top: .9rem;
}

.usn-chip {
  border: 0;
  border-radius: 999px;
  padding: .55rem .85rem;
  background: #2f5a41;
  color: #fff;
  font: inherit;
  cursor: pointer;
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
  box-shadow: 0 8px 18px rgba(47, 90, 65, 0.18);
}

.usn-chip:hover,
.usn-chip:focus-visible {
  transform: translateY(-1px);
  background: #254b35;
}

.usn-chip-secondary {
  background: #eef3ef;
  color: #24412e;
  box-shadow: none;
}

.usn-chip-secondary:hover,
.usn-chip-secondary:focus-visible {
  background: #dde9df;
}

.usn-start-links a {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  padding: .55rem .8rem;
  border-radius: 999px;
  background: #f5f2ea;
  color: #574c31;
  text-decoration: none;
}

.usn-start-links a:hover,
.usn-start-links a:focus-visible {
  background: #ece5d7;
}

.usn-start-recent {
  display: grid;
  gap: .8rem;
}

.usn-start-recent .usn-card {
  display: block;
  text-decoration: none;
}

@media (max-width: 700px) {
  .usn-start-hero {
    padding: 1.1rem;
  }
}
</style>

<div class="usn-app">
  <input id="usn-q" type="search" placeholder="Hledat v usneseních">

  <div class="usn-controls">
    <div id="usn-years" class="usn-years"></div>

    <div class="usn-filter-group">
      <div class="usn-filter-label">Typ dokumentu</div>
      <div id="usn-type" class="usn-filter-options">
        <label>
          <input type="checkbox" value="usneseni" checked>
          Usnesení
        </label>
        <label>
          <input type="checkbox" value="ro" checked>
          Rozpočtová opatření
        </label>
      </div>
    </div>

    <div class="usn-filter-group">
      <div class="usn-filter-label">Schvalující orgán</div>
      <div id="usn-org" class="usn-filter-options">
        <label>
          <input type="checkbox" value="Rada města Litovel" checked>
          Rada města
        </label>
        <label>
          <input type="checkbox" value="Zastupitelstvo města Litovel" checked>
          Zastupitelstvo
        </label>
      </div>
    </div>

    <div class="usn-filter-group">
      <label class="usn-filter-label" for="usn-sort">Řazení</label>
      <select id="usn-sort">
        <option value="desc">Nejnovější</option>
        <option value="asc">Nejstarší</option>
      </select>
    </div>
  </div>

  <div id="usn-start" class="usn-start"></div>
  <div id="usn-info" class="usn-info"></div>
  <ul id="usn-results" class="usn-results"></ul>

  <div class="archiv-label">Archiv podle let</div>
  <ul class="archiv-years">
  {% assign years = site.pages
      | where_exp: "p", "p.url contains '/usneseni/'"
      | where_exp: "p", "p.url != '/usneseni/'"
      | map: "url"
  %}

  {% assign year_list = "" | split: "" %}

  {% for url in years %}
    {% assign parts = url | split: "/" %}
    {% assign y = parts[2] %}
    {% unless year_list contains y %}
      {% assign year_list = year_list | push: y %}
    {% endunless %}
  {% endfor %}

  {% assign sorted_years = year_list | sort | reverse %}

  {% for year in sorted_years %}
    <li><a href="/usneseni/{{ year }}/">{{ year }}</a></li>
  {% endfor %}
  </ul>
</div>

<script src="/usneseni/app.js"></script>
