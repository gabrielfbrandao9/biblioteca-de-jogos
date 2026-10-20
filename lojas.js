"use strict";
// Atualizar: conecta as lojas e monta a biblioteca com o que elas devolvem.
// A função jogos-lojas (Supabase) faz o login nas lojas e baixa os jogos; aqui só se junta tudo.

const LOJAS = {
  steam: { nome: "Steam", source: "Steam" },
  epic: { nome: "Epic", source: "Epic" },
  gog: { nome: "GOG", source: "GOG" },
  amazon: { nome: "Amazon", source: "Amazon" },
  xbox: { nome: "Xbox / MS Store", source: "Xbox" },
  psn: { nome: "PlayStation", source: "PlayStation" },
  ea: { nome: "EA app", source: "EA app" },
  ubisoft: { nome: "Ubisoft", source: "Ubisoft Connect" },
  battlenet: { nome: "Battle.net", source: "Battle.net" },
  riot: { nome: "Riot Games", source: "Riot Games" },
  legacy: { nome: "Legacy Games", source: "Legacy Games" },
};
const RIOT_JOGOS = { lol: "League of Legends", tft: "Teamfight Tactics", valorant: "VALORANT", lor: "Legends of Runeterra", "2xko": "2XKO" };
// Modos de jogo do GOG GamesDB -> nomes usados nos filtros (FEATURES em app.js)
const MODES = {
  "Single player": "Single Player", "Multiplayer": "Multiplayer", "Co-operative": "Co-Operative",
  "Split screen": "Split Screen", "Massively Multiplayer Online (MMO)": "Massively Multiplayer Online (MMO)",
  "Battle Royale": "Battle Royale",
};
const EPIC_LOGIN = "https://www.epicgames.com/id/login?redirectUrl=" +
  encodeURIComponent("https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code");
const XBOX_LOGIN = "https://login.live.com/oauth20_authorize.srf?client_id=38cd2fa8-66fd-4760-afb2-405eb65d5b0c&response_type=code" +
  "&approval_prompt=auto&scope=Xboxlive.signin%20Xboxlive.offline_access&redirect_uri=" + encodeURIComponent("https://login.live.com/oauth20_desktop.srf");
const EA_TOKEN = "https://accounts.ea.com/connect/auth?client_id=ORIGIN_JS_SDK&response_type=token&redirect_uri=nucleus:rest&prompt=none";
const GOG_LOGIN = "https://auth.gog.com/auth?client_id=46899977096215655&response_type=code&layout=client2&redirect_uri=" +
  encodeURIComponent("https://embed.gog.com/on_login_success?origin=client");

// Campos de cada cópia (loja) de um jogo; o resto é do jogo em si
const COPY_FIELDS = ["id", "source", "platforms", "status", "playtime", "lastActivity", "added"];
const UNION_FIELDS = ["platforms", "genres", "developers", "publishers", "features"];

// ---------- utilidades ----------
function isEmpty(v) { return v == null || v === "" || (Array.isArray(v) && !v.length); }
function clean(obj) {
  for (const k of Object.keys(obj)) if (isEmpty(obj[k])) delete obj[k];
  return obj;
}
const some = (list) => (Array.isArray(list) && list.length ? list : undefined);
const gdbImg = (fmt, formatter) => (fmt ? fmt.replace("{formatter}", formatter).replace("{ext}", "jpg") : undefined);
function localISO(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d)) return undefined;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
// Nome normalizado: ignora maiúsculas, acentos, ™/®, apóstrofos e pontuação
function mergeKey(name) {
  return name.replace(/['’`´]/g, "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------- montar a biblioteca ----------
function artFor(it, meta, capas) {
  if (it.loja === "steam") {
    const art = capas.get(it.id_loja);
    if (art && Object.keys(art).length) return art;
  }
  if (meta?.cover) return clean({ cover: gdbImg(meta.cover, "_glx_vertical_cover"), cover2x: gdbImg(meta.cover, ""), hero: gdbImg(meta.bg, "_bg_crop_1920x655") });
  const x = it.extra || {};
  const cover = x.cover || x.tall, hero = x.hero || x.wide || x.background;
  if (cover || hero) return clean({ cover, hero });
  return undefined;
}

// Uma cópia = um jogo numa loja
function itemCopy(it, meta, capas) {
  const m = meta || {};
  const x = it.extra || {};
  const playtime = it.playtime || 0;
  const links = [];
  if (it.loja === "steam") links.push({ name: "Steam", url: `https://store.steampowered.com/app/${it.id_loja}` });
  if (it.loja === "gog" && x.url) links.push({ name: "GOG", url: `https://www.gog.com${x.url}` });
  return clean({
    id: `${it.loja}:${it.id_loja}`,
    name: it.nome,
    source: x.source || LOJAS[it.loja].source,
    platforms: some(x.platforms) || ["PC (Windows)"],
    playtime,
    status: playtime > 0 ? "Jogado" : "Não jogado",
    lastActivity: it.ultima_vez ? localISO(it.ultima_vez) : undefined,
    added: it.adicionado ? localISO(it.adicionado) : undefined,
    releaseDate: m.date || (x.releaseDate ? String(x.releaseDate).slice(0, 10) : undefined),
    genres: some(m.genres) || some(x.genres),
    developers: some(m.devs) || (x.developer ? [x.developer] : undefined),
    publishers: some(m.pubs) || (x.publisher ? [x.publisher] : undefined),
    features: some((m.modes || []).map((v) => MODES[v] || v)),
    criticScore: m.rating != null ? Math.round(m.rating) : undefined,
    links: some(links),
    steamId: it.loja === "steam" ? Number(it.id_loja) : undefined,
    art: artFor(it, meta, capas),
    descId: m.desc || undefined,
  });
}

// Jogos com o mesmo nome em lojas diferentes viram um só, com a lista de cópias
function mergeDuplicates(list) {
  const groups = new Map();
  for (const c of list) {
    const k = mergeKey(c.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const rich = (c) => [c.art ? 1 : 0, c.descId ? 1 : 0, Object.keys(c).length];
  const cmp = (a, b) => { const x = rich(a), y = rich(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };

  const merged = [];
  for (const copies of groups.values()) {
    copies.sort(cmp);
    const best = copies[0];
    const g = {};
    for (const [k, v] of Object.entries(best)) if (!COPY_FIELDS.includes(k) && k !== "descId") g[k] = v;
    g.id = best.id;
    g.stores = [...new Set(copies.map((c) => c.source))].sort();
    g.status = copies.some((c) => c.status === "Jogado") ? "Jogado" : "Não jogado";
    g.playtime = copies.reduce((s, c) => s + (c.playtime || 0), 0);
    for (const [key, pick] of [["lastActivity", "max"], ["added", "min"]]) {
      const values = copies.map((c) => c[key]).filter(Boolean).sort();
      if (values.length) g[key] = pick === "max" ? values[values.length - 1] : values[0];
    }
    for (const key of UNION_FIELDS) {
      const values = [...new Set(copies.flatMap((c) => c[key] || []))];
      if (values.length) g[key] = values;
    }
    for (const key of ["releaseDate", "criticScore", "steamId", "art", "descId"]) {
      const c = copies.find((c) => c[key] != null);
      if (c) g[key] = c[key];
    }
    if (g.descId) g.hasDesc = 1;
    const links = new Map();
    for (const c of copies) for (const l of c.links || []) if (!links.has(l.url)) links.set(l.url, l);
    if (links.size) g.links = [...links.values()];
    if (copies.length > 1) {
      g.copies = [...copies]
        .sort((a, b) => (`${a.source}\0${a.id}` < `${b.source}\0${b.id}` ? -1 : 1))
        .map((c) => Object.fromEntries(COPY_FIELDS.filter((k) => !isEmpty(c[k])).map((k) => [k, c[k]])));
    }
    merged.push(g);
  }
  return merged;
}

// Junta as lojas sincronizadas e grava em jogos_biblioteca
async function rebuildLibrary(progress) {
  progress("Juntando as lojas…", null);
  const [items, metas] = await Promise.all([Nuvem.itens(), Nuvem.metas()]);
  if (!items.length) throw new Error("Nenhum jogo nas lojas: conecte uma loja e sincronize.");

  // Capas da Steam (as melhores): as que faltam são buscadas pela função jogos-capas
  const capas = await Nuvem.capas();
  const steamMissing = items.filter((i) => i.loja === "steam" && !capas.has(i.id_loja)).map((i) => Number(i.id_loja));
  if (steamMissing.length) {
    try {
      const found = await Nuvem.buscarCapas(steamMissing, (n) => progress(`Buscando capas na Steam… ${n}/${steamMissing.length}`, n / steamMissing.length));
      for (const [id, art] of Object.entries(found)) capas.set(id, art);
    } catch (err) {
      console.warn("Capas da Steam:", err);
    }
  }

  const list = items.map((it) => itemCopy(it, metas.get(`gdb:${it.loja}:${it.id_loja}`), capas));
  const merged = mergeDuplicates(list);
  merged.sort((a, b) => { const x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
  const payload = { generated: localISO(), games: merged };
  progress("Salvando a lista de jogos…", 1);
  return { payload, at: (await Nuvem.salvarBiblioteca(payload)).atualizado_em };
}

// ---------- interface ----------
(() => {
  const dlg = document.getElementById("updater");
  const $l = (id) => document.getElementById(id);
  let lojas = new Map(); // loja -> linha de jogos_lojas
  let aberta = null;     // loja com o formulário de conexão aberto
  let busy = false;
  let ubi2fa = false;    // a Ubisoft pediu o código de verificação

  function status(text, kind = "") { $l("u-status").textContent = text; $l("u-status").className = `u-status ${kind}`; }
  function progress(text, frac) {
    status(text);
    const bar = $l("u-progress");
    bar.hidden = frac == null;
    if (frac != null) bar.value = frac;
  }
  const fmtWhen = (iso) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  function formHTML(loja) {
    if (loja === "steam") return `
      <ol>
        <li>Crie uma chave em <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer">steamcommunity.com/dev/apikey</a> (em “Domain” pode escrever qualquer nome, como <i>biblioteca</i>).</li>
        <li>No seu perfil da Steam: Editar perfil → Privacidade → “Detalhes dos jogos”: <b>Público</b>.</li>
      </ol>
      ${lojas.has("steam") ? `<p class="l-note">Já conectada: deixe a chave e o perfil em branco para trocar só o cookie.</p>` : ""}
      <input data-f="chave" type="text" placeholder="chave da API (32 letras e números)" autocomplete="off" spellcheck="false">
      <input data-f="perfil" type="text" placeholder="link do perfil (steamcommunity.com/id/…)" autocomplete="off" spellcheck="false">
      <p class="l-note"><b>Opcional</b>: a chave não mostra jogos grátis que você nunca abriu, demos e testes. Para trazê-los, entre em
        <a href="https://store.steampowered.com/" target="_blank" rel="noopener noreferrer">store.steampowered.com</a>, aperte <b>F12</b> →
        aba <b>Aplicativo</b> (Application) → <b>Cookies</b> → <code>https://store.steampowered.com</code>, copie o valor de
        <code>steamLoginSecure</code> e cole abaixo. Ele vence de tempos em tempos: aí é só reconectar com um novo.</p>
      <textarea data-f="cookie" rows="2" placeholder="valor do steamLoginSecure (opcional)" spellcheck="false"></textarea>`;
    if (loja === "epic") return `
      <ol>
        <li><a href="${EPIC_LOGIN}" target="_blank" rel="noopener noreferrer">Abra o login da Epic</a> e entre na sua conta.</li>
        <li>A Epic mostra um texto com <code>authorizationCode</code>. Copie tudo e cole abaixo.</li>
      </ol>
      <textarea data-f="codigo" rows="3" placeholder='{"redirectUrl":…,"authorizationCode":"…"}' spellcheck="false"></textarea>`;
    if (loja === "gog") return `
      <ol>
        <li><a href="${GOG_LOGIN}" target="_blank" rel="noopener noreferrer">Abra o login do GOG</a> e entre na sua conta.</li>
        <li>Abre uma página em branco. Copie o endereço dela (na barra do navegador, começa com <code>embed.gog.com/on_login_success</code>) e cole abaixo.</li>
      </ol>
      <textarea data-f="codigo" rows="3" placeholder="https://embed.gog.com/on_login_success?origin=client&code=…" spellcheck="false"></textarea>`;
    if (loja === "xbox") return `
      <ol>
        <li><a href="${XBOX_LOGIN}" target="_blank" rel="noopener noreferrer">Abra o login da Microsoft</a> e entre com a conta do Xbox.</li>
        <li>Abre uma página em branco. Copie o endereço dela (começa com <code>login.live.com/oauth20_desktop.srf?code=</code>) e cole abaixo.</li>
      </ol>
      <p class="l-note">O Xbox só informa os jogos que você já abriu (no PC ou no console), com as horas.</p>
      <textarea data-f="codigo" rows="3" placeholder="https://login.live.com/oauth20_desktop.srf?code=…" spellcheck="false"></textarea>`;
    if (loja === "psn") return `
      <ol>
        <li>Entre na sua conta em <a href="https://www.playstation.com/" target="_blank" rel="noopener noreferrer">playstation.com</a>.</li>
        <li>Na mesma janela, <a href="https://ca.account.sony.com/api/v1/ssocookie" target="_blank" rel="noopener noreferrer">abra esta página da Sony</a>. Ela mostra um texto com <code>npsso</code>: copie tudo e cole abaixo.</li>
      </ol>
      <textarea data-f="codigo" rows="2" placeholder='{"npsso":"…"}' spellcheck="false"></textarea>`;
    if (loja === "ea") return `
      <ol>
        <li>Entre na sua conta em <a href="https://www.ea.com/" target="_blank" rel="noopener noreferrer">ea.com</a>.</li>
        <li>Na mesma janela, <a href="${EA_TOKEN}" target="_blank" rel="noopener noreferrer">abra esta página da EA</a>. Ela mostra um texto com <code>access_token</code>: copie tudo e cole abaixo.</li>
      </ol>
      <p class="l-note">O token da EA vale cerca de 1 hora: para sincronizar a EA outro dia, clique em <b>Reconectar</b> e cole um novo.</p>
      <textarea data-f="codigo" rows="3" placeholder='{"access_token":"…","token_type":"Bearer",…}' spellcheck="false"></textarea>`;
    if (loja === "ubisoft") return ubi2fa ? `
      <p class="l-note">A Ubisoft pediu o código de verificação (do app autenticador, e-mail ou SMS).</p>
      <input data-f="codigo2fa" type="text" inputmode="numeric" placeholder="código de verificação" autocomplete="one-time-code">` : `
      <p class="l-note">A senha vai direto para a Ubisoft e não fica guardada: o site guarda só o “lembrar de mim” que a Ubisoft devolve.</p>
      <input data-f="email" type="email" placeholder="e-mail da conta Ubisoft" autocomplete="off" spellcheck="false">
      <input data-f="senha" type="password" placeholder="senha da Ubisoft" autocomplete="off">`;
    if (loja === "battlenet") return `
      <ol>
        <li>Entre na sua conta em <a href="https://account.battle.net/" target="_blank" rel="noopener noreferrer">account.battle.net</a>.</li>
        <li>Aperte <b>F12</b>, vá na aba <b>Rede</b> (Network) e recarregue a página (F5).</li>
        <li>Clique no primeiro item da lista; em <b>Cabeçalhos de solicitação</b> (Request Headers), copie o valor inteiro de <code>cookie</code> e cole abaixo.</li>
      </ol>
      <p class="l-note">O cookie vence de tempos em tempos: quando der erro, clique em <b>Reconectar</b> e cole um novo.</p>
      <textarea data-f="codigo" rows="3" placeholder="BA-tassadar=…; …" spellcheck="false"></textarea>`;
    if (loja === "riot") return `
      <p class="l-note">Os jogos da Riot são gratuitos e ela não tem lista de jogos da conta: marque os que você joga.</p>
      <div class="l-checks">${Object.entries(RIOT_JOGOS).map(([k, n]) => `<label><input type="checkbox" data-riot="${k}"> ${n}</label>`).join("")}</div>`;
    if (loja === "legacy") return `
      <p class="l-note">A Legacy Games lista os jogos ganhos de brinde (Prime Gaming e outros) só pelo e-mail da conta.</p>
      <input data-f="email" type="email" placeholder="e-mail da conta Legacy Games" autocomplete="off" spellcheck="false">`;
    return `
      <ol>
        <li><button type="button" class="link accent-link" data-amazon-login>Abra o login da Amazon</button> e entre na sua conta.</li>
        <li>Depois do login abre uma página da amazon.com. Copie o endereço dela inteiro (tem <code>authorization_code</code>) e cole abaixo.</li>
      </ol>
      <textarea data-f="codigo" rows="3" placeholder="https://www.amazon.com/?openid.oa2.authorization_code=…" spellcheck="false"></textarea>`;
  }

  function render() {
    const dono = papel === "dono";
    $l("l-list").innerHTML = Object.entries(LOJAS).map(([loja, { nome }]) => {
      const l = lojas.get(loja);
      const info = l
        ? `<b>${esc(l.conta || "conectada")}</b>${l.itens != null ? ` · ${nf.format(l.itens)} jogos` : ""}${l.sincronizado_em ? ` · ${fmtWhen(l.sincronizado_em)}` : " · ainda não sincronizada"}`
        : "não conectada";
      const btn = !dono ? "" : `<span class="l-btns">${l ? `<button type="button" class="link" data-desconectar="${loja}">Desconectar</button>` : ""}
          <button type="button" class="btn" data-abrir="${loja}">${aberta === loja ? "Cancelar" : l ? "Reconectar" : "Conectar"}</button></span>`;
      const form = aberta === loja ? `<form class="l-form" data-conectar="${loja}">${formHTML(loja)}
          <button class="btn accent" type="submit">${loja === "ubisoft" && ubi2fa ? "Confirmar código" : `Conectar ${nome}`}</button></form>` : "";
      return `<li class="l-row${l ? " on" : ""}">
          <span class="l-name st st-${storeSlug(LOJAS[loja].source)}">${nome}</span>
          <span class="l-info">${info}${l?.erro ? `<small class="l-err">${esc(l.erro)}</small>` : ""}</span>
          ${btn}${form}
        </li>`;
    }).join("");
    $l("l-sync").disabled = busy || !lojas.size;
  }

  async function loadLojas() {
    lojas = new Map((await Nuvem.lojas()).map((l) => [l.loja, l]));
    render();
  }

  async function run(task) {
    busy = true;
    render();
    try {
      await task();
    } catch (err) {
      progress(err.message || String(err), null);
      $l("u-status").classList.add("err");
    }
    busy = false;
    render();
  }

  document.getElementById("update-btn").addEventListener("click", () => {
    aberta = null;
    progress("", null);
    render();
    dlg.showModal();
    loadLojas().catch((err) => progress(err.message, null));
  });
  $l("u-close").addEventListener("click", () => dlg.close());

  $l("l-list").addEventListener("click", async (e) => {
    const t = e.target;
    if (t.dataset.abrir) { aberta = aberta === t.dataset.abrir ? null : t.dataset.abrir; ubi2fa = false; render(); return; }
    if (t.dataset.desconectar) {
      const loja = t.dataset.desconectar;
      if (!confirm(`Desconectar a ${LOJAS[loja].nome}? Os jogos dela saem da biblioteca na próxima sincronização.`)) return;
      run(async () => {
        await Nuvem.lojasAcao({ acao: "desconectar", loja });
        lojas.delete(loja);
        progress(`${LOJAS[loja].nome} desconectada.`, null);
      });
      return;
    }
    if (t.hasAttribute("data-amazon-login")) {
      // Abre a janela já no clique (senão o navegador bloqueia) e depois coloca o endereço
      const w = window.open("about:blank", "_blank");
      try {
        const { url } = await Nuvem.lojasAcao({ acao: "amazon_inicio" });
        if (w) w.location = url; else window.open(url, "_blank");
      } catch (err) {
        w?.close();
        progress(err.message, null);
      }
    }
  });

  $l("l-list").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const loja = form.dataset.conectar;
    const body = { acao: "conectar", loja };
    for (const input of form.querySelectorAll("[data-f]")) body[input.dataset.f] = input.dataset.f === "senha" ? input.value : input.value.trim();
    if (loja === "riot") body.jogos = [...form.querySelectorAll("[data-riot]:checked")].map((c) => c.dataset.riot);
    run(async () => {
      progress(`Conectando ${LOJAS[loja].nome}…`, null);
      const r = await Nuvem.lojasAcao(body);
      if (r.precisa2fa) {
        ubi2fa = true;
        progress("Digite o código de verificação da Ubisoft.", null);
        return;
      }
      aberta = null;
      ubi2fa = false;
      await loadLojas();
      progress(`${LOJAS[loja].nome} conectada (${r.conta}). Agora clique em “Sincronizar lojas”.`, null);
      $l("u-status").classList.add("ok");
    });
  });

  $l("l-sync").addEventListener("click", () => run(async () => {
    const erros = [];
    for (const loja of Object.keys(LOJAS)) {
      if (!lojas.has(loja)) continue;
      progress(`Baixando a lista de jogos da ${LOJAS[loja].nome}…`, null);
      try {
        const r = await Nuvem.lojasAcao({ acao: "sincronizar", loja });
        if (r.aviso) erros.push(`${LOJAS[loja].nome}: ${r.aviso}`);
      } catch (err) {
        erros.push(`${LOJAS[loja].nome}: ${err.message}`);
      }
    }
    await loadLojas();
    // Capas, gêneros e descrições do GOG GamesDB, em lotes (só o que é novo)
    for (let i = 0; i < 60; i++) {
      const r = await Nuvem.lojasAcao({ acao: "metadados", limite: 150 });
      if (!r.faltam || !r.feitos) break;
      progress(`Buscando capas e descrições… faltam ${nf.format(r.faltam)}`, null);
    }
    const { payload, at } = await rebuildLibrary(progress);
    onPublished(payload, at);
    progress(`Biblioteca atualizada: ${nf.format(payload.games.length)} jogos. ✓`, null);
    $l("u-status").classList.add("ok");
    if (erros.length) {
      $l("u-status").textContent += ` Com erro: ${erros.join(" · ")}`;
      $l("u-status").className = "u-status err";
    }
  }));
})();
