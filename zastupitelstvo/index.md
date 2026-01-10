---
layout: default
title: Zastupitelstvo
---

# Shrnutí jednání zastupitelstva

<p class=subtitle>
K vytváření shrnutí je <a href="https://github.com/honza-kasik/meeting-summarizer">mimo jiné používána AI</a>. Shrnutí může být nepřesné.<br/>
Každé shrnutí obsahuje odkaz na přepis audiozáznamu ze kterého shrnutí vychází.
</p>

{% assign meetings = site.categories.zastupitelstvo %}

{% for post in meetings %}
<div class="item-card meeting-card">
    <h2 class="meeting-summary-header">🏛️ <a href="{{ post.url | relative_url }}">{{ post.meeting_number }}. zasedání zastupitelstva</a></h2>
    <p class="meeting-meta">📅 {{ post.meeting_date | date: "%-d. %-m. %Y" }}</p>
    <p>{{post.summary}} <a href="{{ post.url | relative_url }}">číst dále...</a></p>
</div>
{% endfor %}