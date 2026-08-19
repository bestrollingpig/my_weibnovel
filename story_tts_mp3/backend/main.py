from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List
import io
import base64
import os
import numpy as np
from pydub import AudioSegment

# Supertonic 3
from supertonic import TTS

app = FastAPI()

# CORS 설정 (프론트엔드에서 접근 가능)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# TTS 초기화 (최초 실행 시 모델 다운로드 ~400MB)
# ============================================================
print("[...] Supertonic 3 로딩 중...")
tts = TTS(auto_download=True)
print("[OK] Supertonic 3 로딩 완료!")

# 10개 내장 목소리 스타일 캐싱
VOICE_STYLES = {}
VOICE_NAMES = {
    'F1': '아이 여',
    'F2': '나래이터',
    'F3': '여성 실무',
    'F4': '성인 여',
    'F5': '노인 여',
    'M1': '성인 남',
    'M2': '노인 남',
    'M3': '아이 남',
    'M4': '성인 남2',
    'M5': '남성 거친'
}

print("[*] 목소리 스타일 로딩 중...")
for voice_id in VOICE_NAMES.keys():
    try:
        VOICE_STYLES[voice_id] = tts.get_voice_style(voice_name=voice_id)
        print(f"  [OK] {voice_id}: {VOICE_NAMES[voice_id]}")
    except Exception as e:
        print(f"  [--] {voice_id}: {e}")
print("[OK] 목소리 스타일 로딩 완료!")

# 감정 태그 매핑 (Supertonic 3 지원 태그)
EMOTION_TAGS = {
    'happy': '<laugh>',
    'sad': '<sigh>',
    'surprised': '<surprise>',
    'angry': '<angry>',      # 제한적 지원
    'fearful': '<breath>',   # 제한적 지원
    'neutral': '',
    'disgusted': ''
}

# ============================================================
# 요청 모델
# ============================================================
class TTSRequest(BaseModel):
    text: str
    voice: str = 'F2'
    lang: str = 'ko'
    speed: float = 0.9
    emotion: Optional[str] = None
    emotion_strength: float = 0.7

class BatchTTSRequest(BaseModel):
    segments: List[dict]  # [{"text": "...", "voice": "F1", "emotion": "happy"}, ...]
    speed: float = 0.9
    lang: str = 'ko'

# ============================================================
# API 엔드포인트
# ============================================================
@app.get("/")
def root():
    return {
        "message": "Supertonic 3 TTS Server",
        "voices": VOICE_NAMES,
        "status": "running"
    }

@app.get("/voices")
def get_voices():
    """사용 가능한 목소리 목록 반환"""
    return {"voices": VOICE_NAMES}

@app.post("/tts")
async def synthesize(request: TTSRequest):
    """단일 문장 TTS 생성"""
    try:
        # 1) 목소리 스타일 가져오기
        style = VOICE_STYLES.get(request.voice)
        if not style:
            style = VOICE_STYLES['F2']  # 기본값
        
        # 2) 감정 태그 추가
        text = request.text
        if request.emotion and request.emotion in EMOTION_TAGS:
            tag = EMOTION_TAGS[request.emotion]
            if tag:
                # 강도에 따라 태그 반복
                repeat = max(1, int(request.emotion_strength * 2))
                tag_repeated = ' '.join([tag] * repeat)
                text = f"{tag_repeated} {text} {tag_repeated}"
        
        # 3) TTS 생성
        wav, duration = tts.synthesize(
            text=text,
            voice_style=style,
            lang=request.lang,
            speed=request.speed,
            total_steps=8,
            max_chunk_length=150,
            silence_duration=0.2
        )
        
        # 4) WAV → MP3 변환 (pydub 사용)
        # float32 → int16 변환
        audio_int16 = (wav * 32767).astype(np.int16)
        
        # AudioSegment 생성 (Supertonic 3: 44100Hz)
        sr = tts.sample_rate
        audio_segment = AudioSegment(
            audio_int16.tobytes(),
            frame_rate=sr,
            sample_width=2,
            channels=1
        )
        
        # MP3로 내보내기
        mp3_buffer = io.BytesIO()
        audio_segment.export(mp3_buffer, format="mp3", bitrate="128k")
        mp3_data = mp3_buffer.getvalue()
        
        # Base64로 인코딩하여 반환 (프론트에서 바로 재생 가능)
        audio_base64 = base64.b64encode(mp3_data).decode('utf-8')
        
        return {
            "audio": audio_base64,
            "duration": float(duration[0]),
            "text": text
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts/batch")
async def synthesize_batch(request: BatchTTSRequest):
    """여러 문장을 순차적으로 TTS 생성 (MP3 + 자막)"""
    try:
        results = []
        total_duration = 0
        
        for i, seg in enumerate(request.segments):
            voice = seg.get('voice', 'F2')
            emotion = seg.get('emotion', 'neutral')
            text = seg.get('text', '')
            
            if not text.strip():
                continue
            
            # 단일 TTS 호출
            single_request = TTSRequest(
                text=text,
                voice=voice,
                lang=request.lang,
                speed=request.speed,
                emotion=emotion
            )
            
            result = await synthesize(single_request)
            
            results.append({
                "index": i,
                "text": text,
                "voice": voice,
                "emotion": emotion,
                "audio": result["audio"],
                "duration": result["duration"],
                "start_time": total_duration,
                "end_time": total_duration + result["duration"]
            })
            
            total_duration += result["duration"]
            
            # 문장 사이 간격 (0.3초)
            total_duration += 0.3
        
        # 전체 오디오 합치기 (Base64 디코드 후 합침)
        combined = AudioSegment.empty()
        for result in results:
            audio_bytes = base64.b64decode(result["audio"])
            seg = AudioSegment.from_mp3(io.BytesIO(audio_bytes))
            combined += seg
            # 간격 추가 (0.3초 무음)
            combined += AudioSegment.silent(duration=300)  # 300ms
        
        # 합친 오디오 MP3로 저장
        mp3_buffer = io.BytesIO()
        combined.export(mp3_buffer, format="mp3", bitrate="128k")
        combined_audio = base64.b64encode(mp3_buffer.getvalue()).decode('utf-8')
        
        # SRT 자막 생성
        srt = generate_srt(results)
        
        return {
            "audio": combined_audio,
            "duration": total_duration,
            "segments": results,
            "srt": srt,
            "count": len(results)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ============================================================
# SRT 자막 생성
# ============================================================
def generate_srt(segments):
    srt = ""
    for i, seg in enumerate(segments, 1):
        start = seg["start_time"]
        end = seg["end_time"]
        text = f"[{seg['voice']}] {seg['text']}"
        srt += f"{i}\n"
        srt += f"{format_time(start)} --> {format_time(end)}\n"
        srt += f"{text}\n\n"
    return srt

def format_time(seconds):
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

# ============================================================
# 실행
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")