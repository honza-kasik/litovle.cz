---
layout: default
title: Usnesení rady města – vyhledávání
permalink: /usneseni/
---

# Vyhledávání v usneseních

<p class=subtitle>
Jednoduché vyhledávání v usneseních vydaných orgány města Litovel.<br/>Prozatím jen rady města z aktuálního volebního období.
</p>

<div class="usn-app">
  <input id="usn-q" type="search" placeholder="Hledat v usneseních">

  <div class="usn-controls">
    <div id="usn-years" class="usn-years"></div>

    <select id="usn-sort">
      <option value="desc">Nejnovější</option>
      <option value="asc">Nejstarší</option>
    </select>
  </div>

  <div id="usn-info" class="usn-info"></div>
  <ul id="usn-results" class="usn-results"></ul>
</div>

<script src="/usneseni/app.js"></script>
