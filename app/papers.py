"""KCI 논문정보(artiInfo) 검색 모듈.

공공데이터포털 "한국연구재단_KCI 논문정보 서비스"의 상세기능
[KCI논문 정보 조회](openApiM310List)를 사용해 논문명(artiNm) 부분일치 검색을 수행합니다.
"""

import asyncio
import re
import xml.etree.ElementTree as ET

import httpx
from fastapi import HTTPException

KCI_PAPER_URL = "http://apis.data.go.kr/B552540/KCIOpenApi/artiInfo/openApiM310List"

# 데이터포털 게이트웨이 에러코드 → (설명, 재시도 여부)
GATEWAY_ERRORS = {
    "22": ("일일 호출량 초과", True),
    "23": ("초당 호출량 초과", True),
    "99": ("알 수 없는 오류", True),
}

RE_TAG = re.compile(r"<[^>]+>")


def _clean(s: str) -> str:
    return RE_TAG.sub("", s or "").strip()


def _text(elem, tag):
    node = elem.find(tag)
    return node.text if node is not None and node.text is not None else ""


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", _clean(s)).lower()


def _fmt_date(value: str) -> str:
    """RESI_DT(20050426021515) → 2005-04-26 형태로 변환."""
    value = _clean(value)
    if len(value) >= 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:8]}"
    return value


async def _fetch_m310(client, service_key, params) -> tuple[int, list[dict], str]:
    last_detail = "알 수 없는 오류"
    full_params = {"serviceKey": service_key, **params}
    for attempt in range(3):
        try:
            resp = await client.get(KCI_PAPER_URL, params=full_params)
        except httpx.HTTPError as exc:
            last_detail = f"호출 실패: {exc}"
            await asyncio.sleep(1.5 * (attempt + 1))
            continue

        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError as exc:
            last_detail = f"응답 파싱 실패 (HTTP {resp.status_code}): {exc}"
            await asyncio.sleep(1.5 * (attempt + 1))
            continue

        if root.tag != "response":
            reason = root.findtext("cmmMsgHeader/returnReasonCode") or ""
            err_msg = root.findtext("cmmMsgHeader/errMsg") or "GATEWAY_ERROR"
            label, retryable = GATEWAY_ERRORS.get(reason, (f"[{reason}] {err_msg}", False))
            last_detail = f"게이트웨이 오류: {label}"
            if retryable:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            raise HTTPException(status_code=502, detail=last_detail)

        header = root.find("header")
        if header is None:
            last_detail = "응답 형식 오류"
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        result_code = _text(header, "resultCode")
        if result_code != "00":
            last_detail = f"API 오류: {_text(header, 'resultMsg')}"
            await asyncio.sleep(1.5 * (attempt + 1))
            continue

        body = root.find("body")
        total = int(_text(body, "totalCount") or 0) if body is not None else 0
        items_node = body.find("items") if body is not None else None
        items = []
        if items_node is not None:
            for item in items_node.findall("item"):
                kor_title = _clean(_text(item, "ARTI_KOR_TITL"))
                eng_title = _clean(_text(item, "ARTI_ENG_TITL"))
                title = kor_title or eng_title
                arti_id = _text(item, "ARTI_ID")
                if not title or not arti_id:
                    continue
                items.append(
                    {
                        "newsTitle": title,
                        "newsUrl": _text(item, "URL")
                        or f"https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId={arti_id}",
                        "pressName": "",
                        "writeDate": _fmt_date(_text(item, "RESI_DT")),
                        "matchedTerms": [],
                        "artiId": arti_id,
                        "doi": _clean(_text(item, "DOI")),
                        "wosCiteCnt": _clean(_text(item, "WOS_CITE_CNT")),
                        "orteYn": _text(item, "ORTE_YN"),
                        "keywords": _clean(_text(item, "KOR_KEYW")),
                        "abstract": _clean(_text(item, "KOR_ABST")),
                    }
                )
        return total, items, result_code
    raise HTTPException(status_code=502, detail=f"KCI 논문 API {last_detail}")


async def _search_one(client: httpx.AsyncClient, service_key: str, term: str, record_cnt: int, matched_terms: list[str]) -> list[dict]:
    _, items, _ = await _fetch_m310(
        client, service_key, {"pageNo": "1", "recordCnt": str(record_cnt), "artiNm": term}
    )
    title_norm = _norm(term)
    kept = []
    for paper in items:
        if title_norm in _norm(paper["newsTitle"]):
            paper["matchedTerms"] = list(matched_terms)
            kept.append(paper)
    return kept


async def search_papers_page(
    client: httpx.AsyncClient,
    service_key: str,
    keyword: str,
    page_no: int = 1,
    record_cnt: int = 10,
) -> dict:
    """키워드(논문명 부분일치)로 논문 목록을 페이지 단위 조회."""
    if not (service_key and keyword.strip()):
        return {"pageNo": page_no, "totalCount": 0, "items": []}
    total, items, _ = await _fetch_m310(
        client,
        service_key,
        {"pageNo": str(page_no), "recordCnt": str(record_cnt), "artiNm": keyword.strip()},
    )
    return {"pageNo": page_no, "totalCount": total, "items": items}


async def search_papers(
    client: httpx.AsyncClient,
    service_key: str,
    terms: list[str],
    max_terms: int,
    record_cnt: int = 10,
) -> list[dict]:
    """검색어별 논문명 부분일치 검색(병렬) 후 ARTI_ID 기준 중복 제거."""
    if not (service_key and terms and max_terms > 0):
        return []
    selected = terms[:max_terms]
    lists = await asyncio.gather(
        *(_search_one(client, service_key, term, record_cnt, [term]) for term in selected)
    )
    seen = {}
    for paper in (p for lst in lists for p in lst):
        arti_id = paper["artiId"]
        if arti_id in seen:
            seen[arti_id]["matchedTerms"] = sorted(set(seen[arti_id]["matchedTerms"] + paper["matchedTerms"]))
        else:
            seen[arti_id] = paper
    return list(seen.values())