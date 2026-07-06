// ============================================================
// TYPE MUSIC - 메인 컨트롤러
// ============================================================

import { showToast } from '../app.js';
import { 
  playKeyboardSound, 
  playImprovNote, 
  getAudioContext 
} from './synthesizer.js';
import { 
  initSoundfont, 
  playNote, 
  isSoundfontReady 
} from './soundfont-loader.js';
import { parseMidi } from './midi-parser.js';
import { 
  loadAudioBuffer, 
  playSegment, 
  getSegmentCount, 
  getDuration,
  stopPlayback 
} from './audio-clipper.js';

// ============================================================
// STATE
// ============================================================

const state = {
  active: false,
  mode: 'off',        // 'keyboard' | 'performance' | 'improv' | 'hybrid' | 'audio'
  context: null,
  instrument: null,
  audioBuffer: null,
  songData: {},
  songIndex: 0,
  noteQueue: [],
  lastTime: 0,
  playing: false,
  previewTimer: null,
  volume: 0.5,
  theme: 'mechanical',
  preset: 'grand',
  songKey: 'fur_elise',
  midiInstrument: 'acoustic_grand_piano',
  audioClipLen: 2,
  audioTimeout: 5
};

// ============================================================
// PUBLIC API
// ============================================================

export function initTypeMusic() {
  // 초기화 시 AudioContext 준비 (사용자 상호작용 전까지 대기)
  // Soundfont는 첫 사용 시 로드
  console.log('🎵 타자 음악 초기화 완료');
}

export function toggleTypeMusic() {
  state.active = !state.active;
  if (!state.active) {
    stopAll();
  }
  const panel = document.getElementById('typeMusicPanel');
  panel.style.display = state.active ? 'block' : 'none';
  document.getElementById('typeMusicBtn').style.borderColor = state.active ? 'var(--c-loc)' : '';
  
  if (state.active) {
    // 사운드폰트 미리 로드
    setTimeout(() => initSoundfont(state.midiInstrument), 100);
  }
  
  return state.active;
}

export function setTypeMusicMode(mode) {
  state.mode = mode;
  if (state.previewTimer) stopPreview();
  state.playing = false;
  
  const isSong = mode === 'performance' || mode === 'hybrid';
  const isAudio = mode === 'audio';
  const isKeyboard = mode === 'keyboard' || mode === 'hybrid';
  
  document.getElementById('typeMusicSong').style.display = isSong ? 'inline-block' : 'none';
  document.getElementById('typeMusicTheme').style.display = isKeyboard ? 'inline-block' : 'none';
  document.getElementById('typeMusicPreset').style.display = mode !== 'audio' ? 'inline-block' : 'none';
  document.getElementById('midiInstrument').style.display = (mode === 'performance' || mode === 'improv' || mode === 'hybrid') ? 'inline-block' : 'none';
  document.getElementById('audioControls').style.display = isAudio ? 'inline-flex' : 'none';
  
  state.songIndex = 0;
  
  if ((mode === 'performance' || mode === 'improv' || mode === 'hybrid') && state.active) {
    setTimeout(() => initSoundfont(state.midiInstrument), 100);
  }
  
  if (isAudio && state.active) {
    if (state.audioBuffer) {
      updateAudioClipStatus();
      showToast('🎵 오디오 클리퍼 준비됨');
    } else {
      showToast('📂 오디오 파일을 업로드하세요');
    }
  }
  
  return '✅ 모드 변경: ' + mode;
}

export function handleTypeKey(key) {
  if (!state.active || state.mode === 'off') return;
  
  // 제외할 키
  const skip = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
    'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Insert',
    'CapsLock','NumLock','ScrollLock','Pause','Escape','Shift','Control','Alt','Meta','AltGraph','ContextMenu'];
  if (skip.indexOf(key) !== -1) return;
  
  const vol = state.volume;
  const now = Date.now();
  if (now - state.lastTime > 50 && now - state.lastTime < 3000) {
    state.noteQueue.push(now - state.lastTime);
    if (state.noteQueue.length > 20) state.noteQueue.shift();
  }
  state.lastTime = now;
  
  playByMode(key, vol);
}

export function loadAudioFile(arrayBuffer) {
  return new Promise((resolve, reject) => {
    loadAudioBuffer(arrayBuffer, (buf, segments) => {
      state.audioBuffer = buf;
      updateAudioClipStatus();
      resolve({ duration: getDuration(buf), segments: segments });
    }, reject);
  });
}

export function loadMidiFile(arrayBuffer) {
  try {
    const parsed = parseMidi(arrayBuffer);
    const name = 'uploaded_' + Date.now();
    state.songData[name] = parsed;
    const sel = document.getElementById('typeMusicSong');
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = '📂 ' + (name.replace('uploaded_', ''));
    sel.appendChild(opt);
    sel.value = name;
    showToast('✅ MIDI 로드 완료 (' + parsed.chords.length + '코드)');
    return { name, chords: parsed.chords.length, bpm: parsed.bpm };
  } catch(err) {
    showToast('❌ MIDI 파싱 실패: ' + err.message);
    throw err;
  }
}

export function playPreview() {
  if (!state.active) return;
  const mode = state.mode;
  if (mode === 'keyboard') { 
    playKeyboardSound('a', 0.5); 
    setTimeout(() => playKeyboardSound('b', 0.5), 100); 
  } else if (mode === 'performance') { 
    playFullSongPreview(); 
  } else if (mode === 'improv') { 
    playImprovNote('a', 0.5); 
    setTimeout(() => playImprovNote('b', 0.5), 100); 
  } else if (mode === 'hybrid') { 
    playKeyboardSound('a', 0.5); 
    setTimeout(() => playImprovNote(' ', 0.4), 150); 
  } else if (mode === 'audio') { 
    playAudioSegment(0.5); 
  }
}

export function stopAll() {
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
  }
  state.playing = false;
  stopPlayback();
  document.getElementById('typeMusicMidPreviewBtn').textContent = '▶ 미리듣기';
  document.getElementById('typeMusicStatus').textContent = '';
}

export function getTypeMusicStatus() {
  return {
    active: state.active,
    mode: state.mode,
    hasAudio: !!state.audioBuffer,
    hasInstrument: isSoundfontReady(),
    songCount: Object.keys(state.songData).length,
    volume: state.volume
  };
}

// ============================================================
// PRIVATE FUNCTIONS
// ============================================================

function playByMode(key, vol) {
  switch(state.mode) {
    case 'keyboard': 
      playKeyboardSound(key, vol); 
      break;
    case 'performance': 
      playPerformanceNote(vol); 
      break;
    case 'improv': 
      playImprovNote(key, vol); 
      break;
    case 'hybrid': 
      if (key === ' ' || key === 'Enter') {
        playImprovNote(key, vol * 0.7);
      } else {
        playKeyboardSound(key, vol * 0.5);
      }
      break;
    case 'audio': 
      playAudioSegment(vol); 
      break;
  }
}

function playPerformanceNote(vol) {
  const songKey = document.getElementById('typeMusicSong').value || state.songKey;
  const song = state.songData[songKey];
  if (!song || !song.chords || !song.chords.length) return;
  if (state.playing) return;
  
  state.playing = true;
  const gs = song.groupSize || 8;
  const total = song.chords.length;
  const startIdx = state.songIndex % total;
  const count = Math.min(gs, total);
  const dur = 60 / song.bpm;
  const interval = dur * 1000 * 0.9;
  const el = document.getElementById('typeMusicStatus');
  const measureNum = Math.floor(startIdx / gs) + 1;
  const totalMeasures = Math.ceil(total / gs);
  el.textContent = '🎵 마디 ' + measureNum + '/' + totalMeasures;
  let ci = 0;
  
  function step() {
    if (ci >= count) {
      state.playing = false;
      state.songIndex = (startIdx + count) % total;
      const nextMeasure = Math.floor(state.songIndex / gs) + 1;
      if (nextMeasure <= measureNum) {
        el.textContent = '🔁 마디 ' + nextMeasure + '/' + totalMeasures;
      }
      return;
    }
    const idx = (startIdx + ci) % total;
    const chord = song.chords[idx];
    const preset = state.preset;
    for (let ni = 0; ni < chord.length; ni++) {
      playNote(chord[ni], vol / Math.max(1, chord.length), dur * 0.9, preset);
    }
    ci++;
    setTimeout(step, interval);
  }
  step();
}

function playAudioSegment(vol) {
  if (!state.audioBuffer) {
    showToast('📂 오디오 파일을 먼저 업로드하세요');
    return;
  }
  const len = state.audioClipLen;
  const idx = state.songIndex % getSegmentCount(state.audioBuffer, len);
  state.songIndex++;
  playSegment(state.audioBuffer, idx, vol, len, state.audioTimeout);
  
  const el = document.getElementById('typeMusicStatus');
  const total = getSegmentCount(state.audioBuffer, len);
  el.textContent = '🎵 마디 ' + (idx+1) + '/' + total;
}

function playFullSongPreview() {
  const songKey = document.getElementById('typeMusicSong').value || state.songKey;
  const song = state.songData[songKey];
  if (!song || !song.chords || !song.chords.length) return;
  if (state.previewTimer) { stopPreview(); return; }
  
  const gs = song.groupSize || 8;
  const totalMeasures = Math.ceil(song.chords.length / gs);
  const maxMeasure = Math.min(20, totalMeasures * 2);
  const interval = (60 / song.bpm) * gs * 1000;
  let m = 0;
  document.getElementById('typeMusicStatus').textContent = '🎵 미리듣기...';
  document.getElementById('typeMusicMidPreviewBtn').textContent = '⏹ 중지';
  
  function step() {
    if (!state.previewTimer || m >= maxMeasure) { 
      stopPreview(); 
      return; 
    }
    if (state.playing) { 
      state.previewTimer = setTimeout(step, 100); 
      return; 
    }
    const vol = state.volume;
    const song = state.songData[songKey];
    const idx = m % song.chords.length;
    const chord = song.chords[idx];
    const dur = 60 / song.bpm;
    for (let ni = 0; ni < chord.length; ni++) {
      playNote(chord[ni], vol / Math.max(1, chord.length), dur * 0.9, state.preset);
    }
    m++;
    state.previewTimer = setTimeout(step, interval);
  }
  state.previewTimer = 1;
  step();
}

export function stopPreview() {
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
  }
  document.getElementById('typeMusicMidPreviewBtn').textContent = '▶ 미리듣기';
  document.getElementById('typeMusicStatus').textContent = '';
}

export function updateAudioClipStatus() {
  const el = document.getElementById('audioClipStatus');
  const total = getSegmentCount(state.audioBuffer, state.audioClipLen);
  if (state.audioBuffer && total > 0) {
    el.textContent = '✓ ' + total + '마디 (' + getDuration(state.audioBuffer).toFixed(1) + 's)';
  } else {
    el.textContent = '';
  }
}

// ============================================================
// UI BINDING
// ============================================================

export function bindTypeMusicUI() {
  // 토글 버튼
  document.getElementById('typeMusicBtn')?.addEventListener('click', () => {
    toggleTypeMusic();
  });
  
  // 모드 변경
  document.getElementById('typeMusicMode')?.addEventListener('change', (e) => {
    setTypeMusicMode(e.target.value);
  });
  
  // 테마 변경
  document.getElementById('typeMusicTheme')?.addEventListener('change', (e) => {
    state.theme = e.target.value;
  });
  
  // 프리셋 변경
  document.getElementById('typeMusicPreset')?.addEventListener('change', (e) => {
    state.preset = e.target.value;
  });
  
  // 악기 변경
  document.getElementById('midiInstrument')?.addEventListener('change', (e) => {
    state.midiInstrument = e.target.value;
    if (state.active) {
      initSoundfont(state.midiInstrument);
    }
  });
  
  // 볼륨
  document.getElementById('typeMusicVol')?.addEventListener('input', (e) => {
    state.volume = parseFloat(e.target.value);
    document.getElementById('typeMusicVolLabel').textContent = Math.round(state.volume * 100) + '%';
  });
  
  // 오디오 클립 길이
  document.getElementById('audioClipLen')?.addEventListener('input', (e) => {
    state.audioClipLen = parseFloat(e.target.value);
    document.getElementById('audioClipLenLabel').textContent = state.audioClipLen + 's';
    if (state.audioBuffer) updateAudioClipStatus();
  });
  
  // 오디오 타임아웃
  document.getElementById('audioTimeout')?.addEventListener('input', (e) => {
    state.audioTimeout = parseFloat(e.target.value);
    document.getElementById('audioTimeoutLabel').textContent = state.audioTimeout + 's';
  });
  
  // 미리듣기 버튼
  document.getElementById('typeMusicMidPreviewBtn')?.addEventListener('click', playPreview);
  
  // 오디오 업로드
  document.getElementById('audioUploadInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      loadAudioFile(ev.target.result).then(() => {
        showToast('✅ 오디오 로드 완료');
      }).catch(() => {
        showToast('❌ 오디오 디코딩 실패');
      });
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  });
  
  // MIDI 업로드
  document.getElementById('midiUploadInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      loadMidiFile(ev.target.result);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  });
}

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.typeMusic = {
  init: initTypeMusic,
  toggle: toggleTypeMusic,
  setMode: setTypeMusicMode,
  handleKey: handleTypeKey,
  loadAudio: loadAudioFile,
  loadMidi: loadMidiFile,
  preview: playPreview,
  stop: stopAll,
  getStatus: getTypeMusicStatus,
  bindUI: bindTypeMusicUI,
  updateAudioClipStatus,
  stopPreview,
  handleAudioUpload: window.handleAudioUpload,
  handleMidiUpload: window.handleMidiUpload
};

export default {
  initTypeMusic,
  toggleTypeMusic,
  setTypeMusicMode,
  handleTypeKey,
  loadAudioFile,
  loadMidiFile,
  playPreview,
  stopAll,
  getTypeMusicStatus,
  bindTypeMusicUI,
  updateAudioClipStatus,
  stopPreview
};

// ============================================================
// LEGACY WRAPPER FUNCTIONS (for HTML onclick handlers)
// ============================================================

window.onTypeMusicModeChange = function() {
  const sel = document.getElementById('typeMusicMode');
  if (window.typeMusic && window.typeMusic.setMode) {
    window.typeMusic.setMode(sel ? sel.value : 'off');
  }
};

window.handleAudioUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    if (window.typeMusic && window.typeMusic.loadAudio) {
      window.typeMusic.loadAudio(ev.target.result).then(() => {
        showToast('✅ 오디오 로드 완료');
      }).catch(() => {
        showToast('❌ 오디오 디코딩 실패');
      });
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
};

window.handleMidiUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    if (window.typeMusic && window.typeMusic.loadMidi) {
      window.typeMusic.loadMidi(ev.target.result);
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
};

window.playTypeMusicDemo = function() {
  if (window.typeMusic && window.typeMusic.preview) {
    window.typeMusic.preview();
  }
};

window.updateAudioClipStatus = function() {
  if (window.typeMusic && window.typeMusic.updateAudioClipStatus) {
    window.typeMusic.updateAudioClipStatus();
  }
};

window.stopTypeMusicPreview = function() {
  if (window.typeMusic && window.typeMusic.stopPreview) {
    window.typeMusic.stopPreview();
  }
};