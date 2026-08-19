// ============================================================
// EDITOR - 편집기 코어, 파일 관리, 찾기/바꾸기, 스냅샷 등
// ============================================================

import { state } from './state.js';
import { showToast } from './app.js';
import { loadGraphForCurrentFile, syncCytoscapeFromNodes, updateGraphCounts } from './graph.js';
import { applyGraphData } from './modules.js';

// ============================================================
// FILE MANAGEMENT
// ============================================================

export async function openFile(name, handle) {
  try {
    state.currentFileHandle = handle;
    state.currentFileName = name;
    const file = await handle.getFile();
    const text = await file.text();
    const editor = document.getElementById('editor');
    editor.contentEditable = 'true';
    editor.classList.remove('empty-state');
    editor.innerText = text;
    document.getElementById('filePathDisplay').textContent = `${state.dirHandle.name}/${name}`;
    document.getElementById('statusText').textContent = `📄 ${name}`;
    document.getElementById('charCount').textContent = `📝 글자: ${text.length}`;
    await refreshFileList();
    await loadGraphForCurrentFile();
  } catch (e) { 
    showToast('파일 읽기 오류: ' + e.message);
  }
}

export async function saveCurrentFile() {
  if (!state.dirHandle || !state.currentFileHandle) return;
  try {
    const editor = document.getElementById('editor');
    const w = await state.currentFileHandle.createWritable();
    await w.write(editor.innerText);
    await w.close();
    document.getElementById('statusText').textContent = `💾 ${state.currentFileName}`;
  } catch (e) {}
}

export async function saveAsFile() {
  if (!state.dirHandle) { 
    showToast('폴더를 먼저 연결하세요.'); 
    return; 
  }
  const name = prompt('파일 이름:', state.currentFileName || '문서.txt');
  if (!name) return;
  const clean = name.endsWith('.txt') || name.endsWith('.md') ? name : name + '.txt';
  try {
    const fh = await state.dirHandle.getFileHandle(clean, { create: true });
    const w = await fh.createWritable();
    const editor = document.getElementById('editor');
    await w.write(editor.innerText);
    await w.close();
    state.currentFileHandle = fh;
    state.currentFileName = clean;
    await refreshFileList();
    showToast('💾 저장 완료: ' + clean);
  } catch (e) { 
    showToast('저장 실패: ' + e.message);
  }
}

export async function createNewDocument() {
  if (!state.dirHandle) return;
  const name = prompt('파일 이름:', '새파일.txt');
  if (!name) return;
  const clean = name.endsWith('.txt') || name.endsWith('.md') ? name : name + '.txt';
  try {
    const fh = await state.dirHandle.getFileHandle(clean, { create: true });
    const w = await fh.createWritable();
    await w.write('');
    await w.close();
    await openFile(clean, fh);
  } catch (e) { 
    showToast('생성 실패: ' + e.message);
  }
}

export async function deleteFile(name, event) {
  event.stopPropagation();
  if (!confirm(`'${name}'을(를) 삭제하시겠습니까?`)) return;
  try {
    await state.dirHandle.removeEntry(name);
    if (state.currentFileName === name) {
      state.currentFileName = null;
      state.currentFileHandle = null;
      const editor = document.getElementById('editor');
      editor.contentEditable = 'false';
      editor.classList.add('empty-state');
      editor.innerHTML = `<h3>📂 파일을 선택하세요</h3>`;
      state.nodes.clear();
      state.edges = [];
      updateGraphCounts();
    }
    await refreshFileList();
  } catch (e) { 
    showToast('삭제 실패: ' + e.message);
  }
}

export async function refreshFileList() {
  const listEl = document.getElementById('fileList');
  listEl.innerHTML = '';
  let count = 0;
  const files = [];
  for await (const [name, handle] of state.dirHandle.entries()) {
    if (handle.kind === 'file' && /\.(txt|md)$/i.test(name)) {
      count++;
      files.push({ name, handle });
    }
  }
  document.getElementById('docCount').textContent = `(${count})`;
  if (count === 0) {
    listEl.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:12px;padding:20px;">📂 파일이 없습니다</div>`;
    return;
  }
  files.sort((a,b) => a.name.localeCompare(b.name));
  for (const { name, handle } of files) {
    const hasGraph = await hasGraphFile(name);
    const item = document.createElement('div');
    item.className = 'filelist-item';
    if (name === state.currentFileName) item.classList.add('active');
    item.onclick = () => openFile(name, handle);
    item.innerHTML = `
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        📄 ${name} ${hasGraph ? '<span class="has-graph">📊</span>' : ''}
      </span>
      <button class="delete-btn" onclick="window.editor.deleteFile('${name}', event)">✕</button>
    `;
    listEl.appendChild(item);
  }
  if (!state.currentFileName && files.length > 0) {
    openFile(files[0].name, files[0].handle);
  }
}

async function hasGraphFile(fileName) {
  try {
    const analysisDir = await state.dirHandle.getDirectoryHandle('.analysis', { create: true });
    const jsonName = fileName.replace(/\.(txt|md)$/, '.graph.json');
    await analysisDir.getFileHandle(jsonName);
    return true;
  } catch { return false; }
}

// ============================================================
// EDITOR COMMANDS
// ============================================================

export function execCmd(cmd, val) {
  if (cmd === 'save') { saveCurrentFile(); return; }
  document.execCommand(cmd, false, val);
}

// ============================================================
// ZOOM
// ============================================================

export function zoomEditor(delta) {
  state.zoomPercent = Math.max(50, Math.min(200, state.zoomPercent + delta));
  const editor = document.getElementById('editor');
  editor.style.fontSize = (15 * state.zoomPercent / 100) + 'px';
  document.getElementById('zoomLevel').textContent = state.zoomPercent + '%';
}

export function zoomReset() {
  state.zoomPercent = 100;
  const editor = document.getElementById('editor');
  editor.style.fontSize = '15px';
  document.getElementById('zoomLevel').textContent = '100%';
}

// ============================================================
// LINE/COLUMN INDICATOR
// ============================================================

export function updateLineCol() {
  const editor = document.getElementById('editor');
  const sel = window.getSelection();
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    document.getElementById('lineColIndicator').textContent = '줄 1, 열 1';
    return;
  }
  const text = editor.innerText;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(editor);
  preRange.setEnd(range.startContainer, range.startOffset);
  const caretPos = preRange.toString().length;
  const before = text.substring(0, caretPos);
  const line = (before.match(/\n/g) || []).length + 1;
  const lastNewline = before.lastIndexOf('\n');
  const col = caretPos - lastNewline;
  document.getElementById('lineColIndicator').textContent = `줄 ${line}, 열 ${col}`;
}

// ============================================================
// FIND INLINE
// ============================================================

export function toggleFindInline() {
  const bar = document.getElementById('findInline');
  bar.classList.toggle('open');
  if (bar.classList.contains('open')) {
    document.getElementById('findInput').value = '';
    document.getElementById('findInput').focus();
    state.findResults = [];
    state.findCurrentIdx = -1;
    document.getElementById('findCount').textContent = '';
  } else {
    clearFindHighlights();
  }
}

export function closeFindInline() {
  document.getElementById('findInline').classList.remove('open');
  clearFindHighlights();
}

function clearFindHighlights() {
  const marks = document.querySelectorAll('.find-highlight');
  marks.forEach(function(m) {
    const parent = m.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    }
  });
  state.findResults = [];
  state.findCurrentIdx = -1;
}

export function doFindInDoc() {
  const query = document.getElementById('findInput').value;
  clearFindHighlights();
  if (!query) { 
    document.getElementById('findCount').textContent = ''; 
    return; 
  }

  const el = state.splitActive ? document.getElementById('splitEditor') : document.getElementById('editor');
  if (!el) return;
  const text = el.innerText || el.textContent || '';
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let idx = 0;
  state.findResults = [];
  while ((idx = lower.indexOf(qLower, idx)) !== -1) {
    state.findResults.push(idx);
    idx += query.length;
  }

  if (state.findResults.length === 0) {
    document.getElementById('findCount').textContent = '0/0';
    return;
  }

  let html = '';
  let last = 0;
  state.findResults.forEach(function(pos) {
    html += escapeHtml(text.substring(last, pos));
    html += '<span class="find-highlight">' + escapeHtml(text.substring(pos, pos + query.length)) + '</span>';
    last = pos + query.length;
  });
  html += escapeHtml(text.substring(last));
  el.innerHTML = html;
  state.findCurrentIdx = 0;
  updateFindCurrent();
  document.getElementById('findCount').textContent = '1/' + state.findResults.length;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateFindCurrent() {
  const marks = document.querySelectorAll('.find-highlight');
  marks.forEach(function(m, i) {
    m.classList.toggle('current', i === state.findCurrentIdx);
    if (i === state.findCurrentIdx) m.scrollIntoView({ block: 'center' });
  });
}

export function doFindNext() {
  if (state.findResults.length === 0) return;
  state.findCurrentIdx = (state.findCurrentIdx + 1) % state.findResults.length;
  updateFindCurrent();
  document.getElementById('findCount').textContent = (state.findCurrentIdx + 1) + '/' + state.findResults.length;
}

export function doFindPrev() {
  if (state.findResults.length === 0) return;
  state.findCurrentIdx = (state.findCurrentIdx - 1 + state.findResults.length) % state.findResults.length;
  updateFindCurrent();
  document.getElementById('findCount').textContent = (state.findCurrentIdx + 1) + '/' + state.findResults.length;
}

// ============================================================
// SPLIT MODE
// ============================================================

export function toggleSplitMode() {
  state.splitActive = !state.splitActive;
  const container = document.getElementById('splitContainer');
  const mainContainer = document.getElementById('mainPaperContainer');
  const editor = document.getElementById('editor');
  const splitEditor = document.getElementById('splitEditor');
  const btn = document.getElementById('splitToggleBtn');

  if (state.splitActive) {
    container.style.display = 'flex';
    mainContainer.style.display = 'none';
    splitEditor.innerText = editor.innerText;
    splitEditor.contentEditable = 'true';
    btn.textContent = '📖 분할 ON';
    btn.style.borderColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
    populateSplitRefFiles();
  } else {
    container.style.display = 'none';
    mainContainer.style.display = 'flex';
    editor.innerText = splitEditor.innerText;
    btn.textContent = '📖 분할';
    btn.style.borderColor = '';
    btn.style.color = '';
  }
}

async function populateSplitRefFiles() {
  const sel = document.getElementById('splitRefFileSelect');
  sel.innerHTML = '<option value="">참고 파일 선택</option>';
  if (!state.dirHandle) return;
  const files = [];
  for await (const [name, handle] of state.dirHandle.entries()) {
    if (handle.kind === 'file' && /\.(txt|md)$/i.test(name)) {
      files.push(name);
    }
  }
  files.sort((a,b) => a.localeCompare(b));
  files.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    if (f.toLowerCase().includes('참고')) opt.selected = true;
    sel.appendChild(opt);
  });
  if (sel.value) loadSplitRefFile(sel.value);
}

export async function loadSplitRefFile(name) {
  const refEditor = document.getElementById('splitRefEditor');
  if (!name || !state.dirHandle) {
    refEditor.innerText = '참고할 파일을 선택하세요.';
    return;
  }
  try {
    const handle = await state.dirHandle.getFileHandle(name);
    const file = await handle.getFile();
    const text = await file.text();
    refEditor.innerText = text;
    showToast('📖 참고 파일 로드: ' + name);
  } catch (e) {
    refEditor.innerText = '❌ 파일 읽기 실패: ' + e.message;
  }
}

// ============================================================
// TYPEWRITER MODE
// ============================================================

export function toggleTypewriterMode() {
  state.typewriterActive = !state.typewriterActive;
  document.body.classList.toggle('typewriter-active', state.typewriterActive);
  showToast(state.typewriterActive ? '⌨️ 타자기 모드 ON' : '⌨️ 타자기 모드 OFF');
}

// ============================================================
// BACKUP
// ============================================================

export async function createBackup() {
  if (!state.dirHandle || !state.currentFileHandle) { 
    showToast('⚠️ 저장할 파일이 없습니다.'); 
    return; 
  }
  try {
    const backupDir = await state.dirHandle.getDirectoryHandle('.backup', { create: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const editor = document.getElementById('editor');
    const backupName = state.currentFileName.replace(/\.(txt|md)$/, '') + '_' + ts + '.txt';
    const fh = await backupDir.getFileHandle(backupName, { create: true });
    const w = await fh.createWritable();
    await w.write(editor.innerText);
    await w.close();
    showToast('💾 백업 완료: .backup/' + backupName);
  } catch (e) {
    showToast('⚠️ 백업 실패: ' + e.message);
  }
}

// ============================================================
// SNAPSHOT
// ============================================================

let snapshots = [];

function loadSnapshots() {
  try { snapshots = JSON.parse(localStorage.getItem('editor_snapshots') || '[]'); } 
  catch(e) { snapshots = []; }
}

function saveSnapshots() {
  if (snapshots.length > 50) snapshots = snapshots.slice(-50);
  localStorage.setItem('editor_snapshots', JSON.stringify(snapshots));
}

export function showSnapshotDialog() {
  loadSnapshots();
  document.getElementById('snapshotOverlay').classList.add('open');
  document.getElementById('snapshotLabelInput').value = '';
  renderSnapshots();
}

export function closeSnapshotDialog() {
  document.getElementById('snapshotOverlay').classList.remove('open');
}

export function saveSnapshot() {
  const label = document.getElementById('snapshotLabelInput').value.trim();
  if (!label) { showToast('⚠️ 스냅샷 이름을 입력하세요.'); return; }
  const editor = document.getElementById('editor');
  const content = state.splitActive 
    ? (document.getElementById('splitEditor')?.innerText || '') 
    : (editor.innerText || '');
  if (!content) { showToast('⚠️ 저장할 내용이 없습니다.'); return; }
  snapshots.push({
    id: Date.now(),
    label: label,
    content: content,
    charCount: content.length,
    date: new Date().toLocaleString('ko-KR')
  });
  saveSnapshots();
  renderSnapshots();
  document.getElementById('snapshotLabelInput').value = '';
  showToast('✅ "' + label + '" 스냅샷 저장 완료');
}

function renderSnapshots() {
  const list = document.getElementById('snapshotList');
  if (snapshots.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px;">저장된 스냅샷이 없습니다.</div>';
    return;
  }
  let html = '';
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i];
    html += `<div class="snapshot-item">
      <div class="info">
        <div class="label">${s.label}</div>
        <div class="meta">${s.date} · ${s.charCount}자</div>
      </div>
      <div class="actions">
        <button onclick="window.editor.restoreSnapshot(${i})" class="primary" style="font-size:10px;padding:2px 8px;">복원</button>
        <button onclick="window.editor.deleteSnapshot(${i})" style="font-size:10px;padding:2px 8px;border-color:#ff6b6b;color:#ff6b6b;">삭제</button>
      </div>
    </div>`;
  }
  list.innerHTML = html;
}

export function restoreSnapshot(idx) {
  if (!confirm('"' + snapshots[idx].label + '" 스냅샷으로 복원하시겠습니까?\n현재 내용은 사라집니다.')) return;
  const content = snapshots[idx].content;
  if (state.splitActive) {
    const el = document.getElementById('splitEditor');
    if (el) el.innerText = content;
  } else {
    const editor = document.getElementById('editor');
    editor.innerText = content;
  }
  showToast('✅ "' + snapshots[idx].label + '" 스냅샷 복원 완료');
  closeSnapshotDialog();
}

export function deleteSnapshot(idx) {
  if (!confirm('"' + snapshots[idx].label + '" 스냅샷을 삭제하시겠습니까?')) return;
  snapshots.splice(idx, 1);
  saveSnapshots();
  renderSnapshots();
  showToast('🗑️ 스냅샷 삭제됨');
}

// ============================================================
// DOC STATISTICS
// ============================================================

export function showDocStats() {
  const editor = document.getElementById('editor');
  const text = state.splitActive 
    ? (document.getElementById('splitEditor')?.innerText || '') 
    : (editor.innerText || editor.textContent || '');
  if (!text) { showToast('⚠️ 통계를 낼 내용이 없습니다.'); return; }

  const chars = text.length;
  const charsNoSpace = text.replace(/\s/g, '').length;
  const words = text.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
  const lines = text.split('\n').length;
  const paragraphs = text.split(/\n\s*\n/).filter(function(p) { return p.trim().length > 0; }).length;
  const sentences = text.split(/[.!?…]+\s*/).filter(function(s) { return s.trim().length > 0; }).length;
  const readTime = Math.max(1, Math.round(chars / 500));
  const readTimeLabel = readTime < 60 ? readTime + '분' : Math.floor(readTime / 60) + '시간 ' + (readTime % 60) + '분';
  const uniqueWords = new Set(words.map(function(w) { return w.toLowerCase(); })).size;

  let html = '<div style="font-size:13px;color:var(--text);">';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  const stats = [
    ['📝 전체 글자 수', chars.toLocaleString()],
    ['🔤 공백 제외', charsNoSpace.toLocaleString()],
    ['📖 단어 수', words.toLocaleString()],
    ['🔤 고유 단어', uniqueWords.toLocaleString()],
    ['📄 문단 수', paragraphs.toLocaleString()],
    ['📏 문장 수', sentences.toLocaleString()],
    ['📃 줄 수', lines.toLocaleString()],
    ['⏱ 예상 읽기 시간', readTimeLabel],
  ];
  stats.forEach(function(s) {
    html += `<tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--muted);">${s[0]}</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;font-weight:600;">${s[1]}</td></tr>`;
  });
  html += '</table></div>';

  const container = document.getElementById('critiqueResult');
  container.innerHTML = '<div style="margin-bottom:6px;font-weight:600;font-size:14px;">📊 문서 통계</div>' + html;
  container.classList.add('show');
  showToast('📊 문서 통계');
}

// ============================================================
// EDITOR AUTO-SAVE
// ============================================================

let saveTimer = null;

export function setupAutoSave() {
  const editor = document.getElementById('editor');
  editor.addEventListener('input', () => {
    if (!state.dirHandle) return;
    document.getElementById('saveStatus').textContent = '⏳ 변경 중...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await saveCurrentFile();
      document.getElementById('saveStatus').textContent = '💾 저장됨';
      // 자동 백업 (30% 확률)
      if (state.dirHandle && state.currentFileHandle && Math.random() < 0.3) {
        try {
          const backupDir = await state.dirHandle.getDirectoryHandle('.backup', { create: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const backupName = state.currentFileName.replace(/\.(txt|md)$/, '') + '_auto_' + ts + '.txt';
          const fh = await backupDir.getFileHandle(backupName, { create: true });
          const w = await fh.createWritable();
          await w.write(editor.innerText);
          await w.close();
        } catch (e) {}
      }
    }, 800);
    const text = editor.innerText;
    document.getElementById('charCount').textContent = '📝 글자: ' + text.length;
    updateLineCol();
  });
  
  // splitEditor에도 적용
  const splitEditor = document.getElementById('splitEditor');
  if (splitEditor) {
    splitEditor.addEventListener('input', () => {
      if (!state.dirHandle) return;
      document.getElementById('saveStatus').textContent = '⏳ 변경 중...';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        await saveCurrentFile();
        document.getElementById('saveStatus').textContent = '💾 저장됨';
      }, 800);
      const text = splitEditor.innerText;
      document.getElementById('charCount').textContent = '📝 글자: ' + text.length;
      updateLineCol();
    });
  }
}

// ============================================================
// EDITOR TTS (텍스트 읽어주기)
// ============================================================

let editorTtsVisible = false;
let editorTtsVoices = [];
let editorTtsStopped = false;

export function toggleEditorTts() {
  editorTtsVisible = !editorTtsVisible;
  document.getElementById('editorTtsPanel').style.display = editorTtsVisible ? 'block' : 'none';
  document.getElementById('editorTtsBtn').style.borderColor = editorTtsVisible ? 'var(--c-event)' : '';
  if (editorTtsVisible) loadEditorTtsVoices();
}

function loadEditorTtsVoices() {
  if (typeof speechSynthesis === 'undefined') return;
  editorTtsVoices = speechSynthesis.getVoices();
  const sel = document.getElementById('editorTtsVoice');
  if (!sel) return;
  sel.innerHTML = '<option value="">기본 음성</option>';
  if (editorTtsVoices.length === 0) {
    speechSynthesis.onvoiceschanged = loadEditorTtsVoices;
    return;
  }
  editorTtsVoices.forEach(function(v) {
    sel.add(new Option(v.name + ' (' + v.lang + ')', v.name));
  });
}

export function readEditorText() {
  if (typeof speechSynthesis === 'undefined') { 
    showToast('⚠️ TTS 미지원 브라우저'); 
    return; 
  }
  speechSynthesis.cancel();
  editorTtsStopped = false;
  const editor = document.getElementById('editor');
  const text = state.splitActive 
    ? (document.getElementById('splitEditor')?.innerText || '') 
    : (editor.innerText || editor.textContent || '');
  if (!text || text.trim().length < 5) { 
    showToast('⚠️ 읽을 내용이 없습니다.'); 
    return; 
  }

  const voiceName = document.getElementById('editorTtsVoice').value;
  const speed = parseFloat(document.getElementById('editorTtsSpeed').value) || 0.9;
  const isAudiobook = document.getElementById('editorTtsAudiobook').checked;
  const status = document.getElementById('editorTtsStatus');
  status.textContent = '🔊 읽는 중...';

  const paragraphs = text.split(/\n\s*\n/).filter(function(p) { return p.trim().length > 0; });
  if (paragraphs.length === 0) paragraphs = [text];
  let idx = 0;

  function speakNext() {
    if (editorTtsStopped) { 
      status.textContent = '⏹ 정지됨'; 
      return; 
    }
    if (idx >= paragraphs.length) { 
      status.textContent = '✅ 완료'; 
      return; 
    }
    const p = paragraphs[idx].trim();
    if (p.length < 2) { idx++; speakNext(); return; }
    const utter = new SpeechSynthesisUtterance(p);
    if (voiceName) {
      const v = editorTtsVoices.find(function(vv) { return vv.name === voiceName; });
      if (v) utter.voice = v;
    }
    utter.rate = speed;
    utter.lang = 'ko-KR';
    utter.onend = function() {
      if (editorTtsStopped) return;
      idx++;
      if (isAudiobook && idx < paragraphs.length) {
        status.textContent = '🔊 ' + idx + '/' + paragraphs.length;
        setTimeout(function() { 
          if (!editorTtsStopped) speakNext(); 
        }, 500);
      } else { speakNext(); }
    };
    utter.onerror = function() {
      if (editorTtsStopped) return;
      idx++;
      speakNext();
    };
    speechSynthesis.speak(utter);
  }
  speakNext();
}

export function stopEditorTts() {
  editorTtsStopped = true;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  document.getElementById('editorTtsStatus').textContent = '⏹ 정지됨';
}

// ============================================================
// FIND/REPLACE IN ALL FILES
// ============================================================

export function showFindReplace() {
  document.getElementById('findReplaceOverlay').classList.add('open');
}
export function closeFindReplace() {
  document.getElementById('findReplaceOverlay').classList.remove('open');
  document.getElementById('frResult').textContent = '';
}

export async function findInAllFiles() {
  const query = document.getElementById('frFind').value.trim();
  if (!query) { showToast('⚠️ 찾을 단어를 입력하세요.'); return; }
  const resultEl = document.getElementById('frResult');
  resultEl.textContent = '🔍 검색 중...';
  let count = 0;
  let fileMatches = [];
  try {
    for await (const [name, handle] of state.dirHandle.entries()) {
      if (handle.kind !== 'file' || !/\.(txt|md)$/i.test(name)) continue;
      const file = await handle.getFile();
      const text = await file.text();
      const lower = text.toLowerCase();
      const qLower = query.toLowerCase();
      let idx = 0;
      let fileCount = 0;
      while ((idx = lower.indexOf(qLower, idx)) !== -1) {
        fileCount++;
        idx += query.length;
      }
      if (fileCount > 0) {
        count += fileCount;
        fileMatches.push(`${name} (${fileCount}회)`);
      }
    }
  } catch (e) { resultEl.textContent = '❌ 오류: ' + e.message; return; }
  if (count === 0) {
    resultEl.textContent = '❌ 일치하는 결과가 없습니다.';
  } else {
    resultEl.textContent = `✅ ${count}개 일치 (${fileMatches.join(', ')})`;
  }
}

export async function replaceInAllFiles() {
  const find = document.getElementById('frFind').value.trim();
  const replace = document.getElementById('frReplace').value;
  if (!find) { showToast('⚠️ 찾을 단어를 입력하세요.'); return; }
  if (!confirm(`'${find}' → '${replace}' 로 모든 파일에서 바꾸시겠습니까?`)) return;
  const resultEl = document.getElementById('frResult');
  resultEl.textContent = '🔄 바꾸는 중...';
  let totalCount = 0;
  let modifiedFiles = [];
  try {
    for await (const [name, handle] of state.dirHandle.entries()) {
      if (handle.kind !== 'file' || !/\.(txt|md)$/i.test(name)) continue;
      const file = await handle.getFile();
      const text = await file.text();
      if (!text.includes(find)) continue;
      const newText = text.split(find).join(replace);
      const w = await handle.createWritable();
      await w.write(newText);
      await w.close();
      const changes = (text.match(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      totalCount += changes;
      modifiedFiles.push(name + '(' + changes + '회)');
    }
  } catch (e) { resultEl.textContent = '❌ 오류: ' + e.message; return; }
  if (totalCount === 0) {
    resultEl.textContent = '❌ 일치하는 결과가 없습니다.';
  } else {
    resultEl.textContent = `✅ ${totalCount}개 바꿈 (${modifiedFiles.join(', ')})`;
    showToast(`✅ ${totalCount}개 바꿈 완료`);
    if (state.currentFileHandle) {
      const editor = document.getElementById('editor');
      const file = await state.currentFileHandle.getFile();
      editor.innerText = await file.text();
    }
  }
}

// ============================================================
// MERGE / SPLIT
// ============================================================

export function showMergeSplit() {
  document.getElementById('mergeOverlay').classList.add('open');
  showMergeView();
}

export function closeMergeSplit() {
  document.getElementById('mergeOverlay').classList.remove('open');
  document.getElementById('mergeResult').textContent = '';
}

export function showMergeView() {
  document.getElementById('mergeTitle').textContent = '📄 문서 합치기';
  document.getElementById('mergeOptions').style.display = 'block';
  document.getElementById('splitOptions').style.display = 'none';
  document.getElementById('mergeExecBtn').style.display = 'inline-flex';
  document.getElementById('splitExecBtn').style.display = 'none';
  populateMergeFileList();
}

export function showSplitView() {
  document.getElementById('mergeTitle').textContent = '✂️ 문서 분할하기';
  document.getElementById('mergeOptions').style.display = 'none';
  document.getElementById('splitOptions').style.display = 'block';
  document.getElementById('mergeExecBtn').style.display = 'none';
  document.getElementById('splitExecBtn').style.display = 'inline-flex';
  populateSplitFileSelect();
}

async function populateMergeFileList() {
  const container = document.getElementById('mergeFileList');
  container.innerHTML = '';
  if (!state.dirHandle) return;
  for await (const [name, handle] of state.dirHandle.entries()) {
    if (handle.kind !== 'file' || !/\.(txt|md)$/i.test(name)) continue;
    const label = document.createElement('label');
    label.className = 'file-check';
    label.innerHTML = `<input type="checkbox" value="${name}" checked> ${name}`;
    container.appendChild(label);
  }
}

function populateSplitFileSelect() {
  const sel = document.getElementById('splitFileSelect');
  sel.innerHTML = '';
  if (!state.dirHandle) return;
  (async () => {
    for await (const [name, handle] of state.dirHandle.entries()) {
      if (handle.kind !== 'file' || !/\.(txt|md)$/i.test(name)) continue;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
  })();
}

export async function executeMerge() {
  if (!state.dirHandle) { showToast('⚠️ 폴더가 연결되지 않았습니다.'); return; }
  const order = document.getElementById('mergeOrder').value.trim();
  if (!order) { showToast('⚠️ 파일 순서를 입력하세요.'); return; }
  const names = order.split(',').map(s => s.trim()).filter(Boolean);
  const resultEl = document.getElementById('mergeResult');
  resultEl.textContent = '🔄 합치는 중...';
  let merged = '';
  try {
    for (const name of names) {
      const handle = await state.dirHandle.getFileHandle(name);
      const file = await handle.getFile();
      const text = await file.text();
      merged += (merged ? '\n\n' : '') + text;
    }
    const outName = 'merged_' + new Date().toISOString().slice(0,10) + '.txt';
    const outHandle = await state.dirHandle.getFileHandle(outName, { create: true });
    const w = await outHandle.createWritable();
    await w.write(merged);
    await w.close();
    resultEl.textContent = `✅ ${names.length}개 파일 → '${outName}' (${merged.length}자)`;
    showToast('✅ 병합 완료!');
  } catch (e) { resultEl.textContent = '❌ 오류: ' + e.message; }
}

export async function executeSplit() {
  if (!state.dirHandle) { showToast('⚠️ 폴더가 연결되지 않았습니다.'); return; }
  const sel = document.getElementById('splitFileSelect');
  const name = sel.value;
  const size = parseInt(document.getElementById('splitSize').value) || 1000;
  if (!name) { showToast('⚠️ 분할할 파일을 선택하세요.'); return; }
  const resultEl = document.getElementById('mergeResult');
  resultEl.textContent = '🔄 분할하는 중...';
  try {
    const handle = await state.dirHandle.getFileHandle(name);
    const file = await handle.getFile();
    const text = await file.text();
    const baseName = name.replace(/\.(txt|md)$/, '');
    for (let i = 0; i < text.length; i += size) {
      const chunk = text.substring(i, i + size);
      const partName = baseName + `_part${Math.floor(i/size)+1}.txt`;
      const partHandle = await state.dirHandle.getFileHandle(partName, { create: true });
      const w = await partHandle.createWritable();
      await w.write(chunk);
      await w.close();
    }
    const parts = Math.ceil(text.length / size);
    resultEl.textContent = `✅ '${name}' → ${parts}개 파일로 분할됨`;
    showToast('✅ 분할 완료!');
  } catch (e) { resultEl.textContent = '❌ 오류: ' + e.message; }
}

// ============================================================
// MOBILE PREVIEW
// ============================================================

export function toggleMobilePreview() {
  const overlay = document.getElementById('mobilePreviewOverlay');
  overlay.classList.toggle('open');
  if (overlay.classList.contains('open')) updateMobilePreview();
}

export function closeMobilePreview() {
  document.getElementById('mobilePreviewOverlay').classList.remove('open');
}

export function updateMobilePreview() {
  const editor = document.getElementById('editor');
  const text = state.splitActive 
    ? (document.getElementById('splitEditor')?.innerText || '') 
    : (editor.innerText || '');
  const theme = document.getElementById('mobilePreviewTheme')?.value || 'light';
  const frame = document.getElementById('mobilePhoneFrame');
  const content = document.getElementById('mobilePreviewContent');
  if (!content) return;
  content.textContent = text;
  document.getElementById('mobilePreviewChars').textContent = text.length;
  if (theme === 'sepia') {
    frame.style.background = '#f5e6c8';
    content.style.color = '#5b4636';
  } else if (theme === 'dark') {
    frame.style.background = '#1a1a2e';
    content.style.color = '#e0e0e0';
  } else {
    frame.style.background = '#ffffff';
    content.style.color = '#2c2c2c';
  }
}

// ============================================================
// EXPOSE TO GLOBAL (HTML onclick에서 접근)
// ============================================================

window.editor = {
  openFile,
  saveCurrentFile,
  saveAsFile,
  createNewDocument,
  deleteFile,
  refreshFileList,
  execCmd,
  zoomEditor,
  zoomReset,
  updateLineCol,
  toggleFindInline,
  closeFindInline,
  doFindInDoc,
  doFindNext,
  doFindPrev,
  toggleSplitMode,
  loadSplitRefFile,
  toggleTypewriterMode,
  createBackup,
  showSnapshotDialog,
  closeSnapshotDialog,
  saveSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  showDocStats,
  toggleEditorTts,
  readEditorText,
  stopEditorTts,
  showFindReplace,
  closeFindReplace,
  findInAllFiles,
  replaceInAllFiles,
  showMergeSplit,
  closeMergeSplit,
  showMergeView,
  showSplitView,
  executeMerge,
  executeSplit,
  toggleMobilePreview,
  closeMobilePreview,
  updateMobilePreview
};

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { 
    e.preventDefault(); 
    saveCurrentFile(); 
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { 
    e.preventDefault(); 
    zoomEditor(10); 
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') { 
    e.preventDefault(); 
    zoomEditor(-10); 
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') { 
    e.preventDefault(); 
    zoomReset(); 
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') { 
    e.preventDefault(); 
    toggleFindInline(); 
  }
  if (e.key === 'F3') { 
    e.preventDefault(); 
    doFindNext(); 
  }
  if ((e.shiftKey && e.key === 'F3')) { 
    e.preventDefault(); 
    doFindPrev(); 
  }
});

// ============================================================
// SELECTION CHANGE
// ============================================================

document.addEventListener('selectionchange', updateLineCol);

export default {
  openFile,
  saveCurrentFile,
  saveAsFile,
  createNewDocument,
  deleteFile,
  refreshFileList,
  execCmd,
  zoomEditor,
  zoomReset,
  toggleFindInline,
  closeFindInline,
  doFindInDoc,
  doFindNext,
  doFindPrev,
  toggleSplitMode,
  loadSplitRefFile,
  toggleTypewriterMode,
  createBackup,
  showSnapshotDialog,
  closeSnapshotDialog,
  saveSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  showDocStats,
  toggleEditorTts,
  readEditorText,
  stopEditorTts,
  setupAutoSave,
  showFindReplace,
  closeFindReplace,
  findInAllFiles,
  replaceInAllFiles,
  showMergeSplit,
  closeMergeSplit,
  showMergeView,
  showSplitView,
  executeMerge,
  executeSplit,
  toggleMobilePreview,
  closeMobilePreview,
  updateMobilePreview
};