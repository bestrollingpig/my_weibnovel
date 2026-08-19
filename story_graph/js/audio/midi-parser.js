// ============================================================
// MIDI PARSER - MIDI 파일 파싱
// ============================================================

export function parseMidi(buffer) {
  const data = new Uint8Array(buffer);
  let pos = 0;

  function readBytes(n) {
    const b = data.slice(pos, pos + n);
    pos += n;
    return b;
  }

  function readU16() { 
    const v = (data[pos] << 8) | data[pos+1]; 
    pos += 2; 
    return v; 
  }

  function readU32() { 
    const v = (data[pos]<<24)|(data[pos+1]<<16)|(data[pos+2]<<8)|data[pos+3]; 
    pos += 4; 
    return v; 
  }

  function readVLQ() {
    let v = 0, b;
    do { 
      b = data[pos++]; 
      v = (v << 7) | (b & 0x7F); 
    } while (b & 0x80);
    return v;
  }

  // MThd 확인
  const id = String.fromCharCode(data[0], data[1], data[2], data[3]); 
  pos += 4;
  if (id !== 'MThd') throw new Error('Not a MIDI file');

  const hdrLen = readU32();
  const format = readU16();
  const numTracks = readU16();
  const division = readU16();
  const ppqn = division & 0x8000 ? 0 : division;
  if (!ppqn) throw new Error('SMPTE timing not supported');

  let allNotes = [];
  let bpm = 120;

  // 트랙 파싱
  for (let t = 0; t < numTracks; t++) {
    const tid = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]); 
    pos += 4;
    if (tid !== 'MTrk') throw new Error('Expected MTrk');

    const trkLen = readU32();
    const end = pos + trkLen;
    let tick = 0;
    let lastStatus = 0;

    while (pos < end) {
      const delta = readVLQ();
      tick += delta;
      let status = data[pos];
      if (status < 0x80) { 
        status = lastStatus; 
      } else { 
        lastStatus = status; 
        pos++; 
      }

      const eventType = status & 0xF0;
      const channel = status & 0x0F;

      if (eventType === 0x90) {
        // Note On
        const note = data[pos++];
        const vel = data[pos++];
        if (channel !== 9 && vel > 0) {
          allNotes.push({ note: note, tick: tick });
        }
      } else if (eventType === 0x80) {
        // Note Off
        const note = data[pos++];
        data[pos++]; // velocity
        if (channel !== 9) {
          // Note Off은 무시 (Note On만 사용)
        }
      } else if (status === 0xFF) {
        // Meta event
        const metaType = data[pos++];
        const len = readVLQ();
        if (metaType === 0x51 && len >= 3) {
          // Tempo
          const mpqn = (data[pos]<<16)|(data[pos+1]<<8)|data[pos+2];
          bpm = Math.round(60000000 / mpqn);
        }
        pos += len;
      } else if (status === 0xF0 || status === 0xF7) {
        // SysEx
        const len = readVLQ();
        pos += len;
      } else {
        // Other events
        let skip = 0;
        if (eventType === 0xC0 || eventType === 0xD0) skip = 1;
        else if (eventType === 0xE0 || eventType === 0xB0 || eventType === 0xA0) skip = 2;
        pos += skip;
      }
    }
  }

  if (allNotes.length === 0) throw new Error('No notes found in MIDI');

  // 노트 정렬
  allNotes.sort(function(a, b) { return a.tick - b.tick; });

  // 코드 그룹화 (같은 tick의 노트들을 묶음)
  const chords = [];
  let curTick = -1;
  let curChord = [];

  allNotes.forEach(function(n) {
    if (n.tick !== curTick) {
      if (curChord.length) {
        chords.push(curChord);
      }
      curTick = n.tick;
      curChord = [n.note];
    } else {
      curChord.push(n.note);
    }
  });
  if (curChord.length) chords.push(curChord);

  return { 
    chords: chords, 
    bpm: bpm,
    groupSize: 8,
    totalNotes: allNotes.length
  };
}

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.midiParser = {
  parseMidi
};

export default {
  parseMidi
};