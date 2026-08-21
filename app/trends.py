"""트렌드 스냅샷 분석: 순위 상승작·신규 진입·제목 키워드 빈도 (TOP20 + 장르별 리스트)."""
import json
import re
from collections import Counter
from pathlib import Path

TRENDS_DIR = Path(__file__).resolve().parent.parent / "trends"

STOPWORDS = {
    "독점", "시리즈", "시즌", "전권", "리턴즈", "외전", "연재", "완결", "추천",
    "bestseller", "TOP", "top", "best", "세트", "판매", "1권", "2권", "3권",
    "단행본", "개정판", "신간", "무삭제", "완전판", "특별판", "개정증보판",
}


def _load_all() -> list[dict]:
    out = []
    for f in sorted(TRENDS_DIR.glob("trends_*.json")):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    return out


def _all_items(snap: dict | None, source: str | None = None) -> list[dict]:
    if not snap:
        return []
    out = []
    for key, lst in (snap.get("data") or {}).items():
        if source and key != source:
            continue
        if isinstance(lst, list):
            out.extend(lst)
    return out


def _ranked_items(snap: dict | None, source: str | None = None) -> list[dict]:
    items = _all_items(snap, source)
    return [it for it in items if isinstance(it.get("rank"), int) and it["rank"] >= 1]


def _source_options(snap: dict | None) -> list[dict]:
    """스냅샷에 수집된 소스 목록 (플랫폼·리스트 라벨 포함)."""
    if not snap:
        return []
    out = []
    for key, lst in (snap.get("data") or {}).items():
        if isinstance(lst, list) and lst and isinstance(lst[0], dict):
            platform = lst[0].get("platform") or key
            name = lst[0].get("list") or key
            out.append({"key": key, "label": f"{platform} · {name}", "count": len(lst)})
    return out


def _unique_items(items: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for it in items:
        key = it.get("product_no") or it.get("title")
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def _title_tokens(title: str) -> list[str]:
    cleaned = re.sub(r"[\[\]\(\)「」]", " ", title or "")
    tokens = []
    for m in re.findall(r"[\uac00-\ud7a3A-Za-z0-9]{2,}", cleaned):
        low = m.lower()
        if low in STOPWORDS:
            continue
        if re.fullmatch(r"\d+[화권]?", m):
            continue
        if not re.search(r"[\uac00-\ud7a3]", m) and not re.search(r"[A-Za-z]", m):
            continue
        tokens.append(m)
    return tokens


def _rank_weight(rank) -> int | None:
    """순위 가중치: 31−순위 (30위 이내만, 참고 구현과 동일 공식)."""
    if isinstance(rank, int) and 1 <= rank <= 30:
        return 31 - rank
    return None


def analyze(days: int = 7, source: str | None = None) -> dict | None:
    snaps = _load_all()[-days:]
    if not snaps:
        return None

    latest = snaps[-1]
    prev = snaps[-2] if len(snaps) >= 2 else None
    items = _all_items(latest, source)
    prev_items = _all_items(prev, source)
    rank_items = _ranked_items(latest, source)
    prev_rank_items = _ranked_items(prev, source)

    ranked_by_no = {it.get("product_no"): it for it in rank_items}
    prev_rank_by_no = {it.get("product_no"): it for it in prev_rank_items}

    risers, fallers = [], []
    if prev:
        for no, it in ranked_by_no.items():
            old = prev_rank_by_no.get(no)
            if old is None or not isinstance(old.get("rank"), int) or not isinstance(it.get("rank"), int):
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
        it for no, it in ranked_by_no.items() if prev is None or no not in prev_rank_by_no
    ]

    pacing = []
    if prev:
        for no, it in ranked_by_no.items():
            old = prev_rank_by_no.get(no)
            if old is None:
                continue
            now_n = it.get("episode_count")
            old_n = old.get("episode_count")
            if (
                isinstance(now_n, int)
                and isinstance(old_n, int)
                and it.get("episode_unit") == "화"
                and now_n >= 0
            ):
                pacing.append(
                    {
                        "title": it.get("title", ""),
                        "author": it.get("author", ""),
                        "now_rank": it.get("rank"),
                        "added": now_n - old_n,
                        "prev_chapters": old_n,
                        "now_chapters": now_n,
                    }
                )
        pacing.sort(key=lambda p: p["added"], reverse=True)
        pacing = pacing[:10]

    comment_top = sorted(
        (it for no, it in ranked_by_no.items() if it.get("comment_total") is not None),
        key=lambda it: it["comment_total"],
        reverse=True,
    )[:10]
    comment_top = [
        {
            "title": it.get("title", ""),
            "author": it.get("author", ""),
            "rank": it.get("rank"),
            "comment_total": it["comment_total"],
        }
        for it in comment_top
    ]

    unique = _unique_items(items)
    prev_unique = _unique_items(prev_items)

    tok_stats: dict[str, dict] = {}
    phrase_stats: dict[str, dict] = {}
    for it in unique:
        weight = _rank_weight(it.get("rank"))
        toks = _title_tokens(it.get("title", ""))
        for tok in set(toks):
            st = tok_stats.setdefault(tok, {"count": 0, "score": 0, "ranks": []})
            st["count"] += 1
            if weight is not None:
                st["score"] += weight
                st["ranks"].append(it["rank"])
        for a, b in set(zip(toks, toks[1:])):
            ph = phrase_stats.setdefault(f"{a} {b}", {"count": 0, "score": 0})
            ph["count"] += 1
            if weight is not None:
                ph["score"] += weight
    prev_counter = Counter()
    for it in prev_unique:
        for tok in set(_title_tokens(it.get("title", ""))):
            prev_counter[tok] += 1

    keywords = []
    for word, st in tok_stats.items():
        prev_count = prev_counter.get(word, 0)
        delta = st["count"] - prev_count if prev else None
        ranks = st["ranks"]
        keywords.append(
            {
                "word": word,
                "count": st["count"],
                "score": st["score"],
                "avg_rank": round(sum(ranks) / len(ranks), 1) if ranks else None,
                "best_rank": min(ranks) if ranks else None,
                "prev_count": prev_count if prev else None,
                "delta": delta,
            }
        )
    keywords.sort(key=lambda k: (k["score"], k["count"]), reverse=True)
    keywords = keywords[:20]

    phrases = [
        {"phrase": p, "count": st["count"], "score": st["score"]}
        for p, st in phrase_stats.items()
        if st["count"] >= 2
    ]
    phrases.sort(key=lambda p: (p["score"], p["count"]), reverse=True)
    phrases = phrases[:8]

    new_keywords = []
    if prev:
        for word, st in tok_stats.items():
            if st["count"] >= 2 and prev_counter.get(word, 0) == 0:
                new_keywords.append({"word": word, "count": st["count"]})
        new_keywords.sort(key=lambda k: k["count"], reverse=True)
        new_keywords = new_keywords[:12]

    total_unique = len(unique)
    counted_sources = {
        k for k in (latest.get("data") or {})
        if isinstance(latest.get("data", {}).get(k), list) and (not source or k == source)
    }
    options = _source_options(latest)
    source_label = next((o["label"] for o in options if o["key"] == source), "") if source else ""

    return {
        "latest_date": latest.get("collected_at", "")[:10],
        "prev_date": prev.get("collected_at", "")[:10] if prev else "",
        "snapshot_count": len(snaps),
        "sources": sorted(counted_sources),
        "source_options": options,
        "source_label": source_label,
        "total_items": len(items),
        "total_unique": total_unique,
        "ranked_items": len(rank_items),
        "risers": risers[:10],
        "fallers": fallers[:10],
        "new_entries": new_entries[:10],
        "pacing": pacing,
        "comment_top": comment_top,
        "keywords": keywords,
        "phrases": phrases,
        "new_keywords": new_keywords,
        "latest_titles": sorted(
            rank_items, key=lambda it: it["rank"]
        )[:30 if source else 20],
    }