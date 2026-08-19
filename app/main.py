import math
import os
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.materials import MATERIALS, find_material, match_article
from app.popularity import record as record_search
from app.popularity import today as popularity_today
from app.popularity import top as top_searches
from app.rss import search_by_terms

load_dotenv()

STATIC_DIR = Path(__file__).parent / "static"

KCI_BASE_URL = "http://apis.data.go.kr/B552540/KCIOpenApi/pressrelease/openApiD757List"
SERVICE_KEY = os.getenv("KCI_SERVICE_KEY", "")

ERROR_CODES = {
    "1": ("APPLICATION_ERROR", 502),
    "10": ("INVALID_REQUEST_PARAMETER_ERROR", 400),
    "12": ("NO_OPENAPI_SERVICE_ERROR", 502),
    "20": ("SERVICE_ACCESS_DENIED_ERROR", 403),
    "22": ("LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR", 429),
    "30": ("SERVICE_KEY_IS_NOT_REGISTERED_ERROR", 502),
    "31": ("DEADLINE_HAS_EXPIRED_ERROR", 502),
    "32": ("UNREGISTERED_IP_ERROR", 502),
    "99": ("UNKNOWN_ERROR", 502),
}

app = FastAPI(
    title="KCI 보도자료 조회 프록시 API",
    description="공공데이터포털 KCI 언론기사 조회 API의 프록시 서버. "
    "인증키(serviceKey)를 서버에만 보관하고 사용자에게 노출하지 않습니다.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _text(elem, tag):
    node = elem.find(tag)
    return node.text if node is not None and node.text is not None else ""


async def _fetch_page(client: httpx.AsyncClient, page_no: int, record_cnt: int) -> dict:
    params = {"serviceKey": SERVICE_KEY, "pageNo": str(page_no), "recordCnt": str(record_cnt)}
    try:
        resp = await client.get(KCI_BASE_URL, params=params)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"KCI API 호출 실패: {exc}")

    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail=f"KCI API 응답 파싱 실패 (HTTP {resp.status_code}): {exc}")

    header = root.find("header")
    if header is None:
        err_name = root.findtext("cmmMsgHeader/errMsg") or "UNKNOWN_ERROR"
        reason = root.findtext("cmmMsgHeader/returnReasonCode") or "99"
        status = ERROR_CODES.get(reason, ("", 502))[1]
        raise HTTPException(status_code=status, detail=f"[{reason}] {err_name}")

    result_code = _text(header, "resultCode")
    if result_code != "00":
        err_name, status = ERROR_CODES.get(result_code, ("UNKNOWN_ERROR", 502))
        raise HTTPException(status_code=status, detail=f"[{result_code}] {err_name}")

    body = root.find("body")
    items = []
    items_node = body.find("items")
    if items_node is not None:
        for item in items_node.findall("item"):
            items.append(
                {
                    "num": _text(item, "NUM"),
                    "newsSeq": _text(item, "NEWSSEQ"),
                    "newsTitle": _text(item, "NEWSTITL"),
                    "newsUrl": _text(item, "NEWSURL"),
                    "pressName": _text(item, "PRESSNM"),
                    "writeDate": _text(item, "WRITEDT"),
                }
            )

    return {
        "resultCode": result_code,
        "resultMsg": _text(header, "resultMsg"),
        "recordCnt": _text(body, "recordCnt"),
        "pageNo": _text(body, "pageNo"),
        "totalCount": _text(body, "totalCount"),
        "items": items,
    }


def _require_key():
    if not SERVICE_KEY:
        raise HTTPException(
            status_code=500,
            detail="서버에 KCI_SERVICE_KEY가 설정되지 않았습니다. .env 파일이나 환경변수를 확인하세요.",
        )


_DATE_FORMATS = (
    "%Y%m%d%H%M%S",
    "%Y-%m-%dT%H:%M:%S%z",
    "%a, %d %b %Y %H:%M:%S %Z",
    "%a, %d %b %Y %H:%M:%S %z",
    "%d %b %Y %H:%M:%S %Z",
    "%d %b %Y %H:%M:%S",
    "%Y-%m-%d",
)


def _parse_date(value: str) -> datetime:
    value = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except (ValueError, TypeError):
            continue
    return datetime.min


def _is_kci(article: dict) -> bool:
    return article.get("dataSource") == "KCI 보도자료"


def _sort_results(results: list[dict], sort: str) -> None:
    if sort == "recent":
        results.sort(key=lambda r: _parse_date(r.get("writeDate", "")), reverse=True)
    elif sort == "source":
        results.sort(key=lambda r: (_is_kci(r), _parse_date(r.get("writeDate", ""))), reverse=True)
    else:
        results.sort(
            key=lambda r: (
                _is_kci(r),
                len(r.get("matchedTerms", [])),
                _parse_date(r.get("writeDate", "")),
            ),
            reverse=True,
        )


@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/press")
async def get_press(
    pageNo: int = Query(1, ge=1, description="페이지 번호"),
    recordCnt: int = Query(10, ge=1, le=100, description="한 페이지 결과 수"),
):
    _require_key()
    async with httpx.AsyncClient(timeout=10.0) as client:
        return await _fetch_page(client, pageNo, recordCnt)


@app.get("/api/materials")
async def list_materials():
    return MATERIALS


@app.get("/api/popular")
async def popular_materials(
    limit: int = Query(10, ge=1, le=50, description="반환할 인기 소재 수"),
):
    return {"date": popularity_today(), "popular": top_searches(limit)}


@app.get("/api/search")
async def search_materials(
    genre: str = Query(..., description="장르 id (예: fantasy)"),
    material: str = Query(..., description="소재 id (예: dungeon)"),
    pageNo: int = Query(1, ge=1, description="시작 페이지 번호"),
    maxPages: int = Query(3, ge=1, le=10, description="KCI에서 가져올 페이지 수"),
    recordCnt: int = Query(10, ge=1, le=100, description="한 페이지 결과 수"),
    rssTerms: int = Query(3, ge=0, le=6, description="RSS에서 검색할 검색어 개수 (0이면 RSS 미사용)"),
    includeKci: bool = Query(True, description="KCI 보도자료 포함 여부"),
    includeRss: bool = Query(True, description="Google뉴스 포함 여부"),
    sort: str = Query("relevance", pattern="^(relevance|recent|source)$", description="정렬: relevance(관련도) / recent(최신순) / source(소스별)"),
):
    target = find_material(genre, material)
    if target is None:
        raise HTTPException(status_code=404, detail=f"소재를 찾을 수 없습니다: {genre}/{material}")
    genre_obj = next((g for g in MATERIALS["genres"] if g["id"] == genre), None)
    if includeKci:
        _require_key()

    results = []
    searched = 0
    kci_count = 0
    rss_count = 0
    async with httpx.AsyncClient(timeout=10.0) as client:
        if includeKci:
            first = await _fetch_page(client, pageNo, recordCnt)
            total_count = int(first["totalCount"] or 0)
            total_pages = min(maxPages, math.ceil(total_count / recordCnt) if total_count else 1)
            pages = [first] + [
                await _fetch_page(client, pageNo + i, recordCnt) for i in range(1, total_pages)
            ]
            for page_data in pages:
                items = page_data["items"]
                searched += len(items)
                for article in items:
                    matched = match_article(article, target)
                    if matched:
                        kci_count += 1
                        results.append({**matched, "dataSource": "KCI 보도자료"})
                if not items:
                    break
        if includeRss:
            for article in await search_by_terms(client, target["searchTerms"], rssTerms):
                rss_count += 1
                results.append({**article, "dataSource": "Google뉴스"})

    _sort_results(results, sort)
    record_search(genre, material, genre_obj["name"], target["name"])

    return {
        "genre": genre_obj["name"],
        "material": target["name"],
        "materialDesc": target["desc"],
        "searchTerms": target["searchTerms"],
        "sort": sort,
        "kciSearchedCount": searched,
        "kciCount": kci_count,
        "rssCount": rss_count,
        "totalCount": len(results),
        "results": results,
    }
