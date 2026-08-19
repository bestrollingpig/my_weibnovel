# 이야기 TTS 제작기 v3

Supertonic 3 기반 웹 TTS 도구. AI 분석 → 캐릭터 매핑 → TTS 생성 → MP3+자막

## 기능

- **AI 분석**: 이야기 텍스트 → AI 프롬프트 생성 → 캐릭터/감정 자동 분석
- **캐릭터 매핑**: 등장인물별 목소리(F1~M5) 지정, AI 추천
- **TTS 생성**: Supertonic 3 엔진으로 실제 음성 합성
- **미리듣기**: Supertonic 3 목소리로 실제 재생
- **내보내기**: MP3 + SRT 자막

## 디렉토리 구조

```
story-tts/
├── backend/
│   ├── main.py          # FastAPI 서버 (Supertonic 3)
│   └── requirement.txt  # Python 패키지 목록
├── frontend/
│   └── index.html       # 웹 UI (GitHub Pages 호환)
├── .gitignore
└── README.md
```

## 실행 방법

### 1) 백엔드 (Python 서버)

```bash
cd backend
pip install -r requirement.txt
python main.py
```

첫 실행 시 Supertonic 3 모델(~400MB)을 HuggingFace에서 자동 다운로드합니다.  
서버가 `http://localhost:8000` 에서 실행됩니다.

### 2) 프론트엔드

- `frontend/index.html` 을 브라우저로 열기 (더블클릭)
- 또는 GitHub Pages에 배포 후 접속

### 3) 사용 흐름

1. 이야기 텍스트 입력 → **분석하기**
2. AI 프롬프트가 클립보드에 복사됨
3. Gemini/Claude/ChatGPT에 붙여넣어 JSON 결과 받기
4. 결과를 **AI 분석 결과 붙여넣기** 영역에 붙여넣기
5. 캐릭터별 목소리 확인/수정
6. **미리듣기** 또는 **MP3 + 자막 저장**

## GitHub Pages 배포

프론트엔드는 정적 HTML이므로 GitHub Pages에 무료로 호스팅 가능합니다.

1. GitHub에 리포지토리 생성 후 푸시
2. Settings → Pages → Source: `main` branch, folder: `/frontend`
3. `https://<user>.github.io/<repo>/` 에서 접속
4. 백엔드는 별도 실행 필요 (로컬 또는 클라우드)

## 라이선스

MIT
