// ============================================================
// AUDIO CLIPPER - 오디오 파일 클리핑 및 재생
// ============================================================

import { getAudioContext } from './synthesizer.js';

// ============================================================
// STATE
// ============================================================

let currentSource = null;
let currentGain = null;
let fadeTimer = null;

// ============================================================
// PUBLIC API
// ============================================================

export function loadAudioBuffer(arrayBuffer, onSuccess, onError) {
  const ctx = getAudioContext();
  ctx.decodeAudioData(
    arrayBuffer, 
    function(buf) {
      const segments = Math.floor(buf.duration / 2);
      if (segments < 1) {
        onError(new Error('오디오 파일이 너무 짧습니다.'));
        return;
      }
      onSuccess(buf, segments);
    }, 
    function(err) {
      onError(err);
    }
  );
}

export function playSegment(audioBuffer, index, volume, segmentLength, timeoutSec) {
  if (!audioBuffer) return;
  
  const ctx = getAudioContext();
  const len = segmentLength || 2;
  const offset = index * len;
  
  // 이전 소스 페이드 아웃
  if (currentSource) {
    try {
      const pg = currentGain;
      if (pg) {
        pg.gain.cancelScheduledValues(ctx.currentTime);
        pg.gain.setValueAtTime(pg.gain.value, ctx.currentTime);
        pg.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.05);
        currentSource.stop(ctx.currentTime + 0.06);
      }
    } catch(e) {}
  }
  
  // 새 소스 생성
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume || 0.5, ctx.currentTime + 0.05);
  
  source.connect(gain);
  gain.connect(ctx.destination);
  
  source.start(ctx.currentTime, Math.max(0, offset));
  
  currentSource = source;
  currentGain = gain;
  
  // 타임아웃 (재생 중단 방지)
  const timeout = timeoutSec || 5;
  if (fadeTimer) clearTimeout(fadeTimer);
  
  fadeTimer = setTimeout(function() {
    try {
      const g = currentGain;
      const src = currentSource;
      currentSource = null;
      currentGain = null;
      
      if (g && src) {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
        setTimeout(function() { 
          try { src.stop(); } catch(e) {} 
        }, 600);
      }
    } catch(e) {}
    fadeTimer = null;
  }, timeout * 1000);
}

export function stopPlayback() {
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  
  if (currentSource) {
    try { 
      currentSource.stop(); 
    } catch(e) {}
    currentSource = null;
    currentGain = null;
  }
}

export function getSegmentCount(audioBuffer, segmentLength) {
  if (!audioBuffer) return 0;
  const len = segmentLength || 2;
  return Math.floor(audioBuffer.duration / len);
}

export function getDuration(audioBuffer) {
  if (!audioBuffer) return 0;
  return audioBuffer.duration;
}

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.audioClipper = {
  loadAudioBuffer,
  playSegment,
  stopPlayback,
  getSegmentCount,
  getDuration
};

export default {
  loadAudioBuffer,
  playSegment,
  stopPlayback,
  getSegmentCount,
  getDuration
};