import time
import xml.etree.ElementTree as ET
from urllib.parse import quote

import httpx

GOOGLE_NEWS_URL = "https://news.google.com/rss/search"

CACHE_TTL = 300.0
MAX_PER_TERM = 30
_cache: dict[str, tuple[float, list[dict]]] = {}


async def _fetch_rss(client: httpx.AsyncClient, url: str) -> list[dict]:
    resp = await client.get(url)
    resp.raise_for_status()
    root = ET.fromstring(resp.text)
    items = []
    for item in root.findall(".//item"):
        items.append(
            {
                "newsTitle": item.findtext("title") or "",
                "newsUrl": item.findtext("link") or "",
                "pressName": (item.findtext("source") or "Google뉴스").strip(),
                "writeDate": item.findtext("pubDate") or "",
            }
        )
    return items


async def search_by_terms(client: httpx.AsyncClient, terms: list[str], max_terms: int = 3) -> list[dict]:
    results = []
    seen = set()
    for term in terms[:max_terms]:
        cache_key = f"rss:{term}"
        now = time.time()
        cached = _cache.get(cache_key)
        if cached and now - cached[0] < CACHE_TTL:
            items = cached[1]
        else:
            url = (
                f"{GOOGLE_NEWS_URL}?q={quote(f'\"{term}\"')}"
                "&hl=ko&gl=KR&ceid=KR:ko"
            )
            items = await _fetch_rss(client, url)
            items = items[:MAX_PER_TERM]
            _cache[cache_key] = (now, items)
        for item in items:
            if item["newsUrl"] in seen:
                continue
            seen.add(item["newsUrl"])
            results.append({**item, "matchedTerms": [term]})
    return results