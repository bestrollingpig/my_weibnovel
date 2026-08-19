# 웹소설 소재 검색 서비스 (KCI + 뉴스)

**웹소설 작가를 위한 자료 검색 서비스**입니다. 작가가 장르와 소재를 고르면, 소재 키워드를 뉴스에 실제로 나오는 검색어로 변환해 관련 기사를 찾아줍니다.

## 데이터 소스

| 소스 | 내용 | 인증 |
|---|---|---|
| 한국연구재단 KCI 보도자료 | 공공데이터포털 오픈API | serviceKey (서버에만 보관) |
| Google뉴스 RSS | 소재 검색어별 최신 기사 | 없음 |

## 보안 설계 (API 키 미노출)

```
사용자(웹 UI) ──> 프록시 서버(이 프로젝트) ──> KCI OpenAPI / Google뉴스
               ★ 키는 서버에만 존재             (서버가 인증 수행)
```

- 인증키(`serviceKey`)는 **서버 환경변수(`.env`)에만** 보관하며, 어느 API 응답에도 포함되지 않습니다(검증 완료).
- 웹 UI는 같은 서버의 `/api/*`만 호출하므로 사용자가 키를 알 수 없습니다.
- GitHub에 올려도 키는 유출되지 않습니다. `.env`는 `.gitignore`에 포함되어 있습니다.

## 사용 방법

1. 이 저장소를 GitHub에 올립니다.
2. [Render](https://render.com) → **New → Web Service** → GitHub 저장소 연결 (`render.yaml` 자동 감지).
3. Render 대시보드의 **Environment**에서 `KCI_SERVICE_KEY` 설정 (디코딩된 원본 키).
4. 배포 후 `https://<서비스명>.onrender.com` 에 접속하면 누구나 바로 사용 가능합니다.

> Render 무료 티어는 15분간 요청이 없으면 잠들고, 다시 요청하면 약 1분 뒤 깨어납니다.

## 로컬 실행

```bash
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
# .env 파일에 디코딩한 인증키 입력 (키는 URL 인코딩 이전의 원본)
uvicorn app.main:app --reload
# 브라우저에서 http://127.0.0.1:8000 접속
```

## 웹 인터페이스

배포 주소에 접속하면 바로 사용할 수 있는 검색 UI(`app/static/index.html`)가 함께 제공됩니다.

1. 장르 선택 (판타지/로맨스/무협/현대/미스터리/재난)
2. 소재 선택 (61개 소재, 예: 던전·레이드, 재벌, 연쇄 범죄)
3. **검색 결과**: KCI 보도자료 + Google뉴스 기사가 함께 표시되고, 어떤 소재 검색어로 매칭됐는지 태그로 표시

## API 명세

### `GET /api/materials`

웹소설 소재 키워드 사전 반환 (장르별 소재 목록). 프론트엔드에서 소재 선택 UI를 그릴 때 사용합니다.

```json
{
  "genres": [
    {
      "id": "fantasy",
      "name": "판타지",
      "materials": [
        { "id": "dungeon", "name": "던전·레이드", "desc": "던전 공략, 파티 모험", "searchTerms": ["던전", "레이드", ...] }
      ]
    }
  ]
}
```

### `GET /api/search`

소재 키워드 → 검색어 자동 변환 → KCI 보도자료(제목 매칭) + Google뉴스(RSS 검색) 병합 조회

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `genre` | str | (필수) | 장르 id (`/api/materials`에서 확인) |
| `material` | str | (필수) | 소재 id (`/api/materials`에서 확인) |
| `pageNo` | int | 1 | KCI 시작 페이지 |
| `maxPages` | int | 3 | KCI에서 가져올 페이지 수 (최대 10) |
| `recordCnt` | int | 10 | KCI 한 페이지 결과 수 (최대 100) |
| `rssTerms` | int | 3 | RSS에서 검색할 검색어 개수 (0이면 RSS 미사용, 검색어당 최대 30건) |
| `includeKci` | bool | true | KCI 보도자료 포함 여부 |
| `includeRss` | bool | true | Google뉴스 포함 여부 |

응답 예시:

```json
{
  "genre": "현대",
  "material": "요리·맛집",
  "materialDesc": "요리사, 레스토랑, 창업",
  "searchTerms": ["맛집", "요리사", "미슐랭", "식당", "셰프"],
  "kciSearchedCount": 8,
  "kciCount": 0,
  "rssCount": 30,
  "totalCount": 30,
  "results": [
    {
      "newsTitle": "전국 맛집 리스트 공개... - 매일경제",
      "newsUrl": "https://...",
      "pressName": "매일경제",
      "writeDate": "...",
      "matchedTerms": ["맛집"],
      "dataSource": "Google뉴스"
    }
  ]
}
```

- `dataSource`가 `KCI 보도자료` / `Google뉴스`로 어느 소스인지 구분됩니다.
- 소재 키워드("던전", "회귀")는 뉴스 본문에 그대로 나오는 경우가 드물어, 사전(`app/materials.json`)의 `searchTerms`로 변환해 검색합니다. 사전은 언제든 확장 가능합니다.

### `GET /api/press`

KCI 보도자료 원본 목록 조회 (저수준 엔드포인트)

| 파라미터 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `pageNo` | int | 1 | 페이지 번호 |
| `recordCnt` | int | 10 | 한 페이지 결과 수 (최대 100) |

### `GET /healthz`

서버 상태 확인. Render 등 호스팅의 health check에 사용합니다.

### `GET /docs`

Swagger 문서. 브라우저에서 바로 테스트할 수 있습니다.

## 사용 예시

```bash
curl "https://<서비스명>.onrender.com/api/press?pageNo=1&recordCnt=10"
```

브라우저/JS에서도 CORS 허용이라 그대로 호출할 수 있습니다.

## 오류 코드

KCI API 에러는 HTTP 상태코드로 변환되어 반환됩니다.

| HTTP | 원인 |
|---|---|
| 400 | 잘못된 요청 파라미터 |
| 403 | 서비스 접근 거부 |
| 429 | 요청 제한 초과 (초당 30건) |
| 502 | 키 미등록/기한만료/IP 미등록 등 서버 문제 |

## 보안 주의사항

- `KCI_SERVICE_KEY`는 **절대 코드에 직접 넣지 마세요.** `.env`(로컬) 또는 배포 환경변수(Render 등)로만 관리합니다.
- `.gitignore`에 `.env`가 포함되어 있으니 키를 실수로 커밋하지 않도록 주의하세요.
- data.go.kr에서 키의 사용 IP를 제한할 수 있습니다(등록된 IP 외 접근 차단).
