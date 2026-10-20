// Biblioteca de Jogos: conexão direta com as lojas (Steam, Epic, GOG, Amazon, Xbox/Microsoft Store,
// PlayStation, EA, Ubisoft, Battle.net, Riot e Legacy Games).
//
// Ações (POST JSON { acao, loja, ... }):
//   amazon_inicio            gera o link de login da Amazon (só dono)
//   conectar                 troca o código de login por um token e guarda (só dono)
//   desconectar              apaga token e jogos da loja (só dono)
//   sincronizar              baixa a lista de jogos da loja para jogos_itens (dono e editor)
//   metadados                completa capas/gêneros/descrições pelo GOG GamesDB, em lotes (dono e editor)
//
// Os tokens ficam em jogos_tokens, que nenhum navegador lê: só esta função (service role).
// Os métodos de login da Epic, GOG e Amazon são os mesmos dos apps Legendary/Heroic, gogdl e Nile.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class Erro extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}
const NOMES: Record<string, string> = {
  steam: "Steam", epic: "Epic", gog: "GOG", amazon: "Amazon", xbox: "Xbox", psn: "PlayStation", ea: "EA app",
  ubisoft: "Ubisoft Connect", battlenet: "Battle.net", riot: "Riot Games", legacy: "Legacy Games",
};
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

type Item = {
  loja: string; id_loja: string; nome: string;
  playtime: number | null; ultima_vez: string | null; adicionado: string | null;
  extra: Record<string, unknown>;
};

// ---------- utilidades ----------
function check<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw new Erro((res.error as { message?: string }).message || String(res.error), 500);
  return res.data;
}
async function getJSON(url: string, init: RequestInit = {}, what = "a loja") {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* não é JSON */ }
  if (!res.ok) {
    const msg = body?.errorMessage || body?.error_description || body?.message || body?.error || text.slice(0, 200);
    throw new Erro(`${what} respondeu ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, 502);
  }
  if (body === null) throw new Erro(`${what} devolveu uma resposta inesperada.`, 502);
  return body;
}
async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}
function chunks<T>(list: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
const cleanName = (s: string) => s.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
const isoFromUnix = (s: number) => (s > 0 ? new Date(s * 1000).toISOString() : null);

async function lerToken(loja: string) {
  const row = check(await admin.from("jogos_tokens").select("dados").eq("loja", loja).maybeSingle());
  if (!row) throw new Erro(`${NOMES[loja]} não está conectada.`);
  return row.dados as Record<string, any>;
}
async function salvarToken(loja: string, dados: Record<string, unknown>) {
  check(await admin.from("jogos_tokens").upsert({ loja, dados, atualizado_em: new Date().toISOString() }));
}
async function salvarLoja(loja: string, patch: Record<string, unknown>) {
  check(await admin.from("jogos_lojas").upsert({ loja, ...patch }));
}
async function conectada(loja: string, conta: string) {
  await salvarLoja(loja, { conta, conectado_em: new Date().toISOString(), erro: null });
  return { conta };
}

// ---------- Steam (API oficial) ----------
async function steamApi(path: string, params: Record<string, string | number>) {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`https://api.steampowered.com/${path}/?${qs}`);
  if (res.status === 401 || res.status === 403) throw new Erro("A Steam recusou a chave da API. Confira se copiou a chave inteira.");
  if (!res.ok) throw new Erro(`A Steam respondeu ${res.status}.`, 502);
  return await res.json();
}
async function steamId(chave: string, perfil: string) {
  const p = perfil.trim();
  const num = /(\d{17})/.exec(p);
  if (num) return num[1];
  const vanity = /\/id\/([^/?#\s]+)/.exec(p)?.[1] || p.replace(/\/+$/, "");
  if (!vanity) throw new Erro("Informe o link do seu perfil da Steam.");
  const r = await steamApi("ISteamUser/ResolveVanityURL/v1", { key: chave, vanityurl: vanity });
  if (r.response?.success !== 1) throw new Erro("Não achei esse perfil da Steam. Cole o link do perfil (steamcommunity.com/id/… ou /profiles/…).");
  return r.response.steamid as string;
}
async function steamOwned(chave: string, steamid: string) {
  const r = await steamApi("IPlayerService/GetOwnedGames/v1", {
    key: chave, steamid, include_appinfo: 1, include_played_free_games: 1, include_free_sub: 1, skip_unvetted_apps: 0,
  });
  if (!r.response || r.response.game_count === undefined) {
    throw new Erro("A Steam não mostrou os jogos. Em Perfil → Editar perfil → Privacidade, deixe “Detalhes dos jogos” como Público.");
  }
  return (r.response.games || []) as any[];
}
async function steamConectar(body: any) {
  const chave = String(body.chave || "").trim();
  if (!/^[0-9A-F]{32}$/i.test(chave)) throw new Erro("A chave da API da Steam tem 32 letras e números.");
  const steamid = await steamId(chave, String(body.perfil || ""));
  await steamOwned(chave, steamid);
  const s = await steamApi("ISteamUser/GetPlayerSummaries/v2", { key: chave, steamids: steamid });
  await salvarToken("steam", { chave, steamid });
  return conectada("steam", s.response?.players?.[0]?.personaname || steamid);
}
async function steamSync(): Promise<Item[]> {
  const t = await lerToken("steam");
  const games = await steamOwned(t.chave, t.steamid);
  return games.map((g) => ({
    loja: "steam", id_loja: String(g.appid), nome: cleanName(g.name || `App ${g.appid}`),
    playtime: (g.playtime_forever || 0) * 60, ultima_vez: isoFromUnix(g.rtime_last_played || 0), adicionado: null, extra: {},
  }));
}

// ---------- Epic (mesmo login do Legendary/Heroic) ----------
const EPIC_BASIC = btoa("34a02cf8f4414e29b15921876da36f9a:daafbccc737745039dffe53d94fc76cf");
const EPIC_UA = "UELauncher/11.0.1-14907503+++Portal+Release-Live Windows/10.0.19041.1.256.64bit";
const EPIC_LIBRARY = "https://library-service.live.use1a.on.epicgames.com/library/api/public";

async function epicToken(params: Record<string, string>) {
  const res = await fetch("https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token", {
    method: "POST",
    headers: { Authorization: `basic ${EPIC_BASIC}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": EPIC_UA },
    body: new URLSearchParams({ ...params, token_type: "eg1" }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.errorCode || !res.ok) {
    if (j.errorCode === "errors.com.epicgames.account.oauth.authorization_code_not_found") {
      throw new Erro("Esse código da Epic já foi usado ou expirou. Abra o login de novo e cole o código novo.");
    }
    throw new Erro(`A Epic recusou o login: ${j.errorMessage || j.errorCode || res.status}`);
  }
  return j;
}
async function epicConectar(body: any) {
  const raw = String(body.codigo || "");
  const code = /"authorizationCode"\s*:\s*"([^"]+)"/.exec(raw)?.[1] || raw.trim();
  if (!/^[0-9a-f]{32}$/i.test(code)) throw new Erro("Cole o texto que a Epic mostrou depois do login (com “authorizationCode”).");
  const j = await epicToken({ grant_type: "authorization_code", code });
  await salvarToken("epic", { refresh_token: j.refresh_token, account_id: j.account_id });
  return conectada("epic", j.displayName || j.account_id);
}
async function epicSessao() {
  const t = await lerToken("epic");
  const j = await epicToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await salvarToken("epic", { refresh_token: j.refresh_token, account_id: j.account_id });
  return j;
}
async function epicSync(): Promise<Item[]> {
  const s = await epicSessao();
  const headers = { Authorization: `bearer ${s.access_token}`, "User-Agent": EPIC_UA };

  const records: any[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const j = await getJSON(`${EPIC_LIBRARY}/items?includeMetadata=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers }, "A Epic");
    records.push(...(j.records || []));
    cursor = j.responseMetadata?.nextCursor || "";
    if (!cursor) break;
  }
  let playtime: Map<string, number> | null = null;
  try {
    const list = await getJSON(`${EPIC_LIBRARY}/playtime/account/${s.account_id}/all`, { headers }, "A Epic");
    playtime = new Map((list as any[]).map((p) => [p.artifactId, p.totalTime || 0]));
  } catch (err) {
    console.warn("Epic playtime:", err);
  }

  const seen = new Set<string>();
  const assets = records.filter((r) => {
    if (r.namespace === "ue" || r.sandboxType === "PRIVATE" || !r.appName || seen.has(r.appName)) return false;
    seen.add(r.appName);
    return true;
  });

  // Catálogo (título, tipo, imagens): fica guardado em jogos_meta, então só o que é novo é consultado
  const key = (r: any) => `epiccat:${r.namespace}:${r.catalogItemId}`;
  const catalog = new Map<string, any>();
  for (const part of chunks(assets.map(key), 40)) {
    for (const row of check(await admin.from("jogos_meta").select("chave, dados").in("chave", part)) as any[]) catalog.set(row.chave, row.dados);
  }
  const missing = assets.filter((r) => !catalog.has(key(r)));
  const novos: { chave: string; dados: unknown }[] = [];
  await pool(missing, 12, async (r) => {
    try {
      const url = `https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/${r.namespace}/bulk/items` +
        `?id=${r.catalogItemId}&includeDLCDetails=true&includeMainGameDetails=true&country=BR&locale=pt-BR`;
      const item = (await getJSON(url, { headers }, "O catálogo da Epic"))[r.catalogItemId];
      if (!item) return;
      const images = Object.fromEntries((item.keyImages || []).map((k: any) => [k.type, k.url]));
      const dados = {
        title: item.title,
        categories: (item.categories || []).map((c: any) => c.path),
        mainGame: !!item.mainGameItem,
        tall: images.DieselGameBoxTall || images.OfferImageTall || null,
        wide: images.DieselGameBox || images.OfferImageWide || null,
        developer: item.developer || null,
      };
      catalog.set(key(r), dados);
      novos.push({ chave: key(r), dados });
    } catch (err) {
      console.warn("Epic catálogo", r.appName, err);
    }
  });
  for (const part of chunks(novos, 300)) check(await admin.from("jogos_meta").upsert(part));

  const items: Item[] = [];
  for (const r of assets) {
    const c = catalog.get(key(r));
    if (!c) continue;
    const cats: string[] = c.categories || [];
    // Mesmo filtro do Playnite: só aplicativos, sem DLC (a não ser DLC jogável), extras ou plugins
    if (!cats.includes("applications")) continue;
    if (c.mainGame && !cats.includes("addons/launchable")) continue;
    if (cats.some((p) => p === "digitalextras" || p === "plugins" || p === "plugins/engine")) continue;
    items.push({
      loja: "epic", id_loja: r.appName, nome: cleanName(c.title || r.appName),
      playtime: playtime ? playtime.get(r.appName) || 0 : null,
      ultima_vez: null, adicionado: r.acquisitionDate || null,
      extra: { tall: c.tall, wide: c.wide },
    });
  }
  return items;
}

// ---------- GOG (mesmo login do GOG Galaxy / gogdl) ----------
const GOG_ID = "46899977096215655";
const GOG_SECRET = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
const GOG_REDIRECT = "https://embed.gog.com/on_login_success?origin=client";

async function gogToken(params: Record<string, string>) {
  const qs = new URLSearchParams({ client_id: GOG_ID, client_secret: GOG_SECRET, ...params });
  const res = await fetch(`https://auth.gog.com/token?${qs}`);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error || !j.access_token) {
    throw new Erro(j.error === "invalid_grant"
      ? "Esse código do GOG já foi usado ou expirou. Abra o login de novo e cole o endereço novo."
      : `O GOG recusou o login: ${j.error_description || j.error || res.status}`);
  }
  return j;
}
async function gogConectar(body: any) {
  const raw = String(body.codigo || "");
  const code = /[?&]code=([^&\s#]+)/.exec(raw)?.[1] || raw.trim();
  if (!code || /\s|\//.test(code)) throw new Erro("Cole o endereço da página em branco que abriu depois do login (on_login_success…code=…).");
  const j = await gogToken({ grant_type: "authorization_code", code: decodeURIComponent(code), redirect_uri: GOG_REDIRECT });
  const user = await getJSON("https://embed.gog.com/userData.json", { headers: { Authorization: `Bearer ${j.access_token}` } }, "O GOG");
  await salvarToken("gog", { refresh_token: j.refresh_token, user_id: j.user_id, username: user.username });
  return conectada("gog", user.username || j.user_id);
}
async function gogSync(): Promise<Item[]> {
  const t = await lerToken("gog");
  const j = await gogToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await salvarToken("gog", { ...t, refresh_token: j.refresh_token });
  const headers = { Authorization: `Bearer ${j.access_token}` };

  const products: any[] = [];
  for (let page = 1, total = 1; page <= total && page <= 100; page++) {
    const r = await getJSON(`https://embed.gog.com/account/getFilteredProducts?mediaType=1&hiddenFlag=0&sortBy=title&page=${page}`, { headers }, "O GOG");
    products.push(...(r.products || []));
    total = r.totalPages || 1;
  }

  // Horas jogadas (contadas pelo GOG Galaxy): mesma página de estatísticas que o Playnite usa
  let stats: Map<string, { playtime: number; last: string | null }> | null = null;
  try {
    const map = new Map();
    for (let page = 1, pages = 1; page <= pages && page <= 100; page++) {
      const url = `https://www.gog.com/u/${encodeURIComponent(t.username)}/games/stats?sort=recent_playtime&order=desc&page=${page}`;
      // O site do GOG aceita o token de login como cookie "gog-al"; sem ele, só funciona com perfil público
      const r = await getJSON(url, { headers: { Cookie: `gog-al=${j.access_token}` } }, "O GOG")
        .catch(() => getJSON(url, {}, "As estatísticas do GOG"));
      pages = r.pages || 1;
      for (const it of r._embedded?.items || []) {
        const s = it.stats && !Array.isArray(it.stats) ? Object.values(it.stats)[0] as any : null;
        map.set(String(it.game?.id), { playtime: (s?.playtime || 0) * 60, last: s?.lastSession || null });
      }
    }
    stats = map;
  } catch (err) {
    console.warn("GOG stats:", err);
  }

  return products.map((p) => {
    const s = stats?.get(String(p.id));
    return {
      loja: "gog", id_loja: String(p.id), nome: cleanName(p.title || String(p.id)),
      playtime: stats ? s?.playtime || 0 : null, ultima_vez: s?.last || null, adicionado: null,
      extra: { url: p.url || null, image: p.image ? `https:${p.image}` : null },
    };
  });
}

// ---------- Amazon (mesmo login do Nile) ----------
const AMAZON_UA = "com.amazon.agslauncher.win/3.0.9202.1";

async function amazonInicio() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await sha256(verifier));
  const serial = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const clientId = hex(new TextEncoder().encode(`${serial}#A2UMVHOX7UP4V7`));
  const atual = check(await admin.from("jogos_tokens").select("dados").eq("loja", "amazon").maybeSingle()) as any;
  await salvarToken("amazon", { ...(atual?.dados || {}), pendente: { verifier, serial, clientId } });
  const args = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.mode": "checkid_setup",
    "openid.oa2.scope": "device_auth_access",
    "openid.ns.oa2": "http://www.amazon.com/ap/ext/oauth/2",
    "openid.oa2.response_type": "code",
    "openid.oa2.code_challenge_method": "S256",
    "openid.oa2.client_id": `device:${clientId}`,
    "language": "pt_BR",
    "marketPlaceId": "ATVPDKIKX0DER",
    "openid.return_to": "https://www.amazon.com",
    "openid.pape.max_auth_age": "0",
    "openid.assoc_handle": "amzn_sonic_games_launcher",
    "pageId": "amzn_sonic_games_launcher",
    "openid.oa2.code_challenge": challenge,
  });
  return { url: `https://amazon.com/ap/signin?${args}` };
}
async function amazonConectar(body: any) {
  const raw = String(body.codigo || "");
  const code = /openid\.oa2\.authorization_code=([^&\s#]+)/.exec(raw)?.[1];
  if (!code) throw new Erro("Cole o endereço inteiro da página da Amazon que abriu depois do login (tem “authorization_code” nele).");
  const t = await lerToken("amazon");
  const p = t.pendente;
  if (!p) throw new Erro("Clique em “Abrir login da Amazon” de novo antes de colar o endereço.");
  const res = await fetch("https://api.amazon.com/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_data: {
        authorization_code: decodeURIComponent(code), client_domain: "DeviceLegacy", client_id: p.clientId,
        code_algorithm: "SHA-256", code_verifier: p.verifier, use_global_authentication: false,
      },
      registration_data: {
        app_name: "AGSLauncher for Windows", app_version: "1.0.0", device_model: "Windows", device_name: null,
        device_serial: p.serial, device_type: "A2UMVHOX7UP4V7", domain: "Device", os_version: "10.0.19044.0",
      },
      requested_extensions: ["customer_info", "device_info"],
      requested_token_type: ["bearer", "mac_dms"],
      user_context_map: {},
    }),
  });
  const j = await res.json().catch(() => ({}));
  const ok = j.response?.success;
  if (!res.ok || !ok) throw new Erro(`A Amazon recusou o login: ${j.response?.error?.message || res.status}. Abra o login de novo.`);
  const serial = ok.extensions?.device_info?.device_serial_number || p.serial;
  await salvarToken("amazon", { refresh_token: ok.tokens.bearer.refresh_token, serial });
  const info = ok.extensions?.customer_info || {};
  return conectada("amazon", info.given_name || info.name || "Amazon");
}
async function amazonSync(): Promise<Item[]> {
  const t = await lerToken("amazon");
  const tok = await getJSON("https://api.amazon.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_token: t.refresh_token, source_token_type: "refresh_token", requested_token_type: "access_token",
      app_name: "AGSLauncher for Windows", app_version: "1.0.0",
    }),
  }, "A Amazon");
  const hardwareHash = hex(await sha256(t.serial)).toUpperCase();
  const byProduct = new Map<string, any>();
  let nextToken: string | null = null;
  for (let page = 0; page < 100; page++) {
    const r: any = await getJSON("https://gaming.amazon.com/api/distribution/entitlements", {
      method: "POST",
      headers: {
        "X-Amz-Target": "com.amazon.animusdistributionservice.entitlement.AnimusEntitlementsService.GetEntitlements",
        "x-amzn-token": tok.access_token, "User-Agent": AMAZON_UA,
        "Content-Type": "application/json", "Content-Encoding": "amz-1.0",
      },
      body: JSON.stringify({
        Operation: "GetEntitlements", clientId: "Sonic", syncPoint: null, nextToken, maxResults: 50,
        productIdFilter: null, keyId: "d5dc8b8b-86c8-4fc4-ae93-18c0def5314d", hardwareHash,
      }),
    }, "A Amazon");
    for (const e of r.entitlements || []) if (e.product?.id && !byProduct.has(e.product.id)) byProduct.set(e.product.id, e);
    nextToken = r.nextToken || null;
    if (!nextToken) break;
  }
  return [...byProduct.values()].map((e) => {
    const d = e.product.productDetail?.details || {};
    return {
      loja: "amazon", id_loja: e.product.id, nome: cleanName(e.product.title || e.product.id),
      playtime: null, ultima_vez: null, adicionado: e.grantTime || null,
      extra: {
        developer: d.developer || null, publisher: d.publisher || null, genres: d.genres || null,
        releaseDate: d.releaseDate || null, background: d.backgroundUrl1 || d.backgroundUrl2 || null,
        logo: d.logoUrl || null, icon: e.product.productDetail?.iconUrl || d.iconUrl || null,
      },
    };
  });
}

// ---------- Xbox e Microsoft Store (mesmo login do app Xbox, como o Playnite) ----------
const MS_ID = "38cd2fa8-66fd-4760-afb2-405eb65d5b0c";
const MS_REDIRECT = "https://login.live.com/oauth20_desktop.srf";
const MS_SCOPE = "Xboxlive.signin Xboxlive.offline_access";
const XBOX_PLATFORMS: Record<string, string> = {
  PC: "PC (Windows)", XboxOne: "Microsoft Xbox One", XboxSeries: "Microsoft Xbox Series", Xbox360: "Microsoft Xbox 360",
};

async function msToken(params: Record<string, string>) {
  const res = await fetch("https://login.live.com/oauth20_token.srf", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: MS_ID, redirect_uri: MS_REDIRECT, scope: MS_SCOPE }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Erro(j.error === "invalid_grant"
      ? "Esse código da Microsoft já foi usado ou expirou. Abra o login de novo e cole o endereço novo."
      : `A Microsoft recusou o login: ${j.error_description || j.error || res.status}`);
  }
  return j;
}
async function xsts(accessToken: string) {
  const headers = { "Content-Type": "application/json", Accept: "application/json", "x-xbl-contract-version": "1" };
  const user = await getJSON("https://user.auth.xboxlive.com/user/authenticate", {
    method: "POST", headers,
    body: JSON.stringify({ RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT", Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${accessToken}` } }),
  }, "O Xbox");
  const x = await getJSON("https://xsts.auth.xboxlive.com/xsts/authorize", {
    method: "POST", headers,
    body: JSON.stringify({ RelyingParty: "http://xboxlive.com", TokenType: "JWT", Properties: { SandboxId: "RETAIL", UserTokens: [user.Token] } }),
  }, "O Xbox");
  const xui = x.DisplayClaims?.xui?.[0] || {};
  return { auth: `XBL3.0 x=${xui.uhs};${x.Token}`, xuid: xui.xid as string, gamertag: (xui.gtg || xui.xid) as string };
}
async function xboxConectar(body: any) {
  const raw = String(body.codigo || "");
  const code = /[?&]code=([^&\s#]+)/.exec(raw)?.[1];
  if (!code) throw new Erro("Cole o endereço da página em branco que abriu depois do login (oauth20_desktop.srf?code=…).");
  const j = await msToken({ grant_type: "authorization_code", code: decodeURIComponent(code) });
  const s = await xsts(j.access_token);
  await salvarToken("xbox", { refresh_token: j.refresh_token });
  return conectada("xbox", s.gamertag || "Xbox");
}
async function xboxSync(): Promise<Item[]> {
  const t = await lerToken("xbox");
  const j = await msToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await salvarToken("xbox", { refresh_token: j.refresh_token || t.refresh_token });
  const s = await xsts(j.access_token);
  const headers = { Authorization: s.auth, "x-xbl-contract-version": "2", "Accept-Language": "pt-BR", Accept: "application/json" };
  const r = await getJSON(`https://titlehub.xboxlive.com/users/xuid(${s.xuid})/titles/titlehistory/decoration/detail`, { headers }, "O Xbox");
  const titles = ((r.titles || []) as any[]).filter((x) => x.type === "Game");

  // Minutos jogados de cada título (o Xbox só conta o que foi aberto)
  const minutes = new Map<string, number>();
  for (const part of chunks(titles.map((x) => String(x.titleId)), 100)) {
    try {
      const st = await getJSON("https://userstats.xboxlive.com/batch", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ arrangebyfield: "xuid", xuids: [s.xuid], stats: part.map((titleid) => ({ name: "MinutesPlayed", titleid })) }),
      }, "As estatísticas do Xbox");
      for (const it of st.statlistscollection?.[0]?.stats || []) if (it.value) minutes.set(String(it.titleid), Number(it.value) || 0);
    } catch (err) {
      console.warn("Xbox stats:", err);
    }
  }
  return titles.map((x) => {
    const devices: string[] = x.devices || [];
    const d = x.detail || {};
    return {
      loja: "xbox", id_loja: String(x.titleId), nome: cleanName(String(x.name || x.titleId).replace(/\(PC\)/g, "")),
      playtime: (minutes.get(String(x.titleId)) || 0) * 60,
      ultima_vez: x.titleHistory?.lastTimePlayed || null, adicionado: null,
      extra: {
        source: devices.includes("PC") ? "Microsoft Store" : "Xbox",
        platforms: devices.map((v) => XBOX_PLATFORMS[v]).filter(Boolean),
        cover: x.displayImage || null,
        developer: d.developerName || null, publisher: d.publisherName || null,
        genres: d.genres || null, releaseDate: d.releaseDate || null,
      },
    };
  });
}

// ---------- PlayStation (mesmo método do psn-api) ----------
const PSN_AUTH = "https://ca.account.sony.com/api/authz/v3/oauth";
const PSN_BASIC = "MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const PSN_REDIRECT = "com.scee.psxandroid.scecompcall://redirect";
const PSN_SCOPE = "psn:mobile.v2.core psn:clientapp";

async function psnToken(params: Record<string, string>) {
  const res = await fetch(`${PSN_AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${PSN_BASIC}` },
    body: new URLSearchParams({ ...params, token_format: "jwt" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Erro(`A PlayStation recusou o login: ${j.error_description || j.error || res.status}. Pegue um código NPSSO novo.`);
  return j;
}
async function psnConectar(body: any) {
  const raw = String(body.codigo || "");
  const npsso = /"npsso"\s*:\s*"([^"]+)"/.exec(raw)?.[1] || raw.trim();
  if (!/^[A-Za-z0-9]{40,}$/.test(npsso)) throw new Erro("Cole o texto que a página da Sony mostrou (com “npsso”).");
  const qs = new URLSearchParams({ access_type: "offline", client_id: "09515159-7237-4370-9b40-3806e67c0891", redirect_uri: PSN_REDIRECT, response_type: "code", scope: PSN_SCOPE });
  const res = await fetch(`${PSN_AUTH}/authorize?${qs}`, { headers: { Cookie: `npsso=${npsso}` }, redirect: "manual" });
  await res.body?.cancel();
  const code = /[?&]code=([^&]+)/.exec(res.headers.get("location") || "")?.[1];
  if (!code) throw new Erro("A Sony não aceitou esse código NPSSO. Entre de novo em playstation.com e pegue um código novo.");
  const j = await psnToken({ code, redirect_uri: PSN_REDIRECT, grant_type: "authorization_code" });
  let conta = "PlayStation";
  try {
    const p = await getJSON("https://us-prof.np.community.playstation.net/userProfile/v1/users/me/profile2?fields=onlineId", { headers: { Authorization: `Bearer ${j.access_token}` } }, "A PlayStation");
    conta = p.profile?.onlineId || conta;
  } catch { /* só o nome da conta */ }
  await salvarToken("psn", { refresh_token: j.refresh_token });
  return conectada("psn", conta);
}
function isoDuration(d: string | null | undefined) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(d || "");
  return m ? Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Math.round(Number(m[4] || 0)) : 0;
}
async function psnSync(): Promise<Item[]> {
  const t = await lerToken("psn");
  const j = await psnToken({ refresh_token: t.refresh_token, grant_type: "refresh_token", scope: PSN_SCOPE });
  if (j.refresh_token) await salvarToken("psn", { refresh_token: j.refresh_token });
  const headers = { Authorization: `Bearer ${j.access_token}`, "Accept-Language": "pt-BR" };
  const plat = (p: string) => (/ps5/i.test(p) ? "Sony PlayStation 5" : /ps4/i.test(p) ? "Sony PlayStation 4" : null);
  const byTitle = new Map<string, Item>();

  // Jogos comprados (inclui os que nunca foram abertos)
  try {
    for (let start = 0; start < 5000; start += 100) {
      const url = "https://web.np.playstation.com/api/graphql/v1/op?operationName=getPurchasedGameList" +
        `&variables=${encodeURIComponent(JSON.stringify({ isActive: true, platform: ["ps4", "ps5"], size: 100, start, sortBy: "ACTIVE_DATE", sortDirection: "desc" }))}` +
        `&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: "827a423f6a8ddca4107ac01395af2ec0eafd8396fc7fa204aaf9b7ed2eefa168" } }))}`;
      const r = await getJSON(url, { headers }, "A PlayStation");
      const games = r.data?.purchasedTitlesRetrieve?.games || [];
      for (const g of games) {
        if (!g.titleId || byTitle.has(g.titleId)) continue;
        byTitle.set(g.titleId, {
          loja: "psn", id_loja: g.titleId, nome: cleanName(g.name || g.titleId), playtime: 0, ultima_vez: null, adicionado: null,
          extra: { cover: g.image?.url || null, platforms: [plat(g.platform || "")].filter(Boolean) },
        });
      }
      if (games.length < 100) break;
    }
  } catch (err) {
    console.warn("PSN comprados:", err);
  }
  // Jogos jogados, com horas
  for (let offset = 0; offset < 5000;) {
    const r = await getJSON(`https://m.np.playstation.com/api/gamelist/v2/users/me/titles?categories=ps4_game,ps5_native_game&limit=200&offset=${offset}`, { headers }, "A PlayStation");
    for (const g of r.titles || []) {
      const old = byTitle.get(g.titleId);
      byTitle.set(g.titleId, {
        loja: "psn", id_loja: g.titleId, nome: cleanName(g.localizedName || g.name || old?.nome || g.titleId),
        playtime: isoDuration(g.playDuration), ultima_vez: g.lastPlayedDateTime || null, adicionado: null,
        extra: { cover: g.localizedImageUrl || g.imageUrl || old?.extra.cover || null, platforms: [plat(g.category || "")].filter(Boolean) },
      });
    }
    if (!r.nextOffset || !(r.titles || []).length) break;
    offset = r.nextOffset;
  }
  return [...byTitle.values()];
}

// ---------- EA app (token de 1 hora, colado a cada sincronização) ----------
async function eaConectar(body: any) {
  const raw = String(body.codigo || "");
  const token = (/"access_token"\s*:\s*"([^"]+)"/.exec(raw)?.[1] || raw.trim()).replace(/^bearer\s+/i, "");
  if (token.length < 20 || /\s/.test(token)) throw new Erro("Cole o texto que a página da EA mostrou (com “access_token”).");
  await eaOwned(token, 1); // confere se o token vale
  await salvarToken("ea", { token, colado_em: new Date().toISOString() });
  return conectada("ea", "token colado agora (vale ~1 hora)");
}
async function eaOwned(token: string, maxPages = 50) {
  const items: any[] = [];
  let next: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const variables: Record<string, unknown> = {
      isMac: false, addFieldsToPreloadGames: true, locale: "pt-BR", limit: 200,
      type: ["DIGITAL_FULL_GAME", "PACKAGED_FULL_GAME"], entitlementEnabled: true, storefronts: ["EA"], platforms: ["PC"],
    };
    if (next) variables.next = next;
    const res = await fetch("https://service-aggregation-layer.juno.ea.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": BROWSER_UA },
      body: JSON.stringify({
        operationName: "getPreloadedOwnedGames", variables,
        extensions: { persistedQuery: { version: 1, sha256Hash: "5de4178ee7e1f084ce9deca856c74a9e03547a67dfafc0cb844d532fb54ae73d" } },
      }),
    });
    if (res.status === 401 || res.status === 403) throw new Erro("O token da EA venceu (dura ~1 hora). Clique em “Colar token novo” e sincronize de novo.");
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.errors) throw new Erro(`A EA respondeu ${res.status}: ${JSON.stringify(j.errors || j).slice(0, 200)}`, 502);
    const owned = j.data?.me?.preloadedOwnedGames || {};
    items.push(...(owned.items || []));
    next = owned.next || null;
    if (!next || !(owned.items || []).length) break;
  }
  return items;
}
async function eaSync(): Promise<Item[]> {
  const t = await lerToken("ea");
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const it of await eaOwned(t.token)) {
    const p = it.product || {};
    const name = p.name || p.baseItem?.title;
    const id = String(it.originOfferId || it.id || name);
    if (!name || seen.has(id)) continue;
    seen.add(id);
    items.push({
      loja: "ea", id_loja: id, nome: cleanName(name), playtime: null, ultima_vez: null, adicionado: null,
      extra: { releaseDate: p.lifecycleStatus?.[0]?.playableStartDate || null },
    });
  }
  return items;
}

// ---------- Ubisoft Connect (e-mail e senha; guarda só o "lembrar de mim") ----------
const UBI_SESSIONS = "https://public-ubiservices.ubi.com/v3/profiles/sessions";
const UBI_HEADERS = {
  "Ubi-AppId": "82b650c0-6cb3-40c0-9f41-25a53b62b206", "Content-Type": "application/json", "User-Agent": BROWSER_UA,
  Origin: "https://connect.ubisoft.com", Referer: "https://connect.ubisoft.com/",
};
async function ubiSession(authorization: string, extra: Record<string, string> = {}) {
  const res = await fetch(UBI_SESSIONS, { method: "POST", headers: { ...UBI_HEADERS, Authorization: authorization, ...extra }, body: JSON.stringify({ rememberMe: true }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Erro("A Ubisoft recusou: e-mail, senha ou código errado (ou o login venceu). Conecte de novo.");
    if (res.status === 429) throw new Erro("A Ubisoft bloqueou por muitas tentativas. Espere alguns minutos.");
    throw new Erro(`A Ubisoft respondeu ${res.status}: ${j.message || ""}`, 502);
  }
  return j;
}
const b64utf8 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
async function ubiConectar(body: any) {
  let j;
  if (body.codigo2fa) {
    const t = await lerToken("ubisoft");
    if (!t.pendente) throw new Erro("Digite o e-mail e a senha de novo.");
    j = await ubiSession(`ubi_2fa_v1 t=${t.pendente}`, { "Ubi-2FACode": String(body.codigo2fa).trim() });
  } else {
    const email = String(body.email || "").trim(), senha = String(body.senha || "");
    if (!email || !senha) throw new Erro("Digite o e-mail e a senha da Ubisoft.");
    j = await ubiSession(`Basic ${b64utf8(`${email}:${senha}`)}`);
  }
  if (!j.ticket && j.twoFactorAuthenticationTicket) {
    await salvarToken("ubisoft", { pendente: j.twoFactorAuthenticationTicket });
    return { precisa2fa: true };
  }
  if (!j.rememberMeTicket) throw new Erro("A Ubisoft não devolveu o “lembrar de mim”. Tente de novo.");
  await salvarToken("ubisoft", { remember: j.rememberMeTicket });
  return conectada("ubisoft", j.nameOnPlatform || "Ubisoft");
}
async function ubiSync(): Promise<Item[]> {
  const t = await lerToken("ubisoft");
  if (!t.remember) throw new Erro("Conecte a Ubisoft de novo.");
  const s = await ubiSession(`rm_v1 t=${t.remember}`);
  await salvarToken("ubisoft", { remember: s.rememberMeTicket || t.remember });
  const query = "query AllGames { viewer { id ownedGames: games(filterBy: {isOwned: true}) { totalCount nodes { id spaceId name coverUrl backgroundUrl " +
    "viewer { meta { id ownedPlatformGroups { id name type } } } } } } }";
  const r = await getJSON("https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql", {
    method: "POST",
    headers: { ...UBI_HEADERS, Authorization: `Ubi_v1 t=${s.ticket}`, "Ubi-SessionId": s.sessionId },
    body: JSON.stringify({ operationName: "AllGames", variables: { owned: true }, query }),
  }, "A Ubisoft");
  const nodes: any[] = r.data?.viewer?.ownedGames?.nodes || [];
  return nodes.map((g) => {
    const groups: any[] = g.viewer?.meta?.ownedPlatformGroups || [];
    return {
      loja: "ubisoft", id_loja: String(g.spaceId || g.id), nome: cleanName(g.name || String(g.id)), playtime: null, ultima_vez: null, adicionado: null,
      extra: {
        cover: g.coverUrl || null, hero: g.backgroundUrl || null,
        platforms: groups.some((p) => /pc/i.test(`${p.type} ${p.name}`)) || !groups.length ? ["PC (Windows)"] : groups.map((p) => p.name).filter(Boolean),
      },
    };
  });
}

// ---------- Battle.net (cookie de sessão do site da Blizzard, como o Playnite) ----------
async function bnetGet(path: string, cookie: string) {
  const res = await fetch(`https://account.battle.net/api/${path}`, {
    headers: { Cookie: cookie, Accept: "application/json", "User-Agent": BROWSER_UA }, redirect: "manual",
  });
  const text = await res.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* página de login */ }
  if (!res.ok || !j) throw new Erro("O cookie do Battle.net venceu ou está incompleto. Copie de novo (veja as instruções) e conecte.");
  return j;
}
async function bnetConectar(body: any) {
  const cookie = String(body.codigo || "").trim().replace(/^cookie:\s*/i, "");
  if (!cookie.includes("=")) throw new Erro("Cole o valor inteiro do cabeçalho “Cookie” (tem vários nome=valor separados por ;).");
  await bnetGet("games-and-subs", cookie);
  await salvarToken("battlenet", { cookie });
  return conectada("battlenet", "Battle.net");
}
async function bnetSync(): Promise<Item[]> {
  const t = await lerToken("battlenet");
  const modern = await bnetGet("games-and-subs", t.cookie);
  let classic: any = {};
  try { classic = await bnetGet("classic-games", t.cookie); } catch { /* opcional */ }
  const list = [...(modern.gameAccounts || (Array.isArray(modern) ? modern : [])), ...(classic.classicGames || (Array.isArray(classic) ? classic : []))];
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const g of list) {
    const name = g.localizedGameName || g.titleName || g.gameAccountName;
    if (!name) continue;
    const id = String(g.titleId || name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ loja: "battlenet", id_loja: id, nome: cleanName(name), playtime: null, ultima_vez: null, adicionado: null, extra: {} });
  }
  return items;
}

// ---------- Riot Games (os jogos são gratuitos: você marca quais joga) ----------
const RIOT_JOGOS: Record<string, string> = {
  lol: "League of Legends", tft: "Teamfight Tactics", valorant: "VALORANT", lor: "Legends of Runeterra", "2xko": "2XKO",
};
async function riotConectar(body: any) {
  const jogos = (Array.isArray(body.jogos) ? body.jogos : []).filter((k: string) => RIOT_JOGOS[k]);
  if (!jogos.length) throw new Erro("Marque pelo menos um jogo da Riot.");
  await salvarToken("riot", { jogos });
  return conectada("riot", `${jogos.length} ${jogos.length === 1 ? "jogo marcado" : "jogos marcados"}`);
}
async function riotSync(): Promise<Item[]> {
  const t = await lerToken("riot");
  return (t.jogos as string[]).map((k) => ({ loja: "riot", id_loja: k, nome: RIOT_JOGOS[k], playtime: null, ultima_vez: null, adicionado: null, extra: {} }));
}

// ---------- Legacy Games (jogos ganhos de brinde, pelo e-mail; como o legacy-cli) ----------
async function legacyCatalog(email: string) {
  const res = await fetch(`https://api.legacygames.com/users/getgiveawaycatalogbyemail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: "?token?", Accept: "application/json", "Cache-Control": "no-cache" },
  });
  const j = await res.json().catch(() => ({}));
  if (j.status !== "ok") throw new Erro("A Legacy Games não achou jogos com esse e-mail. Use o e-mail da conta da Legacy Games.");
  return (j.data || []) as any[];
}
async function legacyConectar(body: any) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Erro("Digite o e-mail da conta da Legacy Games.");
  await legacyCatalog(email);
  await salvarToken("legacy", { email });
  return conectada("legacy", email);
}
async function legacySync(): Promise<Item[]> {
  const t = await lerToken("legacy");
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const product of await legacyCatalog(t.email)) {
    for (const g of product.games || []) {
      const id = String(g.game_id || g.installer_uuid || g.game_name);
      if (!g.game_name || seen.has(id)) continue;
      seen.add(id);
      items.push({ loja: "legacy", id_loja: id, nome: cleanName(g.game_name), playtime: null, ultima_vez: null, adicionado: null, extra: { cover: g.game_coverart || null } });
    }
  }
  return items;
}

// ---------- sincronizar ----------
const CONECTAR: Record<string, (b: any) => Promise<unknown>> = {
  steam: steamConectar, epic: epicConectar, gog: gogConectar, amazon: amazonConectar, xbox: xboxConectar, psn: psnConectar,
  ea: eaConectar, ubisoft: ubiConectar, battlenet: bnetConectar, riot: riotConectar, legacy: legacyConectar,
};
const SYNC: Record<string, () => Promise<Item[]>> = {
  steam: steamSync, epic: epicSync, gog: gogSync, amazon: amazonSync, xbox: xboxSync, psn: psnSync,
  ea: eaSync, ubisoft: ubiSync, battlenet: bnetSync, riot: riotSync, legacy: legacySync,
};

async function sincronizar(loja: string) {
  const items = await SYNC[loja]();
  const agora = new Date().toISOString();
  for (const part of chunks(items.map((i) => ({ ...i, visto_em: agora })), 500)) check(await admin.from("jogos_itens").upsert(part));
  check(await admin.from("jogos_itens").delete().eq("loja", loja).lt("visto_em", agora));
  await salvarLoja(loja, { sincronizado_em: agora, itens: items.length, erro: null });
  return { itens: items.length };
}

async function desconectar(loja: string) {
  check(await admin.from("jogos_tokens").delete().eq("loja", loja));
  check(await admin.from("jogos_itens").delete().eq("loja", loja));
  check(await admin.from("jogos_lojas").delete().eq("loja", loja));
  return { ok: true };
}

// ---------- metadados (GOG GamesDB: capa, fundo, resumo, gêneros, notas) ----------
// Plataforma de cada loja no GamesDB (Riot e Legacy não têm)
const GDB_PLATFORM: Record<string, string> = {
  steam: "steam", epic: "epic", gog: "gog", amazon: "amazon", xbox: "xboxone", psn: "psn", ea: "origin", ubisoft: "uplay", battlenet: "battlenet",
};
const loc = (x: any) => (x && (x["pt-BR"] || x["*"] || x["en-US"])) || "";
function textToHtml(text: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return text.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}
async function selectAll(table: string, cols: string, filter?: (q: any) => any) {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from(table).select(cols).range(from, from + 999);
    if (filter) q = filter(q);
    const rows = check(await q) as any[];
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
}
async function metadados(limite: number) {
  const items = await selectAll("jogos_itens", "loja, id_loja");
  const have = new Set((await selectAll("jogos_meta", "chave", (q) => q.like("chave", "gdb:%"))).map((r) => r.chave));
  const faltam = items.filter((i) => GDB_PLATFORM[i.loja])
    .map((i) => ({ ...i, chave: `gdb:${i.loja}:${i.id_loja}` })).filter((i) => !have.has(i.chave));
  const lote = faltam.slice(0, Math.max(1, Math.min(limite, 200)));
  const metas: { chave: string; dados: unknown }[] = [];
  const descs: { id: string; html: string; hash: string }[] = [];
  let falhas = 0;
  await pool(lote, 10, async (i) => {
    const res = await fetch(`https://gamesdb.gog.com/platforms/${GDB_PLATFORM[i.loja]}/external_releases/${encodeURIComponent(i.id_loja)}`);
    if (res.status === 404) { metas.push({ chave: i.chave, dados: {} }); return; }
    if (!res.ok) { falhas++; await res.body?.cancel(); return; }
    const r = await res.json();
    const g = r.game || {};
    const summary = loc(r.summary) || loc(g.summary);
    const dados: Record<string, unknown> = {
      gid: g.id,
      title: loc(r.title) || loc(g.title),
      genres: (g.genres || []).map((x: any) => loc(x.name)).filter(Boolean),
      modes: (g.game_modes || []).map((x: any) => x.name).filter(Boolean),
      devs: (g.developers || []).map((x: any) => x.name),
      pubs: (g.publishers || []).map((x: any) => x.name),
      date: (r.first_release_date || g.first_release_date || "").slice(0, 10) || null,
      rating: g.aggregated_rating ?? null,
      cover: g.vertical_cover?.url_format || g.cover?.url_format || null,
      bg: g.background?.url_format || g.horizontal_artwork?.url_format || null,
      desc: summary ? `gdb:${g.id}` : null,
    };
    metas.push({ chave: i.chave, dados });
    if (summary) {
      const html = textToHtml(summary);
      descs.push({ id: `gdb:${g.id}`, html, hash: hex(await sha256(html)) });
    }
  });
  const uniqDescs = [...new Map(descs.map((d) => [d.id, d])).values()];
  for (const part of chunks(uniqDescs, 100)) check(await admin.from("jogos_descricoes").upsert(part));
  for (const part of chunks(metas, 300)) check(await admin.from("jogos_meta").upsert(part));
  return { feitos: metas.length, falhas, faltam: faltam.length - metas.length };
}

// ---------- entrada ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  const user = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: papel } = await user.rpc("jogos_papel");
  if (papel !== "dono" && papel !== "editor") return json({ error: "Sem permissão para mexer nas lojas." }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "corpo inválido" }, 400); }
  const { acao, loja } = body;
  if (["conectar", "desconectar", "amazon_inicio"].includes(acao) && papel !== "dono") {
    return json({ error: "Só o dono conecta e desconecta lojas." }, 403);
  }
  if (["conectar", "desconectar", "sincronizar"].includes(acao) && !NOMES[loja]) return json({ error: "Loja desconhecida." }, 400);

  try {
    switch (acao) {
      case "amazon_inicio": return json(await amazonInicio());
      case "conectar": return json(await CONECTAR[loja](body));
      case "desconectar": return json(await desconectar(loja));
      case "sincronizar": return json(await sincronizar(loja));
      case "metadados": return json(await metadados(Number(body.limite) || 120));
      default: return json({ error: "Ação desconhecida." }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(acao, loja, msg);
    if (acao === "sincronizar") await salvarLoja(loja, { erro: msg }).catch(() => {});
    return json({ error: msg }, err instanceof Erro ? err.status : 500);
  }
});
