#!/usr/bin/env python3
"""웹소설 플랫폼 랭킹 일일 수집기 (stdlib만 사용).

GitHub Actions에서 매일 실행되어 trends/ 디렉터리에 YYYYMMDD.json으로 저장.
소스: 네이버 시리즈 웹소설 TOP 100 (서버 렌더링 페이지).
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    return datetime.now(KST)

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
}

SERIES_TOP100 = "https://series.naver.com/novel/top100List.series"
# (key, 표시명, genreCode)
GENRE_SOURCES = [
    ("romance", "로맨스", 201),
    ("fantasy", "판타지", 202),
    ("martial", "무협", 207),
]

RE_LI = re.compile(r"<li>(.*?)</li>", re.S)
RE_RANK = re.compile(r'<em\s+class="no\d*">(\d+)</em>')
RE_MOVE = re.compile(r'<span\s+class="top_uds">\s*<em\s+class="comic_ico[^"]*">([^<]*)</em>\s*</span>')
RE_TITLE = re.compile(r'<a\s+href="(/novel/detail\.series\?productNo=\d+)"[^>]*>\s*([^<]+)</a>')
RE_SCORE = re.compile(r'<em\s+class="score_num">([\d.]+)</em>')
RE_AUTHOR = re.compile(r'<span\s+class="author">([^<]+)</span>')
RE_ELLIPSIS = re.compile(r'<span\s+class="ellipsis">([^<]*)</span>')
RE_STRIP_TAG = re.compile(r"<[^>]+>")
RE_SPACE = re.compile(r"\s+")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_series_items(html: str, source_label: str) -> list[dict]:
    items = []
    for block in RE_LI.findall(html):
        if "score_num" not in block and "top_num" not in block:
            continue
        title_m = RE_TITLE.search(block)
        rank_m = RE_RANK.search(block)
        if not title_m:
            continue
        path, title = title_m.groups()
        title = RE_SPACE.sub(" ", title).strip()
        title = re.sub(r"[\(（]?\d+[화권]/(?:완결|미완결)[\)）]?$", "", title).strip()
        if not title:
            continue
        product_no = re.search(r"productNo=(\d+)", path)
        score_m = RE_SCORE.search(block)
        author_m = RE_AUTHOR.search(block)
        ellipsis = [RE_SPACE.sub("", e) for e in RE_ELLIPSIS.findall(block)]
        episode = next((e for e in ellipsis if "화" in e), "")
        items.append(
            {
                "platform": "네이버 시리즈",
                "list": source_label,
                "rank": int(rank_m.group(1)) if rank_m else None,
                "move": RE_SPACE.sub("", RE_MOVE.search(block).group(1)) if RE_MOVE.search(block) else "",
                "title": title,
                "product_no": product_no.group(1) if product_no else "",
                "url": "https://series.naver.com" + path,
                "author": (author_m.group(1) if author_m else "").strip(),
                "score": float(score_m.group(1)) if score_m else None,
                "episode_info": episode,
                "is_new": 'ico ico_update' in block,
            }
        )
    return items


def fetch_genre(code: int) -> list[dict]:
    url = f"https://series.naver.com/novel/categoryProductList.series?categoryTypeCode=genre&genreCode={code}"
    return parse_series_items(fetch(url), f"장르:{code}")


def main() -> int:
    collected = {}
    errors = []
    try:
        items = parse_series_items(fetch(SERIES_TOP100), "TOP 100")
        if len(items) == 0:
            raise RuntimeError("TOP100에서 항목을 파싱하지 못했습니다.")
        collected["naver_series_top100"] = items
    except Exception as exc:  # noqa: BLE001
        errors.append(f"naver_series_top100: {exc}")

    for key, label, code in GENRE_SOURCES:
        try:
            items = fetch_genre(code)
            if items:
                collected[f"naver_series_genre_{key}"] = items
            else:
                errors.append(f"genre_{key}({label}): 항목 없음")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"genre_{key}({label}): {exc}")

    if not collected:
        print("모든 소스 수집 실패:", errors, file=sys.stderr)
        return 1

    out = {
        "collected_at": now_kst().strftime("%Y-%m-%d %H:%M:%S"),
        "sources": sorted(collected),
        "errors": errors,
        "data": collected,
    }
    out_dir = Path(__file__).resolve().parent.parent / "trends"
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / f"trends_{now_kst().strftime('%Y%m%d')}.json"
    out_file.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for name, items in collected.items():
        print(f"{name}: {len(items)}개 저장 -> {out_file.name}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main())