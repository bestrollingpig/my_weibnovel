// ============================================================
// SOUNDFONT LOADER - 고품질 MIDI 악기 관리
// ============================================================

import { getAudioContext, playPianoNote } from './synthesizer.js';

// ============================================================
// STATE
// ============================================================

let soundfontInstrument = null;
let isReady = false;
let loadPromise = null;
let currentInstrument = 'acoustic_grand_piano';

// ============================================================
// PUBLIC API
// ============================================================

export async function initSoundfont(instrument) {
  if (!instrument) instrument = 'acoustic_grand_piano';
  
  // 이미 같은 악기가 로드되어 있으면 그대로 사용
  if (soundfontInstrument && currentInstrument === instrument && isReady) {
    return soundfontInstrument;
  }
  
  // 다른 악기면 초기화
  if (soundfontInstrument && currentInstrument !== instrument) {
    soundfontInstrument = null;
    isReady = false;
  }
  
  // 로딩 중이면 기다림
  if (loadPromise) {
    await loadPromise;
    return soundfontInstrument;
  }
  
  // 사운드폰트 로드
  const statusEl = document.getElementById('soundfontStatus');
  if (statusEl) {
    statusEl.textContent = '⏳ 로딩 중...';
    statusEl.className = 'loading';
  }
  
  loadPromise = (async () => {
    try {
      const ctx = getAudioContext();
      currentInstrument = instrument;
      
      // Soundfont-player가 전역에 로드되어 있어야 함
      if (typeof Soundfont === 'undefined') {
        throw new Error('Soundfont-player 라이브러리가 로드되지 않았습니다.');
      }
      
      soundfontInstrument = await Soundfont.instrument(ctx, instrument);
      isReady = true;
      
      if (statusEl) {
        statusEl.textContent = '✅ 준비 완료';
        statusEl.className = 'loaded';
        setTimeout(() => { 
          if (statusEl.textContent === '✅ 준비 완료') {
            statusEl.textContent = ''; 
          }
        }, 3000);
      }
      
      console.log('✅ 사운드폰트 로드 완료:', instrument);
      return soundfontInstrument;
      
    } catch (e) {
      console.warn('사운드폰트 실패, 기본 합성음 사용:', e);
      soundfontInstrument = null;
      isReady = false;
      
      if (statusEl) {
        statusEl.textContent = '⚠️ 실패 (기본 음색)';
        statusEl.className = 'error';
        setTimeout(() => {
          if (statusEl.textContent === '⚠️ 실패 (기본 음색)') {
            statusEl.textContent = '';
          }
        }, 4000);
      }
      
      throw e;
    } finally {
      loadPromise = null;
    }
  })();
  
  return loadPromise;
}

export function playNote(noteNumber, volume, options) {
  const dur = options?.duration || 0.5;
  const release = options?.release || 0.2;
  
  if (soundfontInstrument && isReady) {
    try {
      soundfontInstrument.play(noteNumber, 0, {
        gain: volume * 0.5,
        duration: dur,
        release: release
      });
      return;
    } catch (e) {
      console.warn('사운드폰트 재생 실패, 폴백:', e);
    }
  }
  
  // 폴백: 기본 합성음
  const freq = 440 * Math.pow(2, (noteNumber - 69) / 12);
  playPianoNote(freq, volume, dur, options?.preset || 'grand');
}

export function isSoundfontReady() {
  return isReady && soundfontInstrument !== null;
}

export function getInstrument() {
  return soundfontInstrument;
}

export function getCurrentInstrumentName() {
  return currentInstrument;
}

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.soundfontLoader = {
  initSoundfont,
  playNote,
  isSoundfontReady,
  getInstrument,
  getCurrentInstrumentName
};

export default {
  initSoundfont,
  playNote,
  isSoundfontReady,
  getInstrument,
  getCurrentInstrumentName
};