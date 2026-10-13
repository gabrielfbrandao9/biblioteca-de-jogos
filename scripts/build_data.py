"""Converte a exportação do Playnite (extensão HTML Exporter) nos dados do site.

Uso:
    python scripts/build_data.py ["D:\\Backup\\Documentos\\HTML Exporter"]

Gera:
    data/games.json          lista resumida de todos os jogos (carregada na abertura)
    data/desc/<id>.json      descrição de cada jogo (carregada sob demanda)

Jogos com o mesmo nome em várias lojas viram um único registro, com a lista
de lojas em "stores" e os dados de cada cópia em "copies".

As capas vêm da CDN da Steam. Os caminhos das imagens são consultados na API
pública da loja e guardados em scripts/steam_cache.json, então só jogos novos
geram consultas. Opções:
    --refresh-steam   consulta todas as capas de novo
    --fix-art         só completa as capas que faltam em data/games.json
                      (usado pela GitHub Action após o botão "Atualizar" do site)
"""

import html
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

DEFAULT_SOURCE = Path(r"D:\Backup\Documentos\HTML Exporter")
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DESC_DIR = DATA_DIR / "desc"
STEAM_CACHE = Path(__file__).resolve().parent / "steam_cache.json"
STEAM_API = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1"
STEAM_BATCH = 50
# Chave do asset na API da Steam -> chave no JSON do jogo
# Campos de cada cópia (loja) de um jogo; o resto é do jogo em si
COPY_FIELDS = ("id", "source", "library", "platforms", "status", "playtime", "lastActivity", "added")
UNION_FIELDS = ("platforms", "genres", "developers", "publishers", "features", "tags")
STEAM_ASSETS = {
    "library_capsule": "cover",
    "library_capsule_2x": "cover2x",
    "header": "header",
    "library_hero": "hero",
}

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
ROW_RE = re.compile(r"<TR>\s*<TD>(.*?)</TD>\s*<TD>(.*?)</TD>\s*</TR>", re.S)
LINK_RE = re.compile(r'<a href="([^"]*)"[^>]*>(.*?)</a>', re.S)
TAG_RE = re.compile(r"<[^>]+>")
DESC_RE = re.compile(
    r'<div class="description">(.*?)</div>\s*</div>\s*</div>\s*</body>', re.S
)
STEAM_RE = re.compile(r"store\.steampowered\.com/app/(\d+)")
DURATION_RE = re.compile(r"(\d+)\s*([dhms])")

# Rótulo na exportação (pt-BR) -> chave no JSON
FIELDS = {
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
}
LIST_FIELDS = {"platforms", "genres", "developers", "publishers", "features", "tags"}
SCORE_FIELDS = {"communityScore", "criticScore", "userScore"}
DATE_FIELDS = {"lastActivity", "added", "modified", "releaseDate"}
STATUS_PT = {"Not Played": "Não jogado", "Played": "Jogado", "Jogado": "Jogado"}
DURATION_SECONDS = {"d": 86400, "h": 3600, "m": 60, "s": 1}


def text(fragment):
    return html.unescape(TAG_RE.sub("", fragment)).strip()


def parse_date(value):
    """'28/01/2021 19:12:46' -> '2021-01-28T19:12:46'; 'Nunca' -> None."""
    for fmt, out in (("%d/%m/%Y %H:%M:%S", "%Y-%m-%dT%H:%M:%S"), ("%d/%m/%Y", "%Y-%m-%d")):
        try:
            return datetime.strptime(value, fmt).strftime(out)
        except ValueError:
            pass
    return None


def parse_duration(value):
    """'1d 2h 5m 0s' -> segundos; 'Não Jogado' -> 0."""
    return sum(int(n) * DURATION_SECONDS[u] for n, u in DURATION_RE.findall(value))


def parse_game(path):
    raw = path.read_text(encoding="utf-8-sig")
    game = {"id": path.stem, "name": text(TITLE_RE.search(raw).group(1))}

    for label, cell in ROW_RE.findall(raw):
        key = FIELDS.get(text(label))
        if not key:
            continue
        if key == "links":
            game[key] = [
                {"name": text(name), "url": html.unescape(url)}
                for url, name in LINK_RE.findall(cell)
            ]
        elif key in LIST_FIELDS:
            game[key] = [v for v in (text(n) for _, n in LINK_RE.findall(cell)) if v]
        elif key == "playtime":
            game[key] = parse_duration(text(cell))
        elif key in SCORE_FIELDS:
            value = text(cell)
            game[key] = int(value) if value.isdigit() else None
        elif key in DATE_FIELDS:
            game[key] = parse_date(text(cell))
        elif key == "status":
            value = text(cell)
            game[key] = STATUS_PT.get(value, value)
        else:
            game[key] = text(cell) or None

    steam = next((m.group(1) for l in game.get("links", []) if (m := STEAM_RE.search(l["url"]))), None)
    if steam:
        game["steamId"] = int(steam)

    desc = DESC_RE.search(raw)
    description = desc.group(1).strip() if desc else ""

    # Remove chaves vazias para deixar o JSON enxuto
    game = {k: v for k, v in game.items() if v not in (None, [], "")}
    return game, description


def fetch_steam_assets(appids):
    """Consulta a loja da Steam em lotes; devolve {appid: {cover, cover2x, header, hero}}."""
    result = {}
    for start in range(0, len(appids), STEAM_BATCH):
        batch = appids[start:start + STEAM_BATCH]
        query = {
            "ids": [{"appid": a} for a in batch],
            "context": {"language": "brazilian", "country_code": "BR"},
            "data_request": {"include_assets": True},
        }
        url = STEAM_API + "?" + urllib.parse.urlencode({"input_json": json.dumps(query)})
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                items = json.load(resp)["response"].get("store_items", [])
        except Exception as exc:  # rede fora do ar: tenta de novo na próxima execução
            print(f"  aviso: falha ao consultar a Steam ({exc})")
            continue
        for item in items:
            appid = item.get("appid") or item.get("id")
            assets = item.get("assets") or {}
            fmt = assets.get("asset_url_format")
            art = {}
            if fmt:
                for src, dst in STEAM_ASSETS.items():
                    if assets.get(src):
                        art[dst] = fmt.replace("${FILENAME}", assets[src])
            result[str(appid)] = art
        print(f"  Steam: {min(start + STEAM_BATCH, len(appids))}/{len(appids)}")
    return result


def attach_steam_art(games, refresh):
    cache = {}
    if STEAM_CACHE.exists() and not refresh:
        cache = json.loads(STEAM_CACHE.read_text(encoding="utf-8"))
    missing = sorted({g["steamId"] for g in games if "steamId" in g and str(g["steamId"]) not in cache})
    if missing:
        print(f"Consultando capas de {len(missing)} jogos na Steam...")
        cache.update(fetch_steam_assets(missing))
        STEAM_CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True), encoding="utf-8")
    for game in games:
        art = cache.get(str(game.get("steamId")))
        if art and "art" not in game:
            game["art"] = art


def fix_art_only():
    """Completa as capas de data/games.json sem reler a exportação.

    Usado pela GitHub Action depois de uma atualização feita pelo botão do site,
    que não consegue consultar a API da Steam direto do navegador.
    """
    path = DATA_DIR / "games.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    before = sum("art" in g for g in payload["games"])
    attach_steam_art(payload["games"], refresh=False)
    added = sum("art" in g for g in payload["games"]) - before
    if added:
        path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{added} capas adicionadas")


def merge_key(name):
    """Nome normalizado: ignora maiúsculas, acentos, ™/®, apóstrofos e pontuação."""
    name = re.sub(r"['’`´]", "", name)
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", name).strip()


def richness(game, descriptions):
    """Qual cópia tem os melhores metadados (capa, descrição, campos preenchidos)."""
    return ("art" in game, len(descriptions.get(game["id"], "")), len(game))


def merge_duplicates(games, descriptions):
    """Junta jogos com o mesmo nome (cópias em lojas diferentes) num único registro."""
    groups = {}
    for game in games:
        groups.setdefault(merge_key(game["name"]), []).append(game)

    merged = []
    for copies in groups.values():
        copies.sort(key=lambda g: richness(g, descriptions), reverse=True)
        best = copies[0]
        game = {k: v for k, v in best.items() if k not in COPY_FIELDS}
        game["id"] = best["id"]
        game["stores"] = sorted({c.get("source") or "Outros" for c in copies})
        game["status"] = "Jogado" if any(c.get("status") == "Jogado" for c in copies) else best.get("status")
        game["playtime"] = sum(c.get("playtime", 0) for c in copies)
        for key, pick in (("lastActivity", max), ("added", min), ("modified", max)):
            values = [c[key] for c in copies if c.get(key)]
            if values:
                game[key] = pick(values)
        for key in UNION_FIELDS:
            values = list(dict.fromkeys(v for c in copies for v in c.get(key, [])))
            if values:
                game[key] = values
        for key in ("releaseDate", "criticScore", "communityScore", "userScore", "steamId", "art"):
            value = next((c[key] for c in copies if c.get(key) is not None), None)
            if value is not None:
                game[key] = value
        links = {}
        for c in copies:
            for link in c.get("links", []):
                links.setdefault(link["url"], link)
        if links:
            game["links"] = list(links.values())
        desc_id = max((c["id"] for c in copies), key=lambda i: len(descriptions.get(i, "")))
        if descriptions.get(desc_id):
            game["hasDesc"] = 1
            game["descId"] = desc_id
        else:
            game.pop("hasDesc", None)
        if len(copies) > 1:
            game["copies"] = [
                {k: c[k] for k in COPY_FIELDS if c.get(k) not in (None, [], "")}
                for c in sorted(copies, key=lambda c: (c.get("source") or "", c["id"]))
            ]
        merged.append(game)
    return merged


def main():
    if "--fix-art" in sys.argv:
        return fix_art_only()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    source = Path(args[0]) if args else DEFAULT_SOURCE
    files = sorted(p for p in source.glob("*.html") if UUID_RE.match(p.stem))
    if not files:
        sys.exit(f"Nenhuma página de jogo encontrada em {source}")

    DESC_DIR.mkdir(parents=True, exist_ok=True)
    for old in DESC_DIR.glob("*.json"):
        old.unlink()

    games, descriptions = [], {}
    for path in files:
        game, description = parse_game(path)
        games.append(game)
        if description:
            descriptions[game["id"]] = description

    attach_steam_art(games, refresh="--refresh-steam" in sys.argv)
    total = len(games)
    games = merge_duplicates(games, descriptions)
    for game in games:
        desc_id = game.pop("descId", None)
        if desc_id:
            (DESC_DIR / f"{game['id']}.json").write_text(
                json.dumps({"html": descriptions[desc_id]}, ensure_ascii=False), encoding="utf-8"
            )
    games.sort(key=lambda g: g["name"].casefold())
    payload = {"generated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "games": games}
    (DATA_DIR / "games.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"{len(games)} jogos ({total - len(games)} cópias repetidas juntadas) exportados para {DATA_DIR}")


if __name__ == "__main__":
    main()
