"""Converte a exportação do Playnite (extensão HTML Exporter) nos dados do site.

Uso:
    python scripts/build_data.py ["D:\\Backup\\Documentos\\HTML Exporter"]

Gera:
    data/games.json          lista resumida de todos os jogos (carregada na abertura)
    data/desc/<id>.json      descrição de cada jogo (carregada sob demanda)
"""

import html
import json
import re
import sys
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
        if art:
            game["art"] = art


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    source = Path(args[0]) if args else DEFAULT_SOURCE
    files = sorted(p for p in source.glob("*.html") if UUID_RE.match(p.stem))
    if not files:
        sys.exit(f"Nenhuma página de jogo encontrada em {source}")

    DESC_DIR.mkdir(parents=True, exist_ok=True)
    for old in DESC_DIR.glob("*.json"):
        old.unlink()

    games = []
    for path in files:
        game, description = parse_game(path)
        games.append(game)
        if description:
            game["hasDesc"] = 1
            (DESC_DIR / f"{game['id']}.json").write_text(
                json.dumps({"html": description}, ensure_ascii=False), encoding="utf-8"
            )

    attach_steam_art(games, refresh="--refresh-steam" in sys.argv)
    games.sort(key=lambda g: g["name"].casefold())
    payload = {"generated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"), "games": games}
    (DATA_DIR / "games.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"{len(games)} jogos exportados para {DATA_DIR}")


if __name__ == "__main__":
    main()
