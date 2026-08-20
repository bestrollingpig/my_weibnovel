"""트렌드 스냅샷 분석: 순위 상승작·신규 진입·제목 키워드 빈도."""
import json
import re
from collections import Counter
from pathlib import Path

TRENDS_DIR = Path(__file__).resolve().parent.parent / "trends"

STOPWORDS = {
    "독점", "시리즈", "시즌", "전권", "리턴즈", "외전", "연재", "완결", "추천",
    "bestseller", "TOP", "top", "best",
}


def _load_all() -> list[dict]:
    out = []
    for f in sorted(TRENDS_DIR.glob("trends_*.json")):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def _items(snap: dict | None) -> list[dict]:
    if not snap:
        return []
    return snap.get("data", {}).get("naver_series_top100", [])


def _title_tokens(title: str) -> list[str]:
    cleaned = re.sub(r"[\[\]\(\)「」]", " ", title)
    tokens = []
    for m in re.findall(r"[\uac00-\ud7a3A-Za-z0-9]{2,}", cleaned):
        low = m.lower()
        if low in STOPWORDS:
            continue
        if not re.search(r"[\uac00-\ud7a3]", m) and not re.search(r"[A-Za-z]", m):
            continue
        tokens.append(m)
    return tokens


def analyze(days: int = 7) -> dict | None:
    snaps = _load_all()[-days:]
    if not snaps:
        return None

    latest = snaps[-1]
    prev = snaps[-2] if len(snaps) >= 2 else None
    items = _items(latest)
    prev_items = _items(prev)
    prev_by_no = {it.get("product_no"): it for it in prev_items}
    latest_by_no = {it.get("product_no"): it for it in items}

    risers, fallers = [], []
    if prev:
        for no, it in latest_by_no.items():
            old = prev_by_no.get(no)
            if old is None or not old.get("rank") or not it.get("rank"):
                continue
            delta = old["rank"] - it["rank"]
            entry = {
                "title": it.get("title", ""),
                "author": it.get("author", ""),
                "score": it.get("score"),
                "now_rank": it["rank"],
                "prev_rank": old["rank"],
                "delta": abs(delta),
            }
            if delta > 0:
                risers.append(entry)
            elif delta < 0:
                fallers.append(entry)
        risers.sort(key=lambda r: r["delta"], reverse=True)
        fallers.sort(key=lambda f: f["delta"], reverse=True)

    new_entries = [
        it for no, it in latest_by_no.items() if prev is None or no not in prev_by_no
    ]

    counter = Counter()
    for it in items:
        for tok in _title_tokens(it.get("title", "")):
            counter[tok] += 1
    keywords = counter.most_common(15)

    return {
        "latest_date": latest.get("collected_at", "")[:10],
        "prev_date": prev.get("collected_at", "")[:10] if prev else "",
        "snapshot_count": len(snaps),
        "total_items": len(items),
        "risers": risers[:10],
        "fallers": fallers[:10],
        "new_entries": new_entries[:10],
        "keywords": [{"word": w, "count": c} for w, c in keywords],
        "latest_titles": [{"rank": it.get("rank"), "title": it.get("title", ""), "author": it.get("author", ""), "score": it.get("score")} for it in items],
    }