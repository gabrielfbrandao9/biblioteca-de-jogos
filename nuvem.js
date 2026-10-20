"use strict";
// Nuvem (Supabase): login com Google e leitura/gravação das tabelas "jogos_*".
// Quem pode ver ou atualizar é decidido no banco (tabela jogos_acesso + RLS):
// o site só esconde os botões de quem não pode.

const Nuvem = (() => {
  const cfg = window.APP_CONFIG;
  // PKCE: o retorno do Google vem em ?code=…, sem mexer no #filtros da página
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { flowType: "pkce" } });
  const PAGE = 1000;

  function check(res) {
    if (res.error) throw res.error;
    return res.data;
  }
  async function selectAll(table, cols, ...order) {
    const all = [];
    for (let from = 0; ; from += PAGE) {
      let q = client.from(table).select(cols);
      for (const o of order) q = q.order(o);
      const rows = check(await q.range(from, from + PAGE - 1));
      all.push(...rows);
      if (rows.length < PAGE) return all;
    }
  }
  function chunks(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  return {
    onAuthChange(cb) {
      client.auth.onAuthStateChange((event, session) => cb(session ? session.user : null, event));
    },
    async entrar() {
      const redirectTo = location.origin + location.pathname;
      check(await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } }));
    },
    async sair() {
      check(await client.auth.signOut());
    },
    // 'dono', 'editor', 'leitor' ou null (sem acesso)
    async papel() {
      return check(await client.rpc("jogos_papel"));
    },

    // ---------- Biblioteca ----------
    // Só a data da última atualização (para saber se o cache local ainda vale)
    async versao() {
      const row = check(await client.from("jogos_biblioteca").select("atualizado_em").eq("id", 1).maybeSingle());
      return row ? row.atualizado_em : null;
    },
    async biblioteca() {
      return check(await client.from("jogos_biblioteca").select("dados, atualizado_em").eq("id", 1).maybeSingle());
    },
    async salvarBiblioteca(dados) {
      return check(await client.from("jogos_biblioteca")
        .upsert({ id: 1, dados, atualizado_em: new Date().toISOString() })
        .select("atualizado_em").single());
    },
    // Map id -> html de várias descrições (para o backup)
    async descricoes(ids) {
      const out = new Map();
      for (const part of chunks(ids, 150)) {
        for (const r of check(await client.from("jogos_descricoes").select("id, html").in("id", part))) out.set(r.id, r.html);
      }
      return out;
    },
    async descricao(id) {
      const row = check(await client.from("jogos_descricoes").select("html").eq("id", id).maybeSingle());
      return row ? row.html : "";
    },

    // ---------- Capas da Steam ----------
    async capas() {
      const rows = await selectAll("jogos_capas", "steam_id, art", "steam_id");
      return new Map(rows.map((r) => [String(r.steam_id), r.art]));
    },
    async salvarCapas(rows) {
      for (const part of chunks(rows, 500)) check(await client.from("jogos_capas").upsert(part));
    },
    // Consulta na Steam (pela função jogos-capas) e guarda no banco; devolve {appid: art}
    async buscarCapas(ids, onBatch) {
      const found = {};
      let done = 0;
      for (const part of chunks(ids, 200)) {
        const res = check(await client.functions.invoke("jogos-capas", { body: { ids: part } }));
        await this.salvarCapas(Object.entries(res.art || {}).map(([id, art]) => ({ steam_id: Number(id), art })));
        Object.assign(found, res.art);
        onBatch?.((done += part.length));
      }
      return found;
    },

    // ---------- Lojas (Steam, Epic, GOG, Amazon) ----------
    async lojas() {
      return check(await client.from("jogos_lojas").select("*"));
    },
    // Chama a função jogos-lojas; devolve a mensagem de erro dela, não a genérica
    async lojasAcao(body) {
      const { data, error } = await client.functions.invoke("jogos-lojas", { body });
      if (error) {
        const detail = await error.context?.json?.().catch(() => null);
        throw new Error(detail?.error || error.message);
      }
      return data;
    },
    async itens() {
      return selectAll("jogos_itens", "loja, id_loja, nome, playtime, ultima_vez, adicionado, extra", "loja", "id_loja");
    },
    // Map 'gdb:<loja>:<id>' -> metadados do GOG GamesDB ('hltb:<nome>' -> tempo para zerar)
    async metas(prefixo = "gdb:") {
      const all = [];
      for (let from = 0; ; from += PAGE) {
        const rows = check(await client.from("jogos_meta").select("chave, dados").like("chave", `${prefixo}%`).order("chave").range(from, from + PAGE - 1));
        all.push(...rows);
        if (rows.length < PAGE) return new Map(all.map((r) => [r.chave, r.dados]));
      }
    },
    // ---------- Acesso (só o dono altera) ----------
    async acessos() {
      return check(await client.from("jogos_acesso").select("email, papel, nome, adicionado_em").order("adicionado_em"));
    },
    async darAcesso(row) {
      return check(await client.from("jogos_acesso").insert(row).select().single());
    },
    async mudarAcesso(email, patch) {
      return check(await client.from("jogos_acesso").update(patch).eq("email", email).select().single());
    },
    async tirarAcesso(email) {
      check(await client.from("jogos_acesso").delete().eq("email", email));
    },
  };
})();

// Guarda pequeno no IndexedDB (cache da biblioteca)
const kv = (() => {
  function run(mode, fn) {
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
  return {
    get: (key) => run("readonly", (st) => st.get(key)),
    set: (key, value) => run("readwrite", (st) => st.put(value, key)),
    del: (key) => run("readwrite", (st) => st.delete(key)),
  };
})();
