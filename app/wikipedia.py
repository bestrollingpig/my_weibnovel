"""한국어 위키백과 API 모듈.

- 검색: action API (list=search)
- 요약: prop=extracts (exintro, explaintext)
무료·키 불필요. 5분 캐시로 서버 부하 절감.
"""

import time
from urllib.parse import quote

import httpx

WIKI_API = "https://ko.wikipedia.org/w/api.php"

WIKI_HEADERS = {"User-Agent": "WebNovelMaterialSearch/1.0 (https://material-search-d46k.onrender.com)"}

CACHE_TTL = 300.0
MAX_PER_TERM = 3
_cache: dict[str, tuple[float, list[dict]]] = {}


async def _fetch_json(client: httpx.AsyncClient, url: str) -> dict:
    resp = await client.get(url, headers=WIKI_HEADERS)
    resp.raise_for_status()
    return resp.json()


async def _search_titles(client: httpx.AsyncClient, term: str, limit: int = 3) -> list[dict]:
    resp = await _fetch_json(
        client,
        f"{WIKI_API}?action=query&format=json&list=search&srsearch={quote(term)}&srlimit={limit}&srnamespace=0",
    )
    return [
        {"title": hit["title"], "pageId": hit["pageid"]}
        for hit in resp.get("query", {}).get("search", [])
    ]


async def _fetch_extracts(client: httpx.AsyncClient, titles: list[str]) -> dict[str, str]:
    if not titles:
        return {}
    resp = await _fetch_json(
        client,
        f"{WIKI_API}?action=query&format=json&prop=extracts&exintro=1&explaintext=1&exlimit=max"
        f"&titles={quote('|'.join(titles))}",
    )
    out = {}
    for page in resp.get("query", {}).get("pages", {}).values():
        out[page.get("title", "")] = page.get("extract", "") or ""
    return out


def _summary_url(title: str) -> str:
    return f"https://ko.wikipedia.org/wiki/{quote(title.replace(' ', '_'))}"


async def search_by_terms(client: httpx.AsyncClient, terms: list[str], max_terms: int = 2) -> list[dict]:
    """검색어별 위키백과 상위 문서 요약 반환 (제목 기준 중복 제거)."""
    results = []
    seen = set()
    for term in terms[:max_terms]:
        cache_key = f"wiki:{term}"
        now = time.time()
        cached = _cache.get(cache_key)
        if cached and now - cached[0] < CACHE_TTL:
            items = cached[1]
        else:
            hits = await _search_titles(client, term)
            extracts = await _fetch_extracts(client, [h["title"] for h in hits])
            items = []
            for hit in hits:
                title = hit["title"]
                extract = extracts.get(title, "")
                if not extract:
                    continue
                items.append(
                    {
                        "newsTitle": title,
                        "newsUrl": _summary_url(title),
                        "pressName": "위키백과",
                        "writeDate": "",
                        "matchedTerms": [term],
                        "abstract": extract,
                    }
                )
            items = items[:MAX_PER_TERM]
            _cache[cache_key] = (now, items)
        for item in items:
            if item["newsUrl"] in seen:
                continue
            seen.add(item["newsUrl"])
            results.append(item)
    return results
