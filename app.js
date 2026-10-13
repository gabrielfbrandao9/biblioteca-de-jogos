"use strict";

const STEAM_CDN = "https://shared.akamai.steamstatic.com/store_item_assets/";
const PAGE_SIZE = 96;
const FACET_PREVIEW = 8;

const GENRES = {
  "Adventure": "Aventura",
  "Role-playing (RPG)": "RPG",
  "Shooter": "Tiro",
  "Strategy": "Estratégia",
  "Puzzle": "Quebra-cabeça",
  "Simulator": "Simulação",
  "Platform": "Plataforma",
  "Fighting": "Luta",
  "Turn-based strategy (TBS)": "Estratégia por turnos",
  "Hack and slash/Beat 'em up": "Hack and slash",
  "Tactical": "Tático",
  "Racing": "Corrida",
  "Sport": "Esporte",
  "Card & Board Game": "Cartas e tabuleiro",
  "Real Time Strategy (RTS)": "Estratégia em tempo real",
  "Music": "Música",
  "Quiz/Trivia": "Quiz",
};
const FEATURES = {
  "Single Player": "Um jogador",
  "Co-Operative": "Cooperativo",
  "Split Screen": "Tela dividida",
  "Massively Multiplayer Online (MMO)": "MMO",
};

// Facetas da barra lateral: chave na URL, rótulo, como extrair os valores do jogo
const FACETS = [
  { key: "loja", label: "Loja", values: (g) => [g.source || "Outros"] },
  { key: "genero", label: "Gênero", values: (g) => g.genres || [], name: (v) => GENRES[v] || v },
  { key: "decada", label: "Lançamento", values: (g) => (g.releaseDate ? [decade(g.releaseDate)] : ["Sem data"]), order: "value-desc" },
  { key: "func", label: "Modo de jogo", values: (g) => g.features || [], name: (v) => FEATURES[v] || v },
  { key: "plat", label: "Plataforma", values: (g) => g.platforms || [] },
  { key: "nota", label: "Nota da crítica", values: (g) => [scoreBand(g.criticScore)], order: "fixed",
    fixed: ["90+", "80–89", "70–79", "60–69", "Abaixo de 60", "Sem nota"] },
];

const SORTS = {
  name: { get: (g) => g.name, dir: 1 },
  releaseDate: { get: (g) => g.releaseDate, dir: -1 },
  criticScore: { get: (g) => g.criticScore, dir: -1 },
  communityScore: { get: (g) => g.communityScore, dir: -1 },
  added: { get: (g) => g.added, dir: -1 },
  playtime: { get: (g) => g.playtime || null, dir: -1 },
  lastActivity: { get: (g) => g.lastActivity, dir: -1 },
};

const $ = (sel) => document.querySelector(sel);
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const nf = new Intl.NumberFormat("pt-BR");

let games = [];
let byId = new Map();
let filtered = [];
let rendered = 0;
const expanded = new Set();
const state = { q: "", status: "", sort: "name", dir: 1, sel: {}, jogo: "" };

// ---------- utilitários ----------
function decade(date) { return `${date.slice(0, 3)}0s`; }
function scoreBand(s) {
  if (s == null) return "Sem nota";
  if (s >= 90) return "90+";
  if (s >= 80) return "80–89";
  if (s >= 70) return "70–79";
  if (s >= 60) return "60–69";
  return "Abaixo de 60";
}
function norm(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
function hue(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }
function year(g) { return g.releaseDate ? g.releaseDate.slice(0, 4) : ""; }
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function fmtPlaytime(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${nf.format(h)} h${m ? ` ${m} min` : ""}` : `${m || 1} min`;
}
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// ---------- capas ----------
function placeholder(g) {
  return `<div class="ph" style="--h:${hue(g.name)}"><span class="ph-src">${esc(g.source || g.library || "")}</span><span class="ph-title">${esc(g.name)}</span></div>`;
}
function coverHTML(g, big = false) {
  const art = g.art || {};
  const src = big ? art.cover2x || art.cover : art.cover;
  let inner;
  if (src) inner = `<img src="${STEAM_CDN + src}" alt="" loading="${big ? "eager" : "lazy"}" decoding="async" data-fallback="${art.header ? STEAM_CDN + art.header : ""}">`;
  else if (art.header) inner = `<img src="${STEAM_CDN + art.header}" alt="" loading="lazy" decoding="async" data-wide>`;
  else inner = placeholder(g);
  const wide = !src && art.header ? " wide" : "";
  const style = wide ? ` style="--img:url('${STEAM_CDN + art.header}')"` : "";
  let badges = "";
  if (!big && g.criticScore != null) {
    const cls = g.criticScore >= 80 ? "hi" : g.criticScore >= 65 ? "mid" : "lo";
    badges += `<span class="badge score ${cls}" title="Nota da crítica">${g.criticScore}</span>`;
  }
  if (!big && g.status === "Jogado") badges += `<span class="badge played" title="Jogado">✓</span>`;
  return `<div class="cover${wide}"${style} data-id="${g.id}">${inner}${badges}</div>`;
}
// Imagem quebrada: tenta o banner horizontal, senão mostra o cartão gerado
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName !== "IMG" || !img.closest(".cover")) return;
  const cover = img.closest(".cover");
  const g = byId.get(cover.dataset.id);
  if (img.dataset.fallback) {
    cover.classList.add("wide");
    cover.style.setProperty("--img", `url('${img.dataset.fallback}')`);
    img.src = img.dataset.fallback;
    img.dataset.fallback = "";
  } else if (g) {
    cover.classList.remove("wide");
    img.replaceWith(el(placeholder(g)));
  }
}, true);

// ---------- estado na URL ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.q = p.get("q") || "";
  state.status = p.get("status") || "";
  state.sort = SORTS[p.get("ordem")] ? p.get("ordem") : "name";
  state.dir = p.has("dir") ? Number(p.get("dir")) || 1 : SORTS[state.sort].dir;
  state.jogo = p.get("jogo") || "";
  state.sel = {};
  for (const f of FACETS) {
    const v = p.get(f.key);
    if (v) state.sel[f.key] = new Set(v.split("|"));
  }
}
function writeHash(push = false) {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.status) p.set("status", state.status);
  for (const f of FACETS) if (state.sel[f.key]?.size) p.set(f.key, [...state.sel[f.key]].join("|"));
  if (state.sort !== "name") p.set("ordem", state.sort);
  if (state.dir !== SORTS[state.sort].dir) p.set("dir", state.dir);
  if (state.jogo) p.set("jogo", state.jogo);
  const hash = p.toString().replace(/\+/g, "%20");
  const url = hash ? `#${hash}` : location.pathname + location.search;
  history[push ? "pushState" : "replaceState"](null, "", url);
}

// ---------- filtragem ----------
function matches(g, skipFacet) {
  if (state.status && g.status !== state.status) return false;
  if (state.q && !g._text.includes(norm(state.q))) return false;
  for (const f of FACETS) {
    if (f.key === skipFacet) continue;
    const sel = state.sel[f.key];
    if (sel?.size && !f.values(g).some((v) => sel.has(v))) return false;
  }
  return true;
}
function compare(a, b) {
  const s = SORTS[state.sort];
  const va = s.get(a), vb = s.get(b);
  if (va == null && vb == null) return collator.compare(a.name, b.name);
  if (va == null) return 1;   // vazios sempre no fim
  if (vb == null) return -1;
  const r = typeof va === "number" ? va - vb : collator.compare(va, vb);
  return r * state.dir || collator.compare(a.name, b.name);
}

function update() {
  filtered = games.filter((g) => matches(g)).sort(compare);
  renderFacets();
  renderToolbar();
  renderGrid();
  writeHash();
}

// ---------- render ----------
function renderStats() {
  const played = games.filter((g) => g.status === "Jogado").length;
  const hours = Math.round(games.reduce((s, g) => s + (g.playtime || 0), 0) / 3600);
  const stores = new Set(games.map((g) => g.source).filter(Boolean)).size;
  $("#stats").innerHTML = [
    ["Jogos", nf.format(games.length)],
    ["Jogados", nf.format(played)],
    ["Horas jogadas", nf.format(hours)],
    ["Lojas", stores],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

function renderFacets() {
  const root = $("#facets");
  root.innerHTML = "";
  for (const f of FACETS) {
    const counts = new Map();
    for (const g of games) {
      if (!matches(g, f.key)) continue;
      for (const v of new Set(f.values(g))) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const sel = state.sel[f.key] || new Set();
    // inclui opções selecionadas mesmo com contagem zero, e todas as conhecidas
    for (const v of f.all) if (!counts.has(v)) counts.set(v, 0);
    let opts = [...counts.entries()];
    if (f.order === "fixed") opts.sort((a, b) => f.fixed.indexOf(a[0]) - f.fixed.indexOf(b[0]));
    else if (f.order === "value-desc") opts.sort((a, b) => collator.compare(b[0], a[0]));
    else opts.sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));

    const showAll = expanded.has(f.key) || opts.length <= FACET_PREVIEW + 2;
    const visible = showAll ? opts : opts.filter(([v], i) => i < FACET_PREVIEW || sel.has(v));
    const box = el(`<section class="facet"><h3>${f.label}</h3><ul></ul></section>`);
    const ul = box.querySelector("ul");
    for (const [v, n] of visible) {
      const li = document.createElement("li");
      li.append(el(`<button type="button" class="opt${n ? "" : " zero"}" aria-pressed="${sel.has(v)}" data-f="${f.key}" data-v="${esc(v)}">
        <span class="box"></span><span class="lbl">${esc(f.name ? f.name(v) : v)}</span><span class="n">${nf.format(n)}</span></button>`));
      ul.append(li);
    }
    if (opts.length > FACET_PREVIEW + 2) {
      box.append(el(`<button type="button" class="link more" data-more="${f.key}">${showAll ? "Mostrar menos" : `Mostrar todos (${opts.length})`}</button>`));
    }
    root.append(box);
  }
}

function facetName(key, v) {
  const f = FACETS.find((x) => x.key === key);
  return f.name ? f.name(v) : v;
}

function renderToolbar() {
  $("#count").innerHTML = `<b>${nf.format(filtered.length)}</b> de ${nf.format(games.length)} jogos`;
  for (const b of $("#status").children) b.setAttribute("aria-checked", b.dataset.v === state.status);
  $("#sort").value = state.sort;
  $("#dir").textContent = state.dir === 1 ? "↑" : "↓";
  $("#dir").title = state.dir === 1 ? "Ordem crescente" : "Ordem decrescente";
  if ($("#q").value !== state.q) $("#q").value = state.q;

  const active = $("#active");
  active.innerHTML = "";
  let n = 0;
  if (state.q) active.append(el(`<button class="pill" type="button" data-clear="q">“${esc(state.q)}”</button>`));
  for (const f of FACETS) {
    for (const v of state.sel[f.key] || []) {
      n++;
      active.append(el(`<button class="pill" type="button" data-f="${f.key}" data-v="${esc(v)}">${esc(facetName(f.key, v))}</button>`));
    }
  }
  $("#filter-count").textContent = n ? `(${n})` : "";
}

function cardHTML(g) {
  const sub = [g.source, year(g)].filter(Boolean).join(" · ");
  return `<button class="card" type="button" data-id="${g.id}">${coverHTML(g)}<span class="card-name">${esc(g.name)}</span><span class="card-sub">${esc(sub)}</span></button>`;
}
function renderGrid() {
  $("#grid").innerHTML = "";
  rendered = 0;
  renderMore();
  $("#empty").hidden = filtered.length > 0;
}
function renderMore() {
  if (rendered >= filtered.length) return;
  const slice = filtered.slice(rendered, rendered + PAGE_SIZE);
  $("#grid").insertAdjacentHTML("beforeend", slice.map(cardHTML).join(""));
  rendered += slice.length;
}

// ---------- detalhe ----------
const dialog = $("#detail");

function linkName(l) {
  if (l.name && !/^u?n?known$|^uknown$/i.test(l.name)) return l.name;
  try { return new URL(l.url).hostname.replace(/^www\./, ""); } catch { return "Link"; }
}
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta, form").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((n) => {
    for (const a of [...n.attributes]) {
      const val = a.value.trim().toLowerCase();
      if (a.name.startsWith("on") || a.name === "style" || ((a.name === "href" || a.name === "src") && val.startsWith("javascript:"))) {
        n.removeAttribute(a.name);
      }
    }
    if (n.tagName === "A") { n.target = "_blank"; n.rel = "noopener noreferrer"; }
    if (n.tagName === "IMG") n.loading = "lazy";
    if (n.tagName === "VIDEO") { n.removeAttribute("autoplay"); n.controls = true; n.muted = true; }
  });
  return doc.body.innerHTML;
}

function openGame(id, push = true) {
  const g = byId.get(id);
  if (!g) return;
  state.jogo = id;
  writeHash(push);

  const art = g.art || {};
  const heroImg = art.hero || art.header;
  const hero = $("#d-hero");
  hero.style.setProperty("--h", hue(g.name));
  hero.style.setProperty("--hero", heroImg ? `url('${STEAM_CDN + heroImg}')` : "");
  if (!heroImg) hero.style.removeProperty("--hero");

  $("#d-cover").innerHTML = coverHTML(g, true);
  $("#d-kicker").textContent = [g.source || g.library, (g.platforms || []).join(", ")].filter(Boolean).join(" · ");
  $("#d-title").textContent = g.name;

  const credit = (label, list) => list?.length
    ? `${label} ${list.map((v) => `<button type="button" data-search="${esc(v)}">${esc(v)}</button>`).join(", ")}`
    : "";
  $("#d-credits").innerHTML = [credit("Desenvolvido por", g.developers), credit("Publicado por", g.publishers)].filter(Boolean).join(" · ");

  const facts = [
    ["Status", g.status],
    ["Tempo de jogo", fmtPlaytime(g.playtime)],
    ["Última atividade", fmtDate(g.lastActivity)],
    ["Lançamento", fmtDate(g.releaseDate)],
    ["Nota da crítica", g.criticScore ?? "—"],
    ["Comunidade", g.communityScore ?? "—"],
    ["Biblioteca", g.library],
    ["Adicionado", fmtDate(g.added)],
  ];
  $("#d-facts").innerHTML = facts.map(([k, v]) => `<dl class="fact"><dt>${k}</dt><dd>${esc(v ?? "—")}</dd></dl>`).join("");

  $("#d-chips").innerHTML =
    (g.genres || []).map((v) => `<button type="button" class="chip" data-f="genero" data-v="${esc(v)}">${esc(GENRES[v] || v)}</button>`).join("") +
    (g.features || []).map((v) => `<button type="button" class="chip feat" data-f="func" data-v="${esc(v)}">${esc(FEATURES[v] || v)}</button>`).join("");

  const links = g.links || [];
  $("#d-links-wrap").hidden = !links.length;
  $("#d-links").innerHTML = links
    .filter((l) => /^https?:/i.test(l.url))
    .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(linkName(l))}</a>`).join("");

  const desc = $("#d-desc");
  if (g.hasDesc) {
    desc.className = "prose loading";
    desc.textContent = "Carregando…";
    fetch(`data/desc/${id}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (state.jogo === id) { desc.className = "prose"; desc.innerHTML = sanitize(d.html); } })
      .catch(() => { if (state.jogo === id) desc.textContent = "Não foi possível carregar a descrição."; });
  } else {
    desc.className = "prose loading";
    desc.textContent = "Sem descrição.";
  }

  const idx = filtered.findIndex((x) => x.id === id);
  $("#d-prev").disabled = idx <= 0;
  $("#d-next").disabled = idx < 0 || idx >= filtered.length - 1;

  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
function step(delta) {
  const idx = filtered.findIndex((x) => x.id === state.jogo);
  const next = filtered[idx + delta];
  if (next) openGame(next.id, false);
}
function closeGame() {
  if (dialog.open) dialog.close();
}
dialog.addEventListener("close", () => {
  if (state.jogo) { state.jogo = ""; writeHash(); }
});

// ---------- eventos ----------
function toggle(key, v) {
  const sel = (state.sel[key] ||= new Set());
  sel.has(v) ? sel.delete(v) : sel.add(v);
  update();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button, .card");
  if (!t) {
    if (e.target === dialog) closeGame(); // clique no fundo escuro
    return;
  }
  if (t.classList.contains("card")) return openGame(t.dataset.id);
  if (t.dataset.f) {
    const inDialog = dialog.contains(t);
    if (inDialog) { state.sel[t.dataset.f] = new Set([t.dataset.v]); closeGame(); update(); window.scrollTo(0, 0); }
    else toggle(t.dataset.f, t.dataset.v);
    return;
  }
  if (t.dataset.search) { state.q = t.dataset.search; closeGame(); update(); window.scrollTo(0, 0); return; }
  if (t.dataset.more) { expanded.has(t.dataset.more) ? expanded.delete(t.dataset.more) : expanded.add(t.dataset.more); renderFacets(); return; }
  if (t.dataset.clear === "q") { state.q = ""; update(); return; }
  if (t.parentElement?.id === "status") { state.status = t.dataset.v; update(); return; }
  switch (t.id) {
    case "clear": state.sel = {}; state.q = ""; state.status = ""; update(); break;
    case "dir": state.dir *= -1; update(); break;
    case "random": if (filtered.length) openGame(filtered[Math.floor(Math.random() * filtered.length)].id); break;
    case "d-close": closeGame(); break;
    case "d-prev": step(-1); break;
    case "d-next": step(1); break;
    case "open-filters": document.body.classList.add("filters-open"); break;
    case "close-filters": document.body.classList.remove("filters-open"); break;
  }
});
$("#scrim").addEventListener("click", () => document.body.classList.remove("filters-open"));

let typing;
$("#q").addEventListener("input", (e) => {
  clearTimeout(typing);
  typing = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 120);
});
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; state.dir = SORTS[state.sort].dir; update(); });

document.addEventListener("keydown", (e) => {
  if (dialog.open) {
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
    return;
  }
  if (e.key === "/" && document.activeElement !== $("#q")) { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape") document.body.classList.remove("filters-open");
});

window.addEventListener("popstate", () => {
  readHash();
  update();
  if (state.jogo) openGame(state.jogo, false);
  else if (dialog.open) dialog.close();
});

new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) renderMore();
}, { rootMargin: "1200px" }).observe($("#sentinel"));

// ---------- início ----------
fetch("data/games.json")
  .then((r) => r.json())
  .then((data) => {
    games = data.games;
    for (const g of games) {
      g._text = norm([g.name, ...(g.developers || []), ...(g.publishers || [])].join(" "));
      byId.set(g.id, g);
    }
    for (const f of FACETS) f.all = new Set(games.flatMap((g) => f.values(g)));
    renderStats();
    readHash();
    update();
    if (state.jogo) openGame(state.jogo, false);
    const when = new Date(data.generated);
    $("#foot").textContent = `Dados exportados do Playnite em ${when.toLocaleDateString("pt-BR")}. Capas: Steam.`;
  })
  .catch(() => {
    $("#grid").innerHTML = `<p class="empty">Não foi possível carregar data/games.json.</p>`;
  });
