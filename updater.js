"use strict";
// Botão "Atualizar biblioteca": lê a pasta do HTML Exporter no navegador, gera os
// mesmos dados que scripts/build_data.py e publica no GitHub pela API.

const UPD = {
  repo: "gabrielfbrandao9/biblioteca-de-jogos",
  branch: "main",
  tokenKey: "biblioteca-token",
};

// ---------- leitura da exportação (espelha scripts/build_data.py) ----------
const P = {
  file: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$/,
  title: /<title>([\s\S]*?)<\/title>/,
  row: /<TR>\s*<TD>([\s\S]*?)<\/TD>\s*<TD>([\s\S]*?)<\/TD>\s*<\/TR>/g,
  link: /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
  tag: /<[^>]+>/g,
  desc: /<div class="description">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/body>/,
  steam: /store\.steampowered\.com\/app\/(\d+)/,
  duration: /(\d+)\s*([dhms])/g,
  date: /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{1,2}):(\d{1,2}))?$/,
};
const FIELD_KEYS = {
  "Tempo de jogo": "playtime",
  "Última Atividade": "lastActivity",
  "Adicionado": "added",
  "Modificado": "modified",
  "Status de Conclusão": "status",
  "Biblioteca": "library",
  "Fonte": "source",
  "Plataforma": "platforms",
  "Data de Lançamento": "releaseDate",
  "Pontuação da Comunidade": "communityScore",
  "Avaliação da crítica": "criticScore",
  "Pontuação do Usuário": "userScore",
  "Gênero": "genres",
  "Desenvolvedor": "developers",
  "Editor": "publishers",
  "Funções": "features",
  "Links": "links",
  "Tag": "tags",
};
const LIST_KEYS = new Set(["platforms", "genres", "developers", "publishers", "features", "tags"]);
const SCORE_KEYS = new Set(["communityScore", "criticScore", "userScore"]);
const DATE_KEYS = new Set(["lastActivity", "added", "modified", "releaseDate"]);
const STATUS_PT = { "Not Played": "Não jogado", "Played": "Jogado", "Jogado": "Jogado" };
const SECONDS = { d: 86400, h: 3600, m: 60, s: 1 };
const COPY_FIELDS = ["id", "source", "library", "platforms", "status", "playtime", "lastActivity", "added"];
const UNION_FIELDS = ["platforms", "genres", "developers", "publishers", "features", "tags"];

const decoder = document.createElement("textarea");
function unescapeHTML(s) { decoder.innerHTML = s; return decoder.value; }
function plain(fragment) { return unescapeHTML(fragment.replace(P.tag, "")).trim(); }
function isEmpty(v) { return v == null || v === "" || (Array.isArray(v) && !v.length); }
function cpLength(s) { let n = 0; for (const _ of s) n++; return n; }

function parseDate(value) {
  const m = P.date.exec(value);
  if (!m) return null;
  const [, d, mo, y, hh, mm, ss] = m;
  const p2 = (n) => n.padStart(2, "0");
  const date = `${y}-${p2(mo)}-${p2(d)}`;
  return hh ? `${date}T${p2(hh)}:${p2(mm)}:${p2(ss)}` : date;
}

function parseGame(id, raw) {
  const game = { id, name: plain(P.title.exec(raw)?.[1] || id) };
  for (const [, label, cell] of raw.matchAll(P.row)) {
    const key = FIELD_KEYS[plain(label)];
    if (!key) continue;
    const links = [...cell.matchAll(P.link)];
    if (key === "links") game[key] = links.map(([, url, name]) => ({ name: plain(name), url: unescapeHTML(url) }));
    else if (LIST_KEYS.has(key)) game[key] = links.map(([, , n]) => plain(n)).filter(Boolean);
    else if (key === "playtime") game[key] = [...plain(cell).matchAll(P.duration)].reduce((s, [, n, u]) => s + Number(n) * SECONDS[u], 0);
    else if (SCORE_KEYS.has(key)) { const v = plain(cell); game[key] = /^\d+$/.test(v) ? Number(v) : null; }
    else if (DATE_KEYS.has(key)) game[key] = parseDate(plain(cell));
    else if (key === "status") { const v = plain(cell); game[key] = STATUS_PT[v] || v; }
    else game[key] = plain(cell) || null;
  }
  for (const l of game.links || []) {
    const m = P.steam.exec(l.url);
    if (m) { game.steamId = Number(m[1]); break; }
  }
  const desc = P.desc.exec(raw);
  for (const k of Object.keys(game)) if (isEmpty(game[k])) delete game[k];
  return { game, description: desc ? desc[1].trim() : "" };
}

function mergeKey(name) {
  return name.replace(/['’`´]/g, "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mergeDuplicates(list, descriptions) {
  const groups = new Map();
  for (const g of list) {
    const k = mergeKey(g.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  const descLen = (id) => descriptions.get(id)?.cp || 0;
  const rich = (g) => [("art" in g) ? 1 : 0, descLen(g.id), Object.keys(g).length];
  const cmp = (a, b) => { const x = rich(a), y = rich(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };

  const merged = [];
  for (const copies of groups.values()) {
    copies.sort(cmp);
    const best = copies[0];
    const g = {};
    for (const [k, v] of Object.entries(best)) if (!COPY_FIELDS.includes(k)) g[k] = v;
    g.id = best.id;
    g.stores = [...new Set(copies.map((c) => c.source || "Outros"))].sort();
    g.status = copies.some((c) => c.status === "Jogado") ? "Jogado" : best.status;
    g.playtime = copies.reduce((s, c) => s + (c.playtime || 0), 0);
    for (const [key, pick] of [["lastActivity", "max"], ["added", "min"], ["modified", "max"]]) {
      const values = copies.map((c) => c[key]).filter(Boolean).sort();
      if (values.length) g[key] = pick === "max" ? values[values.length - 1] : values[0];
    }
    for (const key of UNION_FIELDS) {
      const values = [...new Set(copies.flatMap((c) => c[key] || []))];
      if (values.length) g[key] = values;
    }
    for (const key of ["releaseDate", "criticScore", "communityScore", "userScore", "steamId", "art"]) {
      const c = copies.find((c) => c[key] != null);
      if (c) g[key] = c[key];
    }
    const links = new Map();
    for (const c of copies) for (const l of c.links || []) if (!links.has(l.url)) links.set(l.url, l);
    if (links.size) g.links = [...links.values()];
    let descId = copies[0].id;
    for (const c of copies) if (descLen(c.id) > descLen(descId)) descId = c.id;
    if (descriptions.get(descId)) { g.hasDesc = 1; g.descId = descId; } else delete g.hasDesc;
    if (copies.length > 1) {
      g.copies = [...copies]
        .sort((a, b) => {
          const x = `${a.source || ""}\0${a.id}`, y = `${b.source || ""}\0${b.id}`;
          return x < y ? -1 : 1;
        })
        .map((c) => Object.fromEntries(COPY_FIELDS.filter((k) => !isEmpty(c[k])).map((k) => [k, c[k]])));
    }
    merged.push(g);
  }
  return merged;
}

function timestamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function buildFromFolder(files, progress) {
  const pages = files.filter((f) => P.file.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
  if (!pages.length) throw new Error("Nenhuma página de jogo nessa pasta. Escolha a pasta gerada pelo HTML Exporter.");

  const cache = await fetch("scripts/steam_cache.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const list = [], descriptions = new Map();
  for (let i = 0; i < pages.length; i++) {
    const raw = (await pages[i].text()).replace(/\r\n?/g, "\n");
    const { game, description } = parseGame(pages[i].name.slice(0, -5), raw);
    const art = cache[String(game.steamId)];
    if (art && Object.keys(art).length) game.art = art;
    list.push(game);
    if (description) descriptions.set(game.id, { html: description, cp: cpLength(description) });
    if (i % 50 === 0) progress(`Lendo jogos… ${i}/${pages.length}`, i / pages.length);
  }
  const merged = mergeDuplicates(list, descriptions);
  const files_ = new Map();
  for (const g of merged) {
    if (!g.descId) continue;
    files_.set(`data/desc/${g.id}.json`, `{"html": ${JSON.stringify(descriptions.get(g.descId).html)}}`);
    delete g.descId;
  }
  merged.sort((a, b) => { const x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
  return { games: merged, files: files_, total: list.length };
}

// ---------- GitHub ----------
async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head); all.set(body, head.length);
  const hash = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gh(token, path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${UPD.repo}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (res.status === 401) throw new Error("Token inválido ou expirado. Gere um novo token.");
  if (res.status === 403 || res.status === 404) throw new Error("O token não tem permissão de escrita (Contents: Read and write) neste repositório.");
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

async function diffAgainstRepo(token, files) {
  const ref = await gh(token, `/git/ref/heads/${UPD.branch}`);
  const commit = await gh(token, `/git/commits/${ref.object.sha}`);
  const tree = await gh(token, `/git/trees/${commit.tree.sha}?recursive=1`);
  const current = new Map(tree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
  const changed = [];
  for (const [path, text] of files) if (current.get(path) !== await gitBlobSha(text)) changed.push(path);
  const removed = [...current.keys()].filter((p) => p.startsWith("data/desc/") && !files.has(p));
  return { parent: ref.object.sha, baseTree: commit.tree.sha, changed, removed };
}

async function publish(token, files, diff, message, progress) {
  const entries = [];
  let done = 0;
  await pool(diff.changed, 6, async (path) => {
    const blob = await gh(token, "/git/blobs", { method: "POST", body: JSON.stringify({ content: files.get(path), encoding: "utf-8" }) });
    entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    progress(`Enviando arquivos… ${++done}/${diff.changed.length}`, done / diff.changed.length);
  });
  for (const path of diff.removed) entries.push({ path, mode: "100644", type: "blob", sha: null });
  progress("Criando commit…", 1);
  const tree = await gh(token, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: diff.baseTree, tree: entries }) });
  const commit = await gh(token, "/git/commits", { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [diff.parent] }) });
  await gh(token, `/git/refs/heads/${UPD.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
  return commit;
}

// ---------- pasta salva (Chrome/Edge) ----------
// O seletor comum de pasta não pode ser lembrado; o showDirectoryPicker devolve um
// "handle" que fica guardado no IndexedDB e só precisa de um clique de permissão.
const canSaveFolder = "showDirectoryPicker" in window;

function idb(mode, fn) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open("biblioteca", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const req = fn(open.result.transaction("kv", mode).objectStore("kv"));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      };
    } catch { resolve(null); }
  });
}
const savedFolder = () => idb("readonly", (st) => st.get("folder"));
const saveFolder = (handle) => idb("readwrite", (st) => st.put(handle, "folder"));
const forgetFolder = () => idb("readwrite", (st) => st.delete("folder"));

async function filesFromHandle(dir) {
  let perm = await dir.queryPermission({ mode: "read" });
  if (perm !== "granted") perm = await dir.requestPermission({ mode: "read" });
  if (perm !== "granted") throw new Error("Sem permissão para ler a pasta. Clique de novo e escolha “Permitir”.");
  const files = [];
  for await (const [name, h] of dir.entries()) if (h.kind === "file" && P.file.test(name)) files.push(await h.getFile());
  return files;
}

// ---------- interface ----------
(() => {
  const dlg = document.getElementById("updater");
  const $u = (id) => document.getElementById(id);
  const tokenInput = $u("u-token");
  let built = null;
  let folder = null; // pasta salva (handle)
  let busy = false;

  function storage(fn) { try { return fn(localStorage); } catch { return null; } }
  function status(text, kind = "") { $u("u-status").textContent = text; $u("u-status").className = `u-status ${kind}`; }
  function progress(text, frac) {
    status(text);
    const bar = $u("u-progress");
    bar.hidden = frac == null;
    if (frac != null) bar.value = frac;
  }
  // Salva o token assim que é digitado (antes só era salvo depois de publicar)
  function saveToken() {
    const token = tokenInput.value.trim();
    if ($u("u-remember").checked && token) storage((s) => s.setItem(UPD.tokenKey, token));
    if (!$u("u-remember").checked) storage((s) => s.removeItem(UPD.tokenKey));
  }
  function refreshButtons() {
    const token = tokenInput.value.trim();
    $u("u-publish").disabled = busy || !(built && token);
    $u("u-quick").hidden = !(folder && token);
    $u("u-quick").disabled = busy;
    $u("u-forget").hidden = !storage((s) => s.getItem(UPD.tokenKey));
    $u("u-saved").hidden = !folder;
    $u("u-use-saved").hidden = !folder;
    if (folder) $u("u-saved-name").textContent = folder.name;
  }

  document.getElementById("update-btn").addEventListener("click", async () => {
    tokenInput.value = storage((s) => s.getItem(UPD.tokenKey)) || "";
    $u("u-token-step").open = !tokenInput.value;
    folder = canSaveFolder ? await savedFolder() : null;
    built = null;
    $u("u-folder-info").textContent = "";
    progress("", null);
    refreshButtons();
    dlg.showModal();
  });
  $u("u-close").addEventListener("click", () => dlg.close());
  tokenInput.addEventListener("input", () => { saveToken(); refreshButtons(); });
  $u("u-remember").addEventListener("change", () => { saveToken(); refreshButtons(); });
  $u("u-forget").addEventListener("click", () => {
    storage((s) => s.removeItem(UPD.tokenKey));
    tokenInput.value = "";
    refreshButtons();
  });
  $u("u-forget-folder").addEventListener("click", async () => {
    await forgetFolder();
    folder = null;
    refreshButtons();
  });

  async function readFolder(files) {
    built = null;
    progress("Lendo jogos…", 0);
    built = await buildFromFolder(files, progress);
    const before = new Set(games.map((g) => g.id));
    const after = new Set(built.games.map((g) => g.id));
    const added = built.games.filter((g) => !before.has(g.id)).length;
    const gone = games.filter((g) => !after.has(g.id)).length;
    $u("u-folder-info").textContent =
      `${built.games.length.toLocaleString("pt-BR")} jogos encontrados (${built.total - built.games.length} cópias repetidas juntadas) · ${added} novos · ${gone} removidos`;
    progress("Pronto para publicar.", null);
  }

  async function run(task) {
    busy = true;
    refreshButtons();
    try {
      await task();
    } catch (err) {
      if (err.name !== "AbortError") { progress(err.message, null); $u("u-status").classList.add("err"); }
    }
    busy = false;
    refreshButtons();
  }

  // No Chrome/Edge usa o seletor que pode ser lembrado; nos outros, o seletor comum
  $u("u-pick").addEventListener("click", () => {
    if (!canSaveFolder) return $u("u-folder").click();
    run(async () => {
      const dir = await window.showDirectoryPicker({ id: "html-exporter", mode: "read" });
      folder = dir;
      await saveFolder(dir);
      await readFolder(await filesFromHandle(dir));
    });
  });
  $u("u-folder").addEventListener("change", (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) run(() => readFolder(files));
  });
  $u("u-use-saved").addEventListener("click", () => run(async () => readFolder(await filesFromHandle(folder))));

  async function doPublish() {
    const token = tokenInput.value.trim();
    if (!built || !token) return;
    saveToken();
    const payload = { generated: timestamp(), games: built.games };
    const files = new Map(built.files);
    files.set("data/games.json", JSON.stringify(payload));
    progress("Comparando com o que já está publicado…", null);
    const diff = await diffAgainstRepo(token, files);
    // games.json sempre muda (data de geração); só publica se algo além disso mudou
    const gamesChanged = JSON.stringify(built.games) !== publishedGamesJSON;
    if (!gamesChanged && diff.changed.length <= 1 && !diff.removed.length) {
      progress("Nada mudou desde a última atualização. ✓", null);
      $u("u-status").classList.add("ok");
      return;
    }
    await publish(token, files, diff, `Atualiza biblioteca pelo site (${built.games.length} jogos)`, progress);
    setData(JSON.parse(files.get("data/games.json")));
    progress("Publicado! O site online atualiza em 1–2 minutos (capas de jogos novos chegam logo depois).", null);
    $u("u-status").classList.add("ok");
    built = null;
  }

  $u("u-publish").addEventListener("click", () => run(doPublish));
  // Um clique: lê a pasta salva e publica
  $u("u-quick").addEventListener("click", () => run(async () => {
    await readFolder(await filesFromHandle(folder));
    await doPublish();
  }));
})();
