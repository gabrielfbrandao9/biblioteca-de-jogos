"use strict";
// Tema claro/escuro (o padrão segue o aparelho), botão "Instalar app" e app sem internet (sw.js).

(() => {
  const CHAVE = "jogos:tema";
  const root = document.documentElement;
  const sistemaEscuro = matchMedia("(prefers-color-scheme: dark)");
  const atual = () => root.dataset.theme || (sistemaEscuro.matches ? "dark" : "light");

  function mostrar() {
    const escuro = atual() === "dark";
    root.classList.toggle("escuro", escuro);
    root.classList.toggle("claro", !escuro);
    const txt = escuro ? "Mudar para o tema claro" : "Mudar para o tema escuro";
    document.querySelectorAll(".theme-btn").forEach((b) => { b.setAttribute("aria-label", txt); b.title = txt; });
    document.querySelector('meta[name="theme-color"]').content = escuro ? "#0b0d12" : "#f4f2ec";
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-btn")) return;
    const novo = atual() === "dark" ? "light" : "dark";
    root.dataset.theme = novo;
    try { localStorage.setItem(CHAVE, novo); } catch {}
    mostrar();
  });
  sistemaEscuro.addEventListener("change", mostrar);
  mostrar();

  // Instalar como app (Chrome/Android/computador)
  let pedido = null;
  const botoes = () => document.querySelectorAll("[data-instalar]");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pedido = e;
    botoes().forEach((b) => { b.hidden = false; });
  });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-instalar]") || !pedido) return;
    pedido.prompt();
    await pedido.userChoice.catch(() => null);
    pedido = null;
    botoes().forEach((b) => { b.hidden = true; });
  });
  window.addEventListener("appinstalled", () => botoes().forEach((b) => { b.hidden = true; }));

  // Tamanho das capas: botões − e + (e as teclas − e +), guardado neste aparelho
  const ESCALAS = [0.65, 0.8, 1, 1.2, 1.45, 1.75];
  const CHAVE_CAPA = "jogos:capa";
  let nivel = 2;
  try { const n = Number(localStorage.getItem(CHAVE_CAPA)); if (Number.isInteger(n) && n >= 0 && n < ESCALAS.length) nivel = n; } catch {}
  function aplicarCapa() {
    const grade = document.getElementById("grid");
    if (grade) {
      grade.style.setProperty("--escala", ESCALAS[nivel]);
      grade.classList.toggle("mini", nivel < 2);
    }
    const menos = document.getElementById("capa-menos"), mais = document.getElementById("capa-mais");
    if (menos) menos.disabled = nivel === 0;
    if (mais) mais.disabled = nivel === ESCALAS.length - 1;
  }
  function mudarCapa(d) {
    const novo = Math.max(0, Math.min(ESCALAS.length - 1, nivel + d));
    if (novo === nivel) return;
    nivel = novo;
    try { localStorage.setItem(CHAVE_CAPA, String(nivel)); } catch {}
    aplicarCapa();
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#capa-menos")) mudarCapa(-1);
    else if (e.target.closest("#capa-mais")) mudarCapa(1);
  });
  document.addEventListener("keydown", (e) => {
    const alvo = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
    if (e.key === "+" || e.key === "=") mudarCapa(1);
    else if (e.key === "-" || e.key === "_") mudarCapa(-1);
  });
  aplicarCapa();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
