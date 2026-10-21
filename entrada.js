"use strict";
// Entrada: login com Google, quem tem acesso, cache local da biblioteca e tela "Conta".

let user = null;
let papel = null;

const PAPEIS = { dono: "Dono", editor: "Pode atualizar", leitor: "Só ver" };
const GOOGLE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:initial;stroke:none"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.8l4-3z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>`;

const cacheKey = () => `cache:${user.id}`;

function showGate(kind, extra) {
  document.getElementById("app").hidden = true;
  document.getElementById("gate").hidden = false;
  const body = document.getElementById("gate-body");
  if (kind === "login") {
    body.innerHTML = `<p class="muted">Entre com a conta Google que recebeu acesso.</p>
      <button type="button" class="btn google" id="g-google">${GOOGLE_ICON} Entrar com Google</button>
      <p class="gate-msg" id="g-msg"></p>`;
    document.getElementById("g-google").addEventListener("click", async () => {
      document.getElementById("g-msg").textContent = "Abrindo o Google…";
      try { await Nuvem.entrar(); } catch (err) { document.getElementById("g-msg").textContent = `Não foi possível entrar: ${err.message}`; }
    });
  } else if (kind === "noaccess") {
    body.innerHTML = `<p>A conta <b>${esc(user.email)}</b> ainda não tem acesso.</p>
      <p class="muted">Peça para ${esc(APP_CONFIG.donoNome || "o dono")} liberar este e-mail e depois clique em “Tentar de novo”.</p>
      <div class="gate-actions"><button type="button" class="btn accent" id="g-retry">Tentar de novo</button>
      <button type="button" class="btn" id="g-out">Usar outra conta</button></div>`;
    document.getElementById("g-retry").addEventListener("click", start);
    document.getElementById("g-out").addEventListener("click", logout);
  } else if (kind === "error") {
    body.innerHTML = `<p>Não foi possível carregar a biblioteca.</p><p class="muted small">${esc(extra || "")}</p>
      <div class="gate-actions"><button type="button" class="btn accent" id="g-retry">Tentar de novo</button>
      <button type="button" class="btn" id="g-out">Sair</button></div>`;
    document.getElementById("g-retry").addEventListener("click", start);
    document.getElementById("g-out").addEventListener("click", logout);
  } else {
    body.innerHTML = `<p class="muted">${esc(extra || "Carregando…")}</p>`;
  }
}

function showApp() {
  document.getElementById("gate").hidden = true;
  document.getElementById("app").hidden = false;
  const podeAtualizar = papel === "dono" || papel === "editor";
  document.getElementById("update-btn").hidden = !podeAtualizar;
  document.body.classList.toggle("can-update", podeAtualizar);
  const avatar = user.user_metadata?.avatar_url;
  document.getElementById("account").innerHTML = avatar
    ? `<img src="${esc(avatar)}" alt="" referrerpolicy="no-referrer">`
    : `<span>${esc((user.email || "?")[0].toUpperCase())}</span>`;
}

let starting = false;
async function start() {
  if (!user || starting) return;
  starting = true;
  showGate("loading");
  try {
    papel = await Nuvem.papel();
    if (!papel) {
      await kv.del(cacheKey());
      showGate("noaccess");
      return;
    }
    Nuvem.registrarAcesso().catch((err) => console.warn("Último acesso:", err));
    // A lista tem ~2 MB: só baixa de novo se mudou desde a última visita
    const versao = await Nuvem.versao();
    const cache = await kv.get(cacheKey());
    let data = null;
    if (versao && cache?.at === versao) data = cache.dados;
    else if (versao) {
      showGate("loading", "Baixando a biblioteca…");
      const row = await Nuvem.biblioteca();
      data = row.dados;
      await kv.set(cacheKey(), { at: row.atualizado_em, dados: data });
    }
    showApp();
    startLibrary(data);
  } catch (err) {
    showGate("error", err?.message);
  } finally {
    starting = false;
  }
}

// Chamado pelo updater.js depois de publicar
function onPublished(payload, at) {
  kv.set(cacheKey(), { at, dados: payload });
  setData(payload);
}

async function logout() {
  if (user) await kv.del(cacheKey());
  try { await Nuvem.sair(); } catch (err) { alert(`Erro ao sair: ${err.message}`); }
}

let authKnown = false;
Nuvem.onAuthChange((u) => {
  if (authKnown && (u?.id) === (user?.id)) return; // renovação do login: nada mudou
  authKnown = true;
  user = u;
  if (!u) {
    papel = null;
    document.getElementById("conta").close();
    showGate("login");
    return;
  }
  // Fora do callback do Supabase (chamar o banco dentro dele pode travar)
  setTimeout(start, 0);
});

// ---------- Conta e acesso ----------
(() => {
  const dlg = document.getElementById("conta");
  const $c = (id) => document.getElementById(id);
  let acessos = [];

  function status(text, kind = "") { $c("c-status").textContent = text; $c("c-status").className = `u-status ${kind}`; }
  function renderList() {
    $c("c-list").innerHTML = acessos.map((a) => `<li>
        <span class="c-who"><b>${esc(a.nome || a.email)}</b>${a.nome ? `<small>${esc(a.email)}</small>` : ""}
          <small class="c-seen">${a.ultimo_acesso ? `Último acesso: ${esc(new Date(a.ultimo_acesso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}` : "Ainda não entrou"}</small></span>
        ${a.papel === "dono" ? `<span class="c-role">Dono</span>` : `
        <select data-email="${esc(a.email)}" aria-label="Permissão de ${esc(a.email)}">
          ${["leitor", "editor"].map((p) => `<option value="${p}"${a.papel === p ? " selected" : ""}>${PAPEIS[p]}</option>`).join("")}
        </select>
        <button type="button" class="link danger" data-remove="${esc(a.email)}">Remover</button>`}
      </li>`).join("");
  }
  function errMsg(err) {
    if (err?.code === "23505") return "Este e-mail já tem acesso.";
    if (err?.code === "23514") return "E-mail inválido.";
    return err?.message || String(err);
  }

  $c("account").addEventListener("click", async () => {
    $c("c-user").innerHTML = `<b>${esc(user.user_metadata?.full_name || user.email)}</b>
      <small>${esc(user.email)} · ${PAPEIS[papel] || ""}</small>`;
    $c("c-acesso").hidden = papel !== "dono";
    status("");
    dlg.showModal();
    if (papel !== "dono") return;
    $c("c-list").innerHTML = `<li class="muted">Carregando…</li>`;
    try { acessos = await Nuvem.acessos(); renderList(); } catch (err) { status(errMsg(err), "err"); }
  });
  $c("c-close").addEventListener("click", () => dlg.close());

  dlg.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-backup]");
    if (!btn) return;
    const msg = (text, kind = "") => { $c("c-backup-status").textContent = text; $c("c-backup-status").className = `u-status ${kind}`; };
    if (!games.length) return msg("A biblioteca está vazia: nada para baixar.", "err");
    btn.disabled = true;
    try {
      await Backup[btn.dataset.backup](msg);
      msg(`Backup em ${btn.dataset.backup.toUpperCase()} baixado (${nf.format(games.length)} jogos).`, "ok");
    } catch (err) {
      msg(`Não foi possível gerar o backup: ${err.message}`, "err");
    } finally {
      btn.disabled = false;
    }
  });
  $c("c-restore").addEventListener("change", async (e) => {
    const arquivo = e.target.files[0];
    e.target.value = "";
    if (!arquivo) return;
    const msg = (text, kind = "") => { $c("c-backup-status").textContent = text; $c("c-backup-status").className = `u-status ${kind}`; };
    try {
      await Backup.restaurar(arquivo, msg);
    } catch (err) {
      msg(`Não foi possível restaurar: ${err.message}`, "err");
    }
  });
  $c("c-sair").addEventListener("click", () => { dlg.close(); logout(); });

  $c("c-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { email: $c("c-email").value.trim().toLowerCase(), nome: $c("c-nome").value.trim(), papel: $c("c-papel").value };
    status("Salvando…");
    try {
      acessos.push(await Nuvem.darAcesso(row));
      renderList();
      $c("c-form").reset();
      status(`Pronto: ${row.email} já pode entrar em ${location.origin + location.pathname}`, "ok");
    } catch (err) { status(errMsg(err), "err"); }
  });
  $c("c-list").addEventListener("change", async (e) => {
    const sel = e.target.closest("select[data-email]");
    if (!sel) return;
    try {
      const r = await Nuvem.mudarAcesso(sel.dataset.email, { papel: sel.value });
      acessos = acessos.map((a) => (a.email === r.email ? r : a));
      status("Permissão alterada.", "ok");
    } catch (err) { status(errMsg(err), "err"); renderList(); }
  });
  $c("c-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    const email = btn.dataset.remove;
    if (!confirm(`Tirar o acesso de ${email}?`)) return;
    try {
      await Nuvem.tirarAcesso(email);
      acessos = acessos.filter((a) => a.email !== email);
      renderList();
      status("Acesso removido.", "ok");
    } catch (err) { status(errMsg(err), "err"); }
  });
})();
