#!/usr/bin/env python3
"""웹소설 플랫폼 랭킹 일일 수집기 (stdlib만 사용).

GitHub Actions에서 매일 실행되어 trends/ 디렉터리에 YYYYMMDD.json으로 저장.
소스:
  - 네이버 시리즈 웹소설 TOP 100·장르별 (서버 렌더링 페이지)
  - 문피아 베스트 (mm.munpia.com 공개 AJAX JSON: 무료/유료/베스트셀러, 각 30위)
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
SERIES_DETAIL = "https://series.naver.com/novel/detail.series?productNo={no}"
RE_COMMENT_COUNT = re.compile(r'<span id="commentCount">([^<]+)</span>')
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
RE_FREE = re.compile(r'<span\s+class="free_info[^"]*">\s*<span>([^<]+)</span>(?:\s*<span\s+class="date_remain">([^<]+)</span>)?')
RE_STRIP_TAG = re.compile(r"<[^>]+>")
RE_SPACE = re.compile(r"\s+")
RE_EP_PREFIX = re.compile(r"총(\d+)(화|권|부)/(완결|미완결)")
RE_EP_TAIL = re.compile(r"[\(（](\d+)(화|권)/(완결|미완결)[\)）]?$")

MUNPIA_AJAX = "https://mm.munpia.com/?ajx=1&menu=best&action=list&section={sec}&page={page}"
# (소스 키 접미, 표시명, AJAX section 코드)
MUNPIA_SECTIONS = [
    ("best_free", "무료 베스트", "today"),
    ("best_paid", "유료 베스트", "plsa.eachtoday"),
    ("bestseller", "베스트셀러", "plsa.bestseller"),
]
MUNPIA_GENRE_KO = {
    "heroism": "무협", "fantasy": "판타지", "newfantasy": "신판타지",
    "romance": "로맨스", "romfantasy": "로판", "romancefantasy": "로판",
    "modern": "현대물", "drama": "드라마", "mystery": "미스터리",
    "alternative": "대체역사", "sf": "SF", "lightnovel": "라노벨", "etc": "기타",
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_series_items(html: str, source_label: str) -> list[dict]:
    items = []
    for idx, block in enumerate(RE_LI.findall(html), start=1):
        if "score_num" not in block and "top_num" not in block:
            continue
        title_m = RE_TITLE.search(block)
        rank_m = RE_RANK.search(block)
        if not title_m:
            continue
        path, title = title_m.groups()
        title = RE_SPACE.sub(" ", title).strip()
        ep_tail = RE_EP_TAIL.search(title)
        title = re.sub(r"[\(（]?\d+[화권]/(?:완결|미완결)[\)）]?$", "", title).strip()
        if not title:
            continue
        product_no = re.search(r"productNo=(\d+)", path)
        score_m = RE_SCORE.search(block)
        author_m = RE_AUTHOR.search(block)
        ellipsis = [RE_SPACE.sub("", e) for e in RE_ELLIPSIS.findall(block)]
        episode_ell = next((e for e in ellipsis if "화" in e), "")
        free_m = RE_FREE.search(block)
        ep_count = ep_unit = status = None
        m = RE_EP_PREFIX.search(episode_ell)
        if m:
            ep_count, ep_unit, status = int(m.group(1)), m.group(2), m.group(3)
        elif ep_tail:
            ep_count, ep_unit, status = int(ep_tail.group(1)), ep_tail.group(2), ep_tail.group(3)
        items.append(
            {
                "platform": "네이버 시리즈",
                "list": source_label,
                "rank": int(rank_m.group(1)) if rank_m else idx,
                "move": RE_SPACE.sub("", RE_MOVE.search(block).group(1)) if RE_MOVE.search(block) else "",
                "title": title,
                "product_no": product_no.group(1) if product_no else "",
                "url": "https://series.naver.com" + path,
                "author": (author_m.group(1) if author_m else "").strip(),
                "score": float(score_m.group(1)) if score_m else None,
                "episode_info": episode_ell,
                "episode_count": ep_count,
                "episode_unit": ep_unit,
                "status": status,
                "free_info": (free_m.group(1).strip() if free_m else "") or "",
                "free_remain": (free_m.group(2).strip() if free_m and free_m.group(2) else "") or "",
                "is_new": 'ico ico_update' in block,
            }
        )
    return items


def fetch_genre(label: str, code: int) -> list[dict]:
    url = f"https://series.naver.com/novel/categoryProductList.series?categoryTypeCode=genre&genreCode={code}"
    return parse_series_items(fetch(url), label)


def _to_int(v) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def fetch_munpia(section: str, label: str, pages: int = 3) -> list[dict]:
    """mm.munpia.com 공개 AJAX JSON에서 베스트 목록을 수집합니다 (집계 숫자만 저장)."""
    out: list[dict] = []
    seen: set[str] = set()
    for page in range(1, pages + 1):
        payload = json.loads(fetch(MUNPIA_AJAX.format(sec=section, page=page)))
        entries = payload.get("list") or []
        if not entries:
            break
        for e in entries:
            srl = str(e.get("nvSrl") or "")
            title = RE_SPACE.sub(" ", str(e.get("nvTitle") or "")).strip()
            if not srl or not title or srl in seen:
                continue
            seen.add(srl)
            genre_code = str(e.get("nvGnMain") or "").strip()
            finished = str(e.get("nvOptFinish") or "").strip() == "1"
            rank = _to_int(e.get("nsrRank"))
            out.append(
                {
                    "platform": "문피아",
                    "list": label,
                    "rank": rank if rank and rank >= 1 else len(out) + 1,
                    "move": "",
                    "title": title,
                    "product_no": f"mp_{srl}",
                    "url": f"https://www.munpia.com/novel/detail/{srl}",
                    "author": RE_SPACE.sub(" ", str(e.get("nvAuthor") or "")).strip(),
                    "score": None,
                    "genre": MUNPIA_GENRE_KO.get(genre_code, genre_code),
                    "episode_count": _to_int(e.get("nvSumEntry")),
                    "episode_unit": "화",
                    "status": "완결" if finished else "미완결",
                    "views_total": _to_int(e.get("nvSumHit")),
                    "good_total": _to_int(e.get("nvSumGood")),
                    "prefer_total": _to_int(e.get("nvSumPrefer")),
                    "comment_total": _to_int(e.get("nvSumComment")),
                    "is_new": False,
                }
            )
    return out


def parse_count(text: str) -> int | None:
    """'1.8천'/'23만'/1,234 같은 집계 표기를 정수로 변환."""
    t = (text or "").strip().replace(",", "").replace(" ", "")
    if not t:
        return None
    m = re.match(r"^([\d.]+)(천|만|억)$", t)
    if m:
        units = {"천": 1000, "만": 10000, "억": 100000000}
        return int(float(m.group(1)) * units[m.group(2)])
    if t.isdigit():
        return int(t)
    return None


def fetch_comment_count(product_no: str) -> tuple[int | None, str]:
    """상세 페이지에서 공개 집계인 댓글 수를 가져옵니다."""
    try:
        html = fetch(SERIES_DETAIL.format(no=product_no))
        m = RE_COMMENT_COUNT.search(html)
        if m:
            raw = RE_SPACE.sub("", m.group(1))
            return parse_count(raw), raw
    except Exception:  # noqa: BLE001
        pass
    return None, ""


def main() -> int:
    collected = {}
    errors = []
    try:
        items = parse_series_items(fetch(SERIES_TOP100), "TOP 100")
        if len(items) == 0:
            raise RuntimeError("TOP100에서 항목을 파싱하지 못했습니다.")
        for it in items[:20]:
            count, raw = fetch_comment_count(it["product_no"])
            it["comment_total"] = count
            it["comment_raw"] = raw
        collected["naver_series_top100"] = items
    except Exception as exc:  # noqa: BLE001
        errors.append(f"naver_series_top100: {exc}")

    for key, label, code in GENRE_SOURCES:
        try:
            items = fetch_genre(label, code)
            if items:
                collected[f"naver_series_genre_{key}"] = items
            else:
                errors.append(f"genre_{key}({label}): 항목 없음")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"genre_{key}({label}): {exc}")

    for key, label, sec in MUNPIA_SECTIONS:
        try:
            mitems = fetch_munpia(sec, label)
            if len(mitems) >= 10:
                collected[f"munpia_{key}"] = mitems
            else:
                errors.append(f"munpia_{key}({label}): {len(mitems)}건만 수집")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"munpia_{key}({label}): {exc}")

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