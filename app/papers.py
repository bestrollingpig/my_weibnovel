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

RE_TAG = re.compile(r"<[^>]+>")


def _clean(s: str) -> str:
    return RE_TAG.sub("", s or "").strip()


def _text(elem, tag):
    node = elem.find(tag)
    return node.text if node is not None and node.text is not None else ""


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", _clean(s)).lower()


async def _search_one(client: httpx.AsyncClient, service_key: str, term: str, record_cnt: int, matched_terms: list[str]) -> list[dict]:
    params = {"serviceKey": service_key, "pageNo": "1", "recordCnt": str(record_cnt), "artiNm": term}
    resp = None
    last_exc = None
    for attempt in range(2):
        try:
            resp = await client.get(KCI_PAPER_URL, params=params)
            break
        except httpx.HTTPError as exc:
            last_exc = exc
            await asyncio.sleep(1.0 * (attempt + 1))
    if resp is None:
        raise HTTPException(status_code=502, detail=f"KCI 논문 API 호출 실패: {last_exc}")

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail=f"KCI 논문 API 응답 파싱 실패 (HTTP {resp.status_code}): {exc}")

    header = root.find("header")
    if header is None:
        raise HTTPException(status_code=502, detail="KCI 논문 API 응답 형식 오류")
    result_code = _text(header, "resultCode")
    if result_code != "00":
        raise HTTPException(status_code=502, detail=f"KCI 논문 API 오류: {_text(header, 'resultMsg')}")

    body = root.find("body")
    items_node = body.find("items") if body is not None else None
    items = []
    title_norm = _norm(term)
    if items_node is not None:
        for item in items_node.findall("item"):
            kor_title = _clean(_text(item, "ARTI_KOR_TITL"))
            eng_title = _clean(_text(item, "ARTI_ENG_TITL"))
            title = kor_title or eng_title
            arti_id = _text(item, "ARTI_ID")
            if not title or not arti_id:
                continue
            if title_norm not in _norm(title):
                continue
            items.append(
                {
                    "newsTitle": title,
                    "newsUrl": _text(item, "URL")
                    or f"https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId={arti_id}",
                    "pressName": "",
                    "writeDate": _text(item, "RESI_DT"),
                    "matchedTerms": list(matched_terms),
                    "artiId": arti_id,
                    "doi": _clean(_text(item, "DOI")),
                    "wosCiteCnt": _clean(_text(item, "WOS_CITE_CNT")),
                    "orteYn": _text(item, "ORTE_YN"),
                    "keywords": _clean(_text(item, "KOR_KEYW")),
                    "abstract": _clean(_text(item, "KOR_ABST")),
                }
            )
    return items


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