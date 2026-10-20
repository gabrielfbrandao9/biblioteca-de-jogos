"use strict";
// Backup: baixa a biblioteca carregada em JSON (completo, com descrições), CSV (planilha) ou HTML (página para ler).

const Backup = (() => {
  const hoje = () => new Date().toISOString().slice(0, 10);
  const lista = () => games.map(({ _text, ...g }) => g);
  const horas = (sec) => (sec ? (sec / 3600).toFixed(1).replace(".", ",") : "");
  const data = (iso) => (iso ? fmtDate(iso) : "");
  const juntar = (v) => (Array.isArray(v) ? v.join(", ") : v ?? "");

  function baixar(nome, tipo, conteudo) {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = Object.assign(document.createElement("a"), { href: url, download: nome });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Colunas da planilha e da página
  const COLUNAS = [
    ["Nome", (g) => g.name],
    ["Lojas", (g) => juntar(g.stores)],
    ["Status", (g) => g.status || ""],
    ["Horas jogadas", (g) => horas(g.playtime)],
    ["Horas para zerar", (g) => horas(g.hltb?.main)],
    ["Horas para 100%", (g) => horas(g.hltb?.full)],
    ["Última atividade", (g) => data(g.lastActivity)],
    ["Adicionado", (g) => data(g.added)],
    ["Lançamento", (g) => data(g.releaseDate)],
    ["Gêneros", (g) => juntar((g.genres || []).map((v) => GENRES[v] || v))],
    ["Modos de jogo", (g) => juntar((g.features || []).map((v) => FEATURES[v] || v))],
    ["Desenvolvedor", (g) => juntar(g.developers)],
    ["Editora", (g) => juntar(g.publishers)],
    ["Plataformas", (g) => juntar(g.platforms)],
    ["Nota da crítica", (g) => g.criticScore ?? ""],
    ["Cópias", (g) => juntar((g.copies || []).map((c) => `${c.source}${c.playtime ? ` (${horas(c.playtime)} h)` : ""}`))],
    ["Links", (g) => juntar((g.links || []).map((l) => l.url))],
  ];

  async function json(progresso) {
    const jogos = lista();
    // Descrições ficam em outra tabela: entram no backup para ele ser completo
    const ids = [...new Set(jogos.filter((g) => g.hasDesc).map((g) => g.descId || g.id))];
    progresso?.(`Baixando ${nf.format(ids.length)} descrições…`);
    const descricoes = await Nuvem.descricoes(ids);
    const saida = { exportado_em: new Date().toISOString(), total: jogos.length, jogos, descricoes: Object.fromEntries(descricoes) };
    baixar(`biblioteca-de-jogos-${hoje()}.json`, "application/json", JSON.stringify(saida, null, 1));
  }

  function csv() {
    const cel = (v) => {
      const s = String(v ?? "");
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // Ponto e vírgula e BOM: o Excel em português abre direto, com acentos
    const linhas = [COLUNAS.map(([t]) => t), ...lista().map((g) => COLUNAS.map(([, f]) => f(g)))];
    baixar(`biblioteca-de-jogos-${hoje()}.csv`, "text/csv;charset=utf-8", "﻿" + linhas.map((l) => l.map(cel).join(";")).join("\r\n"));
  }

  function html() {
    const jogos = lista();
    const capa = (g) => {
      const src = g.art?.cover || g.art?.header;
      return src ? `<img src="${esc(imgUrl(src))}" alt="" loading="lazy">` : "";
    };
    const linhas = jogos.map((g) => `<tr><td class="c">${capa(g)}</td>${COLUNAS.map(([t, f], i) => {
      const v = f(g);
      if (t === "Links") return `<td>${(g.links || []).map((l) => `<a href="${esc(l.url)}">${esc(linkName(l))}</a>`).join(" ")}</td>`;
      return i === 0 ? `<th>${esc(v)}</th>` : `<td>${esc(v)}</td>`;
    }).join("")}</tr>`).join("\n");
    const pagina = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Biblioteca de Jogos — ${fmtDate(hoje())}</title>
<style>
  :root { color-scheme: light dark; --line: #8884; }
  body { margin: 24px; font: 14px/1.4 system-ui, sans-serif; }
  h1 { margin: 0 0 4px; } p { margin: 0 0 16px; opacity: .7; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  thead th { position: sticky; top: 0; background: Canvas; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  tbody th { font-weight: 600; min-width: 180px; }
  td.c img { width: 48px; aspect-ratio: 2/3; object-fit: cover; border-radius: 4px; display: block; }
  td a { margin-right: 6px; }
  @media print { td.c { display: none; } }
</style></head><body>
<h1>Biblioteca de Jogos</h1>
<p>${nf.format(jogos.length)} jogos · exportado em ${fmtDate(hoje())}</p>
<table><thead><tr><th></th>${COLUNAS.map(([t]) => `<th>${esc(t)}</th>`).join("")}</tr></thead>
<tbody>
${linhas}
</tbody></table>
</body></html>`;
    baixar(`biblioteca-de-jogos-${hoje()}.html`, "text/html;charset=utf-8", pagina);
  }

  return { json, csv, html };
})();
