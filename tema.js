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

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
