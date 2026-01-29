---
layout: default
title: Usnesení rady a zastupitelstva města – vyhledávání
permalink: /usneseni/
---

# Vyhledávání v usneseních

<p class=subtitle>
Vyhledávání v usneseních vydaných orgány města Litovel v aktuálním volebním období.
</p>

<div class="usn-app">
  <input id="usn-q" type="search" placeholder="Hledat v usneseních">

  <div class="usn-controls">
    <div id="usn-years" class="usn-years"></div>

    <div id="usn-org">
      <label>
        <input type="checkbox" value="Rada města Litovel" checked>
        Rada města
      </label>
      <label>
        <input type="checkbox" value="Zastupitelstvo města Litovel" checked>
        Zastupitelstvo
      </label>
    </div>

    <select id="usn-sort">
      <option value="desc">Nejnovější</option>
      <option value="asc">Nejstarší</option>
    </select>
  </div>

  <div id="usn-info" class="usn-info"></div>
  <ul id="usn-results" class="usn-results"></ul>
</div>

<script src="/usneseni/app.js"></script>
