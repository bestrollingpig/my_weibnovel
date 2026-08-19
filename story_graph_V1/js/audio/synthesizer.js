// ============================================================
// SYNTHESIZER - Web Audio 합성 엔진
// ============================================================

let audioContext = null;
let reverb = null;

// ============================================================
// AUDIO CONTEXT
// ============================================================

export function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// ============================================================
// REVERB
// ============================================================

function initReverb() {
  if (reverb) return;
  const ctx = getAudioContext();
  const len = ctx.sampleRate * 1.2;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
  }
  reverb = ctx.createConvolver();
  reverb.buffer = buf;
  reverb.connect(ctx.destination);
}

// ============================================================
// PIANO NOTE
// ============================================================

export function playPianoNote(freq, vol, duration, preset) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const dur = Math.max(0.08, duration || 0.3);

  const masterGain = ctx.createGain();
  masterGain.gain.value = vol * 0.5;
  masterGain.connect(ctx.destination);

  initReverb();
  const revGain = ctx.createGain();
  revGain.gain.value = 0.15;

  let partials;
  if (preset === 'epiano') {
    partials = [[1,1,0],[2,0.6,0.02],[3,0.3,0.04],[4,0.15,0.06]];
  } else if (preset === 'harpsichord') {
    partials = [[1,1,0],[2,0.5,0.01],[3,0.25,0.02],[4,0.12,0.03],[5,0.08,0.04]];
  } else if (preset === 'musicbox') {
    partials = [[1,1,0],[2,0.7,0.01],[3,0.4,0.02],[5,0.2,0.03]];
  } else {
    partials = [[1,1,0],[2,0.5,0.015],[3,0.25,0.03],[4,0.12,0.05],[5,0.06,0.07],[6,0.03,0.09]];
  }

  const veloc = Math.min(1, vol * 1.5);

  partials.forEach(function(p) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq * p[0];
    o.detune.value = (Math.random() - 0.5) * 3;

    const g = ctx.createGain();
    const attack = 0.004;
    const decay = 0.03 + p[2];
    const sustain = preset === 'harpsichord' ? 0 : 0.08 * p[1];
    const release = dur * 0.7;

    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(veloc * p[1] * 0.7, now + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, veloc * p[1] * sustain), now + decay);
    g.gain.exponentialRampToValueAtTime(0.001, now + decay + release);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3000 + veloc * 4000;
    f.Q.value = 0.5;

    o.connect(g);
    g.connect(f);
    f.connect(masterGain);
    f.connect(revGain);

    o.start(now);
    o.stop(now + decay + release + 0.1);
  });

  revGain.connect(reverb);
  
  setTimeout(function() {
    try { revGain.disconnect(); } catch(e) {}
  }, (dur + 0.5) * 1000);
}

// ============================================================
// KEYBOARD SOUND
// ============================================================

export function playKeyboardSound(key, vol) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;

  // 기계식 키보드
  const o1 = ctx.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = 2500 + Math.random() * 1500;
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(vol * 0.25, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.01);
  o1.connect(g1);
  g1.connect(ctx.destination);
  o1.start(now);
  o1.stop(now + 0.015);

  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = 80 + Math.random() * 40;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(vol * 0.35, now + 0.005);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  o2.connect(g2);
  g2.connect(ctx.destination);
  o2.start(now + 0.005);
  o2.stop(now + 0.05);

  // 타자기 소리 추가
  const o3 = ctx.createOscillator();
  o3.type = 'square';
  o3.frequency.value = 200 + Math.random() * 400;
  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(vol * 0.08, now + 0.01);
  g3.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  o3.connect(g3);
  g3.connect(ctx.destination);
  o3.start(now + 0.01);
  o3.stop(now + 0.07);
}

// ============================================================
// IMPROV NOTE
// ============================================================

export function playImprovNote(key, vol) {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  
  // 스케일
  const scale = [60, 62, 64, 67, 69, 72, 74, 76, 79, 84];
  let idx = Math.floor(Math.random() * scale.length);
  if (key === 'Enter') idx = scale.length - 1;
  if (key === ' ') idx = Math.floor(scale.length / 2);
  const note = scale[idx];
  
  const freq = 440 * Math.pow(2, (note - 69) / 12);
  const dur = 0.15 + Math.random() * 0.15;
  
  // 메인 음
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol * 0.3, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  o.connect(g);
  g.connect(ctx.destination);
  o.start(now);
  o.stop(now + dur + 0.05);
  
  // 하모닉스
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(vol * 0.08, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.8);
  o2.connect(g2);
  g2.connect(ctx.destination);
  o2.start(now);
  o2.stop(now + dur * 0.8 + 0.05);
}

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.synthesizer = {
  getAudioContext,
  playPianoNote,
  playKeyboardSound,
  playImprovNote,
  initReverb
};

export default {
  getAudioContext,
  playPianoNote,
  playKeyboardSound,
  playImprovNote,
  initReverb
};