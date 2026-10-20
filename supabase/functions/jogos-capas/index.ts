// Biblioteca de Jogos: consulta na Steam os caminhos das capas de uma lista de appids.
// O navegador não pode chamar a API da Steam (CORS), então o botão "Atualizar" passa por aqui.
// Só quem pode atualizar a biblioteca (jogos_acesso: dono ou editor) consegue usar.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const STEAM_API = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1";
const BATCH = 50;
const MAX_IDS = 500;
const ASSETS: Record<string, string> = {
  library_capsule: "cover",
  library_capsule_2x: "cover2x",
  header: "header",
  library_hero: "hero",
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: pode, error } = await sb.rpc("jogos_pode_atualizar");
  if (error || !pode) return json({ error: "Sem permissão para atualizar a biblioteca." }, 403);

  let ids: number[] = [];
  try {
    const body = await req.json();
    ids = [...new Set((body.ids ?? []).map(Number))].filter((n) => Number.isInteger(n) && n > 0) as number[];
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }
  ids = ids.slice(0, MAX_IDS);

  const result: Record<string, Record<string, string>> = {};
  const failed: number[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const query = {
      ids: batch.map((appid) => ({ appid })),
      context: { language: "brazilian", country_code: "BR" },
      data_request: { include_assets: true },
    };
    try {
      const res = await fetch(`${STEAM_API}?input_json=${encodeURIComponent(JSON.stringify(query))}`);
      if (!res.ok) throw new Error(String(res.status));
      const items = (await res.json()).response?.store_items ?? [];
      for (const item of items) {
        const appid = item.appid ?? item.id;
        const assets = item.assets ?? {};
        const fmt = assets.asset_url_format;
        const art: Record<string, string> = {};
        if (fmt) for (const [src, dst] of Object.entries(ASSETS)) if (assets[src]) art[dst] = fmt.replace("${FILENAME}", assets[src]);
        result[String(appid)] = art;
      }
      // Jogo que a Steam não devolveu: fica sem capa (não consulta de novo)
      for (const a of batch) if (!(String(a) in result)) result[String(a)] = {};
    } catch {
      failed.push(...batch); // rede fora do ar: tenta de novo na próxima atualização
    }
  }
  return json({ art: result, failed });
});
