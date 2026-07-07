// ============================================================
// STATE MANAGEMENT - 모든 공유 상태를 중앙에서 관리
// ============================================================

const state = {
  // ===== 파일 시스템 =====
  dirHandle: null,
  currentFileHandle: null,
  currentFileName: null,
  
  // ===== 그래프 데이터 =====
  nodes: new Map(),
  edges: [],
  activeFilterTypes: new Set(['인물', '사건', '장소', '아이템']),
  selectedNode: null,
  hoverNode: null,
  
  // ===== Cytoscape 인스턴스 =====
  cy: null,
  cyFloating: null,
  
  // ===== 효과 상태 =====
  breatheActive: false,
  springActive: false,
  breatheId: null,
  springId: null,
  nodeVelocities: new Map(),
  
  // ===== 위키 =====
  wikiMode: 'edit', // 'edit' | 'tts'
  openImageNodes: new Set(),
  
  // ===== 편집기 =====
  zoomPercent: 100,
  splitActive: false,
  splitRefDualEdit: false,
  typewriterActive: false,
  
  // ===== 찾기 =====
  findResults: [],
  findCurrentIdx: -1,
  
  // ===== 스냅샷 =====
  snapshots: [],
  
  // ===== TTS =====
  characterVoiceMap: {},
  editorTtsVoices: [],
  editorTtsStopped: false,
  webSpeechVoices: [],
  
  // ===== 타입 상수 =====
  COLOR_MAP: {
    '인물': '#4A90D9',
    '사건': '#E74C3C',
    '장소': '#2ECC71',
    '아이템': '#F1C40F'
  },
  TYPE_ORDER: ['인물', '사건', '장소', '아이템'],
  TYPE_ICON: { '인물': '🧑', '사건': '⚡', '장소': '📍', '아이템': '🔧' },
  TYPE_LABEL: { '인물': '인물', '사건': '사건', '장소': '장소', '아이템': '아이템' },
  EMOTION_ICONS: {
    '기쁨': '😊', '슬픔': '😢', '분노': '😡',
    '두려움': '😨', '놀람': '😲', '혐오': '🤢', '중립': '😐'
  }
};

// ============================================================
// STATE GETTERS/SETTERS (선택사항)
// ============================================================

function getGraphData() {
  return {
    nodes: state.nodes,
    edges: state.edges
  };
}

function setGraphData(nodes, edges) {
  state.nodes = nodes;
  state.edges = edges;
}

function getCurrentFile() {
  return {
    name: state.currentFileName,
    handle: state.currentFileHandle
  };
}

function isFolderConnected() {
  return state.dirHandle !== null;
}

function getNodeByName(name) {
  return state.nodes.get(name);
}

function addNode(nodeData) {
  state.nodes.set(nodeData.name, nodeData);
}

function removeNode(name) {
  state.nodes.delete(name);
  state.edges = state.edges.filter(e => e.from !== name && e.to !== name);
}

function addEdge(edgeData) {
  if (state.nodes.has(edgeData.from) && state.nodes.has(edgeData.to)) {
    state.edges.push(edgeData);
    return true;
  }
  return false;
}

function getEdgesForNode(name) {
  return state.edges.filter(e => e.from === name || e.to === name);
}

function clearGraph() {
  state.nodes.clear();
  state.edges = [];
  state.selectedNode = null;
}

state;

// ============================================================
// APP - 초기화, 폴더 연결, 파일 목록, UI 컨트롤
// ============================================================

// ============================================================
// INDEXEDDB - 폴더 권한 저장
// ============================================================

const DB_NAME = "novel_analyzer_fsa_db";
const STORE_NAME = "handles";
const KEY_NAME = "last_directory";

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

async function saveStoredHandle(handle) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(handle, KEY_NAME);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

async function getStoredHandle() {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(KEY_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (e) { return null; }
}

async function clearStoredHandle() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(KEY_NAME);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

async function verifyPermission(handle, readWrite) {
  const options = {};
  if (readWrite) options.mode = 'readwrite';
  if ((await handle.queryPermission(options)) === 'granted') return true;
  if ((await handle.requestPermission(options)) === 'granted') return true;
  return false;
}

// ============================================================
// FOLDER MANAGEMENT
// ============================================================

async function openLocalFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!await verifyPermission(handle, true)) {
      alert('쓰기 권한이 필요합니다.');
      return;
    }
    state.dirHandle = handle;
    await saveStoredHandle(state.dirHandle);
    await onFolderConnected();
  } catch (e) { console.warn('취소됨', e); }
}

async function disconnectFolder() {
  if (!confirm('폴더 연결을 해제하시겠습니까?')) return;
  state.dirHandle = null;
  state.currentFileHandle = null;
  state.currentFileName = null;
  await clearStoredHandle();
  
  document.getElementById('newDocBtn').style.display = 'none';
  document.getElementById('openDirBtn').textContent = '📂 폴더 선택';
  document.getElementById('openDirBtn').classList.remove('primary');
  document.getElementById('filePathDisplay').textContent = '연결 없음';
  document.getElementById('statusText').textContent = '연결 해제됨';
  
  const editor = document.getElementById('editor');
  editor.contentEditable = 'false';
  editor.classList.add('empty-state');
  editor.innerHTML = `
    <h3>📂 로컬 폴더를 연결하세요</h3>
    <button class="primary" onclick="window.app.openLocalFolder()" style="padding:10px 20px;font-size:14px;">📂 폴더 열기</button>
  `;
  
  document.getElementById('fileList').innerHTML = '';
  document.getElementById('docCount').textContent = '';
  state.nodes.clear();
  state.edges = [];
  updateGraphCounts();
  await checkAndRestoreFolder();
}

async function checkAndRestoreFolder() {
  const storedHandle = await getStoredHandle();
  const panel = document.getElementById('folderConnectionPanel');
  if (storedHandle) {
    panel.innerHTML = `
      <div class="folder-cta-box" style="padding:12px;margin-bottom:10px;">
        <p style="font-weight:600;color:var(--text)">이전 폴더: ${storedHandle.name}</p>
        <button class="primary" onclick="window.app.restoreFolderPermission()">연결 복원</button>
      </div>
    `;
  } else {
    panel.innerHTML = `
      <div class="folder-cta-box" style="padding:12px;margin-bottom:10px;">
        <p>연결된 폴더가 없습니다.</p>
        <button class="primary" onclick="window.app.openLocalFolder()">📂 폴더 열기</button>
      </div>
    `;
  }
}

async function restoreFolderPermission() {
  const storedHandle = await getStoredHandle();
  if (!storedHandle) return;
  try {
    if (await verifyPermission(storedHandle, true)) {
      state.dirHandle = storedHandle;
      await onFolderConnected();
    } else {
      alert('권한이 거부되었습니다.');
    }
  } catch (e) {
    alert('오류: ' + e.message);
    await clearStoredHandle();
    await checkAndRestoreFolder();
  }
}

async function onFolderConnected() {
  document.getElementById('statusText').textContent = `📁 ${state.dirHandle.name}`;
  document.getElementById('filePathDisplay').textContent = state.dirHandle.name;
  document.getElementById('openDirBtn').textContent = `📁 ${state.dirHandle.name}`;
  document.getElementById('openDirBtn').classList.add('primary');
  document.getElementById('newDocBtn').style.display = 'inline-flex';

  document.getElementById('folderConnectionPanel').innerHTML = `
    <div style="background:var(--panel2);padding:8px 10px;border-radius:6px;font-size:11px;margin-bottom:10px;border:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:600;">📂 ${state.dirHandle.name}</span>
      <button onclick="window.app.disconnectFolder()" style="border-color:#ff6b6b;color:#ff6b6b;">해제</button>
    </div>
  `;
  await refreshFileList();
}

// ============================================================
// THEME
// ============================================================

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  document.body.classList.toggle('light-theme', !isDark);
  document.getElementById('themeBtn').textContent =
    isDark ? '🌞 라이트 모드' : '🌙 다크 모드';
}

// ============================================================
// MENU
// ============================================================

function toggleMenu(item, id) {
  const menu = document.getElementById(id);
  const isOpen = menu.classList.contains('open');
  closeAllMenus();
  if (!isOpen) {
    const rect = item.getBoundingClientRect();
    menu.classList.add('open');
    item.classList.add('active');
    menu.style.position = 'fixed';
    let left = rect.left;
    let top = rect.bottom;
    if (left + 240 > window.innerWidth) left = window.innerWidth - 248;
    if (top + 300 > window.innerHeight) top = rect.top - 304;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
}

function closeAllMenus() {
  document.querySelectorAll('.dropdown').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.menubar .menu-item').forEach(m => m.classList.remove('active'));
}

// ============================================================
// TAB
// ============================================================

function switchRightTab(id, btn) {
  document.querySelectorAll('#rightPanel .tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#rightPanel .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id === 'graphViewTab' && state.cy) {
    setTimeout(function() { state.cy.resize(); state.cy.fit(null, 50); }, 50);
  }
}

// ============================================================
// RESIZER
// ============================================================

function makeResizer(resizer, target) {
  if (!resizer) return;
  resizer.onmousedown = function(e) {
    const sx = e.clientX;
    const sw = target.getBoundingClientRect().width;
    resizer.style.background = 'var(--accent)';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
    const onMove = function(ev) {
      const dx = sx - ev.clientX;
      target.style.width = Math.max(180, Math.min(800, sw + dx)) + 'px';
    };
    const onUp = function() {
      resizer.style.background = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
}

// ============================================================
// HELP
// ============================================================

function showHelp() { 
  document.getElementById('helpDialog').classList.add('open'); 
}

function closeHelp() { 
  document.getElementById('helpDialog').classList.remove('open'); 
}

function showAbout() {
  alert('⚓ 소설 관계도 분석기 v5.0\n\n📋 수동 복사 방식\n📊 웹소설 비평 시스템\n🖥️ Cytoscape.js 기반 그래프\n🌊 떨림 + 🌀 스프링 효과');
}

// ============================================================
// TOAST
// ============================================================

let toastTimeout = null;

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ============================================================
// INIT
// ============================================================

async function initApp() {
  // 전역 노출 (HTML onclick에서 접근)
  window.app = {
    openLocalFolder,
    disconnectFolder,
    restoreFolderPermission,
    toggleTheme,
    toggleMenu,
    closeAllMenus,
    switchRightTab,
    showHelp,
    closeHelp,
    showAbout,
    showToast
  };
  
  window.editor = { 
    execCmd, saveCurrentFile, saveAsFile, createNewDocument, refreshFileList, openFile, deleteFile, 
    zoomEditor, zoomReset, closeFindInline, doFindInDoc, doFindNext, doFindPrev, 
    toggleSplitRefLock, toggleSplitRefMode, toggleSplitMode, loadSplitRefFile, toggleTypewriterMode, createBackup, 
    showSnapshotDialog, closeSnapshotDialog, saveSnapshot, showDocStats, setupAutoSave, 
    toggleEditorTts, readEditorText, stopEditorTts, showFindReplace, closeFindReplace, 
    findInAllFiles, replaceInAllFiles, showMergeSplit, closeMergeSplit, showMergeView, 
    showSplitView, executeMerge, executeSplit, toggleMobilePreview, closeMobilePreview, 
    updateMobilePreview, hasGraphFile 
  };
  window.graph = { 
    initCytoscape, syncCytoscapeFromNodes, applyFilters, toggleFilter, updateGraphCounts, 
    selectNode, updateNodeType, updateNodeColor, updateNodeImage, uploadNodeImage, saveNodeWiki, 
    removeNode, toggleBreathe, toggleSpring, runGraphLayout, zoomGraph, resetGraphView, exportPNG, 
    openGraphFloating, toggleWikiPanel, closeGraphFloating, updateNodeOverlays, toggleNodeOverlay, 
    cycleWikiMode, loadGraphForCurrentFile, exportGraphToClipboard, populateVoiceSelects, onTtsProviderChange, 
    readWikiText, stopReading, addVoiceMapping, removeVoiceMapping 
  };
  window.modules = {
    exportCritiqueAsImage,
    copyWithPrompt, copyCritiquePrompt, autoFixJSON, applyGraphData, processPastedResult, 
    autoFixAndProcess, clearResultArea, processCritiqueResult, renderCritiqueResult, drawRadarChart
  };

  // 폴더 복원
  await checkAndRestoreFolder();
  
  // 그래프 초기화
  initCytoscape();
  updateGraphCounts();
  
  // 타자 음악 초기화
  initTypeMusic();
  bindTypeMusicUI();
  
  // 자동 저장
  setupAutoSave();
  
  // 리사이저
  makeResizer(document.getElementById('resizerLeft'), document.getElementById('leftPanel'));
  makeResizer(document.getElementById('resizerRight'), document.getElementById('rightPanel'));
  
  // 윈도우 리사이즈
  window.addEventListener('resize', function() {
    if (state.cy) { state.cy.resize(); }
  });
  
  // 클릭으로 메뉴 닫기
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.menubar') && !e.target.closest('.dropdown')) closeAllMenus();
  });

  showToast('🚀 분석기가 준비되었습니다. 폴더를 연결하세요.');
  
  return window.app;
}

// 자동 실행
initApp();

function updateMaskWordChips() {
  const container = document.getElementById('maskWordChips');
  if (!container) return;
  const raw = document.getElementById('critiqueMaskText')?.value || '';
  const words = raw.split(',').map(w => w.trim()).filter(w => w);
  container.innerHTML = words.map(w =>
    `<span class="mask-word-chip" onclick="removeMaskWord('${w.replace(/'/g, "\\'")}')">${w}<span class="remove">✕</span></span>`
  ).join('');
}

function removeMaskWord(word) {
  const input = document.getElementById('critiqueMaskText');
  const words = input.value.split(',').map(w => w.trim()).filter(w => w && w !== word);
  input.value = words.join(', ');
  updateCritiqueMask();
}

function maskSelectedText() {
  const sel = window.getSelection();
  if (!sel || !sel.toString().trim()) { showToast('⚠️ 마스킹할 텍스트를 먼저 선택하세요.'); return; }
  const input = document.getElementById('critiqueMaskText');
  const words = input.value ? input.value.split(',').map(w => w.trim()).filter(w => w) : [];
  sel.toString().split(',').forEach(w => {
    const t = w.trim();
    if (t && !words.includes(t)) words.push(t);
  });
  input.value = words.join(', ');
  sel.removeAllRanges();
  updateCritiqueMask();
  showToast('✅ 마스킹 단어 추가됨');
}

function updateCritiqueMask() {
  updateCritiqueMaskHighlight();
  updateMaskWordChips();
}

function updateCritiqueMaskHighlight() {
  const container = document.getElementById('critiqueResult');
  if (!container) return;
  // 기존 mask-word 복원
  container.querySelectorAll('.mask-word').forEach(span => {
    const txt = document.createTextNode(span.textContent);
    span.parentNode.replaceChild(txt, span);
  });
  container.normalize();

  const raw = document.getElementById('critiqueMaskText')?.value || '';
  const words = raw.split(',').map(w => w.trim()).filter(w => w);
  if (!words.length) return;

  // TreeWalker로 텍스트 노드 탐색
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
  const nodesToProcess = [];
  while (walker.nextNode()) nodesToProcess.push(walker.currentNode);

  for (const textNode of nodesToProcess) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest('.mask-word')) continue;
    const text = textNode.textContent;
    let modified = false;
    let html = text;
    for (const word of words) {
      if (!word) continue;
      const re = new RegExp(escapeRegex(word), 'gi');
      if (re.test(html)) {
        html = html.replace(re, m => `<span class="mask-word">${m}</span>`);
        modified = true;
      }
    }
    if (modified) {
      const span = document.createElement('span');
      span.innerHTML = html;
      while (span.firstChild) parent.insertBefore(span.firstChild, textNode);
      parent.removeChild(textNode);
      parent.normalize();
    }
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

document.addEventListener('input', function(e) {
  if (e.target.id === 'critiqueMaskText') updateCritiqueMask();
});

// ============================================================
// EDITOR - 편집기 코어, 파일 관리, 찾기/바꾸기, 스냅샷 등
// ============================================================






// ============================================================
// FILE MANAGEMENT
// ============================================================

async function openFile(name, handle) {
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

async function saveCurrentFile() {
  if (!state.dirHandle || !state.currentFileHandle) return;
  try {
    const editor = document.getElementById('editor');
    const w = await state.currentFileHandle.createWritable();
    await w.write(editor.innerText);
    await w.close();
    document.getElementById('statusText').textContent = `💾 ${state.currentFileName}`;
  } catch (e) {}
}

async function saveAsFile() {
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

async function createNewDocument() {
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

async function deleteFile(name, event) {
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

async function refreshFileList() {
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

function execCmd(cmd, val) {
  if (cmd === 'save') { saveCurrentFile(); return; }
  document.execCommand(cmd, false, val);
}

// ============================================================
// ZOOM
// ============================================================

function zoomEditor(delta) {
  state.zoomPercent = Math.max(50, Math.min(200, state.zoomPercent + delta));
  const editor = document.getElementById('editor');
  editor.style.fontSize = (15 * state.zoomPercent / 100) + 'px';
  document.getElementById('zoomLevel').textContent = state.zoomPercent + '%';
}

function zoomReset() {
  state.zoomPercent = 100;
  const editor = document.getElementById('editor');
  editor.style.fontSize = '15px';
  document.getElementById('zoomLevel').textContent = '100%';
}

// ============================================================
// LINE/COLUMN INDICATOR
// ============================================================

function updateLineCol() {
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

function toggleFindInline() {
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

function closeFindInline() {
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

function doFindInDoc() {
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

function doFindNext() {
  if (state.findResults.length === 0) return;
  state.findCurrentIdx = (state.findCurrentIdx + 1) % state.findResults.length;
  updateFindCurrent();
  document.getElementById('findCount').textContent = (state.findCurrentIdx + 1) + '/' + state.findResults.length;
}

function doFindPrev() {
  if (state.findResults.length === 0) return;
  state.findCurrentIdx = (state.findCurrentIdx - 1 + state.findResults.length) % state.findResults.length;
  updateFindCurrent();
  document.getElementById('findCount').textContent = (state.findCurrentIdx + 1) + '/' + state.findResults.length;
}

// ============================================================
// SPLIT MODE
// ============================================================

function toggleSplitMode() {
  state.splitActive = !state.splitActive;
  const container = document.getElementById('splitContainer');
  const mainContainer = document.getElementById('mainPaperContainer');
  const editor = document.getElementById('editor');
  const splitEditor = document.getElementById('splitEditor');
  const splitRefEditor = document.getElementById('splitRefEditor');
  const refHeader = document.getElementById('splitRefHeader');
  const btn = document.getElementById('splitToggleBtn');

  if (state.splitActive) {
    container.style.display = 'flex';
    mainContainer.style.display = 'none';
    const html = editor.innerHTML;
    splitEditor.innerHTML = html;
    splitEditor.contentEditable = 'true';
    btn.textContent = '📖 분할 ON';
    btn.style.borderColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
    populateSplitRefFiles();
    initSplitDivider();
  } else {
    container.style.display = 'none';
    mainContainer.style.display = 'flex';
    editor.innerHTML = splitEditor.innerHTML;
    btn.textContent = '📖 분할';
    btn.style.borderColor = '';
    btn.style.color = '';
    if (state.splitRefDualEdit) {
      state.splitRefDualEdit = false;
      const refToggleBtn = document.getElementById('splitRefToggleBtn');
      const splitRefFileSelect = document.getElementById('splitRefFileSelect');
      if (refToggleBtn) { refToggleBtn.textContent = '📎 참고 문서'; refToggleBtn.style.borderColor = ''; }
      if (splitRefFileSelect) splitRefFileSelect.style.display = '';
    }
  }
}

function toggleSplitRefMode() {
  const splitRefEditor = document.getElementById('splitRefEditor');
  const splitRefFileSelect = document.getElementById('splitRefFileSelect');
  const editor = document.getElementById('editor');
  const refToggleBtn = document.getElementById('splitRefToggleBtn');
  state.splitRefDualEdit = !state.splitRefDualEdit;
  if (state.splitRefDualEdit) {
    splitRefEditor.innerHTML = editor.innerHTML;
    splitRefEditor.contentEditable = 'true';
    splitRefEditor.style.color = '';
    splitRefEditor.style.background = '';
    splitRefFileSelect.style.display = 'none';
    refToggleBtn.textContent = '📝 분할 편집 중';
    refToggleBtn.style.borderColor = 'var(--accent)';
    const lockBtn = document.getElementById('splitRefLockBtn');
    if (lockBtn) { lockBtn.textContent = '🔓'; lockBtn.style.borderColor = '#4ade80'; }
  } else {
    splitRefEditor.contentEditable = 'false';
    splitRefEditor.style.color = '';
    splitRefEditor.style.background = '';
    splitRefFileSelect.style.display = '';
    const sel = document.getElementById('splitRefFileSelect');
    if (sel.value) loadSplitRefFile(sel.value);
    else splitRefEditor.innerHTML = '참고할 파일을 선택하세요.';
    refToggleBtn.textContent = '📎 참고 문서';
    refToggleBtn.style.borderColor = '';
    const lockBtn = document.getElementById('splitRefLockBtn');
    if (lockBtn) lockBtn.textContent = '🔒';
  }
}

function toggleSplitRefLock() {
  const el = document.getElementById('splitRefEditor');
  const btn = document.getElementById('splitRefLockBtn');
  if (!el || !btn) return;
  const locked = el.contentEditable !== 'true';
  el.contentEditable = locked ? 'true' : 'false';
  btn.textContent = locked ? '🔓' : '🔒';
  if (locked) { btn.style.borderColor = '#4ade80'; el.style.color = ''; el.style.background = ''; }
  else { btn.style.borderColor = ''; el.style.color = ''; el.style.background = ''; }
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

async function loadSplitRefFile(name) {
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

function initSplitDivider() {
  const divider = document.getElementById('splitDivider');
  if (!divider || divider.dataset.initialized) return;
  divider.dataset.initialized = '1';
  let dragging = false;
  divider.addEventListener('mousedown', function(e) {
    dragging = true;
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    const container = document.getElementById('splitContainer');
    const rect = container.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(100, Math.min(rect.width - 100, x));
    document.getElementById('splitPaneMain').style.flex = '0 0 ' + x + 'px';
  });
  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ============================================================
// TYPEWRITER MODE
// ============================================================

function toggleTypewriterMode() {
  state.typewriterActive = !state.typewriterActive;
  document.body.classList.toggle('typewriter-active', state.typewriterActive);
  showToast(state.typewriterActive ? '⌨️ 타자기 모드 ON' : '⌨️ 타자기 모드 OFF');
}

// ============================================================
// BACKUP
// ============================================================

async function createBackup() {
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

function showSnapshotDialog() {
  loadSnapshots();
  document.getElementById('snapshotOverlay').classList.add('open');
  document.getElementById('snapshotLabelInput').value = '';
  renderSnapshots();
}

function closeSnapshotDialog() {
  document.getElementById('snapshotOverlay').classList.remove('open');
}

function saveSnapshot() {
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

function restoreSnapshot(idx) {
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

function deleteSnapshot(idx) {
  if (!confirm('"' + snapshots[idx].label + '" 스냅샷을 삭제하시겠습니까?')) return;
  snapshots.splice(idx, 1);
  saveSnapshots();
  renderSnapshots();
  showToast('🗑️ 스냅샷 삭제됨');
}

// ============================================================
// DOC STATISTICS
// ============================================================

function showDocStats() {
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

function setupAutoSave() {
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

function toggleEditorTts() {
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

function readEditorText() {
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

function stopEditorTts() {
  editorTtsStopped = true;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  document.getElementById('editorTtsStatus').textContent = '⏹ 정지됨';
}

// ============================================================
// FIND/REPLACE IN ALL FILES
// ============================================================

function showFindReplace() {
  document.getElementById('findReplaceOverlay').classList.add('open');
}
function closeFindReplace() {
  document.getElementById('findReplaceOverlay').classList.remove('open');
  document.getElementById('frResult').textContent = '';
}

async function findInAllFiles() {
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

async function replaceInAllFiles() {
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

function showMergeSplit() {
  document.getElementById('mergeOverlay').classList.add('open');
  showMergeView();
}

function closeMergeSplit() {
  document.getElementById('mergeOverlay').classList.remove('open');
  document.getElementById('mergeResult').textContent = '';
}

function showMergeView() {
  document.getElementById('mergeTitle').textContent = '📄 문서 합치기';
  document.getElementById('mergeOptions').style.display = 'block';
  document.getElementById('splitOptions').style.display = 'none';
  document.getElementById('mergeExecBtn').style.display = 'inline-flex';
  document.getElementById('splitExecBtn').style.display = 'none';
  populateMergeFileList();
}

function showSplitView() {
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

async function executeMerge() {
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

async function executeSplit() {
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

function toggleMobilePreview() {
  const overlay = document.getElementById('mobilePreviewOverlay');
  overlay.classList.toggle('open');
  if (overlay.classList.contains('open')) {
    updateMobilePreview();
    const box = document.getElementById('mobilePreviewBox');
    const header = box?.querySelector('.header');
    if (header && !header.dataset.dragInit) {
      header.dataset.dragInit = '1';
      let ox = 0, oy = 0;
      header.onmousedown = function(e) {
        if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
        ox = e.clientX - box.offsetLeft;
        oy = e.clientY - box.offsetTop;
        document.body.style.userSelect = 'none';
        const onMove = function(ev) {
          box.style.left = (ev.clientX - ox) + 'px';
          box.style.top = (ev.clientY - oy) + 'px';
          box.style.transform = 'none';
        };
        const onUp = function() {
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };
    }
  }
}

function closeMobilePreview() {
  document.getElementById('mobilePreviewOverlay').classList.remove('open');
}

function updateMobilePreview() {
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
  toggleSplitRefLock, toggleSplitRefMode, toggleSplitMode,
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

{
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
  toggleSplitRefLock, toggleSplitRefMode, toggleSplitMode,
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

// ============================================================
// GRAPH - Cytoscape 그래프, 필터, 효과, 레이아웃, 노드 위키
// ============================================================




// ============================================================
// COLOR MAP (state에서 가져오기)
// ============================================================

const COLORS = state.COLOR_MAP;
const TYPE_ICON = state.TYPE_ICON;
const TYPE_LABEL = state.TYPE_LABEL;

// ============================================================
// CYTOSCAPE INIT
// ============================================================

function initCytoscape() {
  const container = document.getElementById('cy');
  if (!container) return;
  if (state.cy) { 
    state.cy.destroy(); 
    state.cy = null; 
  }

  state.cy = cytoscape({
    container: container,
    elements: getCytoscapeElements(),
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'background-color': 'data(color)',
          'shape': 'round-rectangle',
          'width': 'label',
          'height': 30,
          'padding': '10px',
          'border-width': 2,
          'border-color': '#333',
          'text-valign': 'center',
          'text-halign': 'center',
          'color': '#fff',
          'font-weight': 'bold',
          'font-size': 13,
          'text-outline-width': 2,
          'text-outline-color': '#000',
          'min-width': '40px',
        }
      },
      {
        selector: 'node[type="인물"]',
        style: { 'background-color': '#4A90D9' }
      },
      {
        selector: 'node[type="사건"]',
        style: { 'background-color': '#E74C3C' }
      },
      {
        selector: 'node[type="장소"]',
        style: { 'background-color': '#2ECC71' }
      },
      {
        selector: 'node[type="아이템"]',
        style: { 'background-color': '#F1C40F' }
      },
      {
        selector: 'edge',
        style: {
          'label': 'data(label)',
          'curve-style': 'bezier',
          'line-color': '#999',
          'width': 1.5,
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#999',
          'font-size': 10,
          'text-rotation': 'none',
          'color': '#aaa',
          'text-outline-width': 2,
          'text-outline-color': '#1e222c',
          'text-outline-opacity': 0.8,
          'text-background-color': '#1e222c',
          'text-background-opacity': 0.6,
          'text-background-padding': '4px',
          'text-background-shape': 'roundrectangle',
        }
      },
      {
        selector: 'node:selected',
        style: { 'border-width': 4, 'border-color': '#FFD700', 'border-style': 'double' }
      },
      {
        selector: 'edge:selected',
        style: { 'width': 3, 'line-color': '#FFD700', 'target-arrow-color': '#FFD700' }
      }
    ],
    layout: {
      name: 'cose',
      animate: true,
      animationDuration: 500,
      fit: true,
      padding: 30,
      nodeRepulsion: 12000,
      idealEdgeLength: 120,
      gravity: 0.03,
      gravityRange: 250,
      nodeOverlap: 8,
      nestingFactor: 5,
      numIter: 800,
      initialTemp: 200,
      coolingFactor: 0.95,
      minTemp: 1.0
    },
    wheelSensitivity: 0.3,
    minZoom: 0.1,
    maxZoom: 10,
  });

  setTimeout(function() {
    if (state.cy) { 
      state.cy.resize(); 
      state.cy.fit(null, 50); 
    }
  }, 100);

  state.cy.on('layoutstop', function() { 
    setTimeout(() => updateNodeOverlays(), 100); 
  });

  state.cy.on('tap', 'node', function(evt) {
    const node = evt.target;
    const name = node.data('id');
    const nodeData = state.nodes.get(name);
    if (nodeData) selectNode(nodeData);
  });

  state.cy.on('tap', function(evt) {
    if (evt.target === state.cy) {
      document.getElementById('wikiCard').innerHTML = `
        <div style="color:var(--muted);font-size:12px;text-align:center;margin:auto;">
          노드를 클릭하면 상세 정보가 표시됩니다.
        </div>
      `;
    }
  });

  state.cy.on('mouseover', 'node', function(evt) {
    const node = evt.target;
    const name = node.data('id');
    const nodeData = state.nodes.get(name);
    if (!nodeData) return;

    clearTimeout(state.hoverTimeout);
    state.hoverTimeout = setTimeout(() => {
      const relations = state.edges.filter(e => e.from === name || e.to === name);
      let relHTML = '';
      if (relations.length > 0) {
        relHTML = relations.slice(0, 5).map(e => {
          const other = e.from === name ? e.to : e.from;
          const dir = e.from === name ? '→' : '←';
          const sent = e.sentiment === '우호' ? '💚' : e.sentiment === '적대' ? '❤️' : '⚪';
          return `<div class="rel-item"><span>${other} ${dir} ${e.label || '관계'}</span><span>${sent}</span></div>`;
        }).join('');
        if (relations.length > 5) {
          relHTML += `<div style="color:var(--muted);font-size:10px;">+ ${relations.length - 5}개 더...</div>`;
        }
      }

      const tooltip = document.getElementById('graphTooltip');
      tooltip.innerHTML = `
        <div class="tt-header">
          <span>${TYPE_ICON[nodeData.type] || '●'}</span>
          <span style="font-size:15px;">${nodeData.name}</span>
          <span class="tt-type-badge" style="background:${COLORS[nodeData.type] || '#888'};">
            ${TYPE_LABEL[nodeData.type] || nodeData.type}
          </span>
        </div>
        <div class="tt-row">
          <span>📝 언급 ${nodeData.mentions || 1}회</span>
          <span>${nodeData.emotion ? '😊 ' + nodeData.emotion : ''}</span>
        </div>
        ${nodeData.desc ? `<div class="tt-desc">📚 ${nodeData.desc}</div>` : ''}
        ${relations.length > 0 ? `<hr class="tt-divider"><div class="tt-relations">${relHTML}</div>` : ''}
      `;

      const mouseX = evt.originalEvent.clientX;
      const mouseY = evt.originalEvent.clientY;
      let left = mouseX + 16;
      let top = mouseY + 16;
      const tw = 340;
      const th = tooltip.scrollHeight || 200;
      if (left + tw > window.innerWidth - 10) left = mouseX - tw - 16;
      if (top + th > window.innerHeight - 10) top = mouseY - th - 16;
      if (top < 10) top = 10;
      if (left < 10) left = 10;

      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
      tooltip.style.display = 'block';
    }, 300);
  });

  state.cy.on('mouseout', 'node', function() {
    clearTimeout(state.hoverTimeout);
    clearTimeout(state.tooltipTimeout);
    state.tooltipTimeout = setTimeout(() => { 
      document.getElementById('graphTooltip').style.display = 'none'; 
    }, 100);
  });

  state.cy.on('dragfree', 'node', function(evt) {
    if (state.springActive) {
      const node = evt.target;
      const id = node.id();
      state.nodeVelocities.set(id, { vx: 0, vy: 0 });
    }
  });

  applyFilters();
  return state.cy;
}

// ============================================================
// CYTOSCAPE ELEMENTS
// ============================================================

function getCytoscapeElements() {
  const elements = [];
  for (const [name, data] of state.nodes) {
    const type = data.type || '인물';
    const color = COLORS[type] || '#667eea';
    elements.push({
      data: {
        id: name,
        label: name.length > 10 ? name.substring(0, 9) + '…' : name,
        color: color,
        type: type,
        mentions: data.mentions || 1,
        emotion: data.emotion || '중립',
        desc: data.desc || '',
        image: data.image || ''
      }
    });
  }
  for (const edge of state.edges) {
    if (state.nodes.has(edge.from) && state.nodes.has(edge.to)) {
      elements.push({
        data: {
          id: edge.from + '_' + edge.to + '_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          source: edge.from,
          target: edge.to,
          label: edge.label || '관계',
          type: edge.type || '연결',
        }
      });
    }
  }
  return elements;
}

async function syncCytoscapeFromNodes() {
  if (!state.cy) return;
  state.cy.elements().remove();
  state.cy.add(getCytoscapeElements());
  const layout = state.cy.layout({
    name: 'cose',
    animate: true,
    animationDuration: 500,
    fit: true,
    padding: 30,
    nodeRepulsion: 12000,
    idealEdgeLength: 120,
    gravity: 0.03,
    gravityRange: 250,
    nodeOverlap: 8,
    nestingFactor: 5,
    numIter: 800,
    initialTemp: 200,
    coolingFactor: 0.95,
    minTemp: 1.0
  });
  layout.on('layoutstop', () => updateNodeOverlays());
  layout.run();
  updateGraphCounts();
  if (state.breatheActive) startBreathe();
  if (state.springActive) startSpring();
}

// ============================================================
// FILTERS
// ============================================================

function applyFilters() {
  if (!state.cy) return;
  state.cy.nodes().forEach(n => {
    const type = n.data('type');
    if (type && state.activeFilterTypes.has(type)) {
      n.style('display', 'element');
    } else {
      n.style('display', 'none');
    }
  });
  state.cy.style().update();
  // Also sync floating graph if open
  if (cyFloating) {
    applyFiltersToFloating();
  }
}

function toggleFilter(type, el) {
  if (state.activeFilterTypes.has(type)) {
    state.activeFilterTypes.delete(type);
    el.classList.remove('active');
  } else {
    state.activeFilterTypes.add(type);
    el.classList.add('active');
  }
  applyFilters();
}

// ============================================================
// GRAPH COUNTS
// ============================================================

function updateGraphCounts() {
  document.getElementById('graphCount').textContent = `노드 ${state.nodes.size} · 엣지 ${state.edges.length}`;
}

// ============================================================
// NODE SELECTION
// ============================================================

function selectNode(node) {
  state.selectedNode = node;
  const card = document.getElementById('wikiCard');
  const relations = state.edges.filter(e => e.from === node.name || e.to === node.name);

  let relHTML = '';
  if (relations.length > 0) {
    relHTML = relations.map(e => {
      const other = e.from === node.name ? e.to : e.from;
      const dir = e.from === node.name ? '→' : '←';
      return `<span style="background:var(--panel2);padding:2px 6px;border-radius:4px;font-size:10px;border:1px solid var(--border);">
        ${other} ${dir} ${e.label || '관계'}
      </span>`;
    }).join(' ');
  }

  const color = COLORS[node.type] || '#888';
  card.innerHTML = `
    <div class="title-row">
      <span class="node-name" style="color:${color};">${TYPE_ICON[node.type] || '●'} ${node.name}</span>
      <select onchange="window.graph.updateNodeType('${node.name}', this.value)">
        <option value="인물" ${node.type==='인물'?'selected':''}>인물</option>
        <option value="사건" ${node.type==='사건'?'selected':''}>사건</option>
        <option value="장소" ${node.type==='장소'?'selected':''}>장소</option>
        <option value="아이템" ${node.type==='아이템'?'selected':''}>아이템</option>
      </select>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin:4px 0;">
      <label style="font-size:10px;color:var(--muted);">색상</label>
      <input type="color" id="wikiColorInput" value="${color}" onchange="window.graph.updateNodeColor('${node.name}', this.value)" style="width:32px;height:24px;padding:0;border:none;">
      <label style="font-size:10px;color:var(--muted);">첨부 URL</label>
      <input type="text" id="wikiImageInput" value="${state.nodes.get(node.name)?.image || ''}" placeholder="이미지/유튜브 URL" style="flex:1;font-size:10px;padding:2px 4px;" onchange="window.graph.updateNodeImage('${node.name}', this.value)">
      <input type="file" id="wikiImageUpload" accept="image/*" style="display:none;" onchange="window.graph.uploadNodeImage('${node.name}', this.files[0])">
      <button onclick="document.getElementById('wikiImageUpload').click()" style="font-size:10px;padding:2px 8px;" title="이미지 업로드">📁 업로드</button>
      <input type="file" id="wikiImageUpload" accept="image/*" style="display:none;" onchange="window.graph.uploadNodeImage('${node.name}', this.files[0])">
      <button onclick="document.getElementById('wikiImageUpload').click()" style="font-size:10px;padding:2px 8px;" title="이미지 업로드">📁 업로드</button>
      <input type="file" id="wikiImageUpload" accept="image/*" style="display:none;" onchange="window.graph.uploadNodeImage('${node.name}', this.files[0])">
      <button onclick="document.getElementById('wikiImageUpload').click()" style="font-size:10px;padding:2px 8px;" title="이미지 업로드">📁 업로드</button>
    </div>
    <div style="font-size:11px;color:var(--muted);">언급: ${node.mentions || 1}회 ${node.emotion ? '| 감정: ' + node.emotion : ''}</div>
    <textarea id="wikiDescArea" placeholder="노드 설명을 입력하세요..." style="min-height:50px;">${node.desc || ''}</textarea>
    <div style="display:flex;gap:4px;flex-wrap:wrap;">
      <button onclick="window.graph.saveNodeWiki('${node.name}')" class="primary" style="font-size:11px;padding:4px 10px;">💾 저장</button>
      <button onclick="window.graph.removeNode('${node.name}')" style="font-size:11px;padding:4px 10px;border-color:#ff6b6b;color:#ff6b6b;">🗑️ 삭제</button>
    </div>
    ${relations.length > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">🔗 ${relHTML}</div>` : ''}
  `;

  if (state.cy) {
    state.cy.elements().unselect();
    const cyNode = state.cy.getElementById(node.name);
    if (cyNode.length) cyNode.select();
  }
}

function updateNodeType(name, type) {
  const n = state.nodes.get(name);
  if (n) { 
    n.type = type; 
    syncCytoscapeFromNodes(); 
  }
}

function updateNodeColor(name, color) {
  if (!state.cy) return;
  const n = state.cy.getElementById(name);
  if (n.length) {
    n.data('color', color);
    n.style('background-color', color);
  }
  const nodeData = state.nodes.get(name);
  if (nodeData) {
    if (nodeData.type === '인물') COLORS['인물'] = color;
    else if (nodeData.type === '사건') COLORS['사건'] = color;
    else if (nodeData.type === '장소') COLORS['장소'] = color;
    else if (nodeData.type === '아이템') COLORS['아이템'] = color;
  }
}

async function updateNodeImage(name, url) {
  const nd = state.nodes.get(name);
  if (nd) {
    nd.image = url;
    if (state.cy) {
      const n = state.cy.getElementById(name);
      if (n.length) n.data('image', url);
    }
    await updateNodeOverlays();
  }
}

async function uploadNodeImage(name, file) {
  if (!file || !state.dirHandle) {
    showToast('⚠️ 폴더가 연결되지 않았습니다.');
    return;
  }
  try {
    const imagesDir = await state.dirHandle.getDirectoryHandle('.images', { create: true });
    const ext = file.name.split('.').pop() || 'png';
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safeName}_${Date.now()}.${ext}`;
    const fileHandle = await imagesDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    
    const url = `.images/${fileName}`;
    updateNodeImage(name, url);
    document.getElementById('wikiImageInput').value = url;
    showToast('✅ 이미지 업로드 완료');
  } catch (e) {
    showToast('❌ 업로드 실패: ' + e.message);
  }
}

async function saveNodeWiki(name) {
  const n = state.nodes.get(name);
  if (n) {
    n.desc = document.getElementById('wikiDescArea').value;
    const imgUrl = document.getElementById('wikiImageInput')?.value || '';
    n.image = imgUrl;
    showToast('✅ 노드 정보 저장 완료');
    if (state.cy) {
      const cyNode = state.cy.getElementById(name);
      if (cyNode.length) cyNode.data('image', imgUrl);
    }
    syncCytoscapeFromNodes();
    await updateNodeOverlays();
  }
}

function removeNode(name) {
  if (!confirm(`'${name}' 노드를 삭제하시겠습니까?`)) return;
  state.nodes.delete(name);
  state.edges = state.edges.filter(e => e.from !== name && e.to !== name);
  document.getElementById('wikiCard').innerHTML = `<div style="color:var(--muted);text-align:center;">노드 삭제됨</div>`;
  updateGraphCounts();
  syncCytoscapeFromNodes();
}

// ============================================================
// EFFECTS: BREATHE
// ============================================================

function toggleBreathe() {
  state.breatheActive = !state.breatheActive;
  const btn = document.getElementById('btnBreathe');
  if (state.breatheActive) {
    btn.textContent = '🌊 떨림 ON';
    btn.className = 'active';
    startBreathe();
  } else {
    btn.textContent = '🌊 떨림 OFF';
    btn.className = 'inactive';
    stopBreathe();
    resetNodePositions();
  }
}

function startBreathe() {
  if (state.breatheId) return;
  state.cy.nodes().forEach(node => {
    if (!node.data('baseX')) {
      node.data('baseX', node.position('x'));
      node.data('baseY', node.position('y'));
    }
  });
  let phase = 0;
  function breathe() {
    if (!state.breatheActive || !state.cy) {
      state.breatheId = null;
      return;
    }
    phase += 0.03;
    state.cy.nodes().forEach(node => {
      const baseX = node.data('baseX');
      const baseY = node.data('baseY');
      if (baseX !== undefined && baseY !== undefined) {
        node.position({
          x: baseX + Math.sin(phase * 0.7 + node.id().length * 0.3) * 0.5,
          y: baseY + Math.cos(phase * 0.5 + node.id().length * 0.7) * 0.5
        });
      }
    });
    state.breatheId = requestAnimationFrame(breathe);
  }
  breathe();
}

function stopBreathe() {
  if (state.breatheId) {
    cancelAnimationFrame(state.breatheId);
    state.breatheId = null;
  }
}

function resetNodePositions() {
  if (!state.cy) return;
  state.cy.nodes().forEach(node => {
    if (node.data('baseX') !== undefined) {
      node.position({
        x: node.data('baseX'),
        y: node.data('baseY')
      });
    }
  });
}

// ============================================================
// EFFECTS: SPRING
// ============================================================

function toggleSpring() {
  state.springActive = !state.springActive;
  const btn = document.getElementById('btnSpring');
  if (state.springActive) {
    btn.textContent = '🌀 스프링 ON';
    btn.className = 'active';
    startSpring();
  } else {
    btn.textContent = '🌀 스프링 OFF';
    btn.className = 'inactive';
    stopSpring();
  }
}

function startSpring() {
  if (state.springId) return;
  if (!state.cy) return;

  state.cy.nodes().forEach(node => {
    if (!node.data('baseX')) {
      node.data('baseX', node.position('x'));
      node.data('baseY', node.position('y'));
    }
    if (!state.nodeVelocities.has(node.id())) {
      state.nodeVelocities.set(node.id(), { vx: 0, vy: 0 });
    }
  });

  function springLoop() {
    if (!state.springActive || !state.cy) {
      state.springId = null;
      return;
    }

    const damping = 0.92;
    const springK = 0.04;

    state.cy.nodes().forEach(node => {
      const baseX = node.data('baseX');
      const baseY = node.data('baseY');
      if (baseX === undefined || baseY === undefined) return;

      const pos = node.position();
      const vel = state.nodeVelocities.get(node.id()) || { vx: 0, vy: 0 };

      const dx = baseX - pos.x;
      const dy = baseY - pos.y;
      vel.vx += dx * springK;
      vel.vy += dy * springK;

      vel.vx *= damping;
      vel.vy *= damping;

      node.position({
        x: pos.x + vel.vx,
        y: pos.y + vel.vy
      });

      state.nodeVelocities.set(node.id(), vel);
    });

    state.springId = requestAnimationFrame(springLoop);
  }
  springLoop();
}

function stopSpring() {
  if (state.springId) {
    cancelAnimationFrame(state.springId);
    state.springId = null;
  }
  state.nodeVelocities.clear();
}

// ============================================================
// LAYOUTS
// ============================================================

function runGraphLayout(name) {
  if (!state.cy) return;
  stopBreathe(); 
  stopSpring();
  state.breatheActive = false; 
  state.springActive = false;
  document.getElementById('btnBreathe').textContent = '🌊 떨림 OFF';
  document.getElementById('btnBreathe').className = 'inactive';
  document.getElementById('btnSpring').textContent = '🌀 스프링 OFF';
  document.getElementById('btnSpring').className = 'inactive';
  
  let opts;
  if (name === 'cose') {
    opts = { name:'cose', animate:true, animationDuration:500, fit:true, padding:30, nodeRepulsion:12000, idealEdgeLength:120, gravity:0.03 };
  } else if (name === 'dagre') {
    opts = { name:'dagre', rankDir:'TB', padding:30, animate:true, nodeSep:50, rankSep:120 };
  } else {
    opts = { name:'dagre', rankDir:'LR', rankSep:180, nodeSep:40, animate:true };
  }
  const layout = state.cy.layout(opts);
  layout.on('layoutstop', () => updateNodeOverlays());
  layout.run();
  showToast('📐 레이아웃: ' + name);
}

// ============================================================
// GRAPH CONTROLS
// ============================================================

function zoomGraph(factor) {
  if (!state.cy) return;
  const zoom = state.cy.zoom() * factor;
  state.cy.zoom({ level: Math.min(10, Math.max(0.1, zoom)) });
}

function resetGraphView() {
  if (!state.cy) return;
  state.cy.fit();
  state.cy.zoom(1);
  state.cy.pan({ x: 0, y: 0 });
  if (state.breatheActive) startBreathe();
  if (state.springActive) startSpring();
}

function exportPNG(toClipboard) {
  if (!state.cy) return;
  const scale = parseFloat(document.getElementById('pngScale').value) || 2;
  const bg = document.body.classList.contains('dark-theme') ? '#1e222c' : '#f4f6fa';
  const pngData = state.cy.png({ 
    bg: bg,
    scale: scale,
    maxWidth: 6000,
    maxHeight: 6000
  });
  if (toClipboard) {
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.onload = function() {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(function(blob) {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function() {
          showToast('📋 클립보드에 복사됨 (' + scale + 'x)');
        }).catch(function() {
          showToast('⚠️ 클립보드 복사 실패');
        });
      });
    };
    img.src = pngData;
  } else {
    const link = document.createElement('a');
    link.download = 'graph_' + new Date().toISOString().slice(0,10) + '_' + scale + 'x.png';
    link.href = pngData;
    link.click();
    showToast('📷 PNG 저장 완료 (' + scale + 'x)');
  }
}

// ============================================================
// GRAPH FLOATING (전체화면)
// ============================================================

let cyFloating = null;
let GF_DRAG = null, GF_RESIZE = null;

function openGraphFloating() {
  if (!state.cy) return;
  const wrap = document.getElementById('graphFloatingOverlay');
  wrap.classList.add('open');
  const w = document.getElementById('graphFloatingWindow');
  const container = document.getElementById('cyFloating');
  if (cyFloating) { 
    try { cyFloating.destroy(); } catch(e) {} 
    cyFloating = null; 
  }
  container.innerHTML = '';
  cyFloating = cytoscape({
    container: container,
    elements: state.cy.json().elements,
    style: state.cy.style().json(),
    layout: { name: 'preset' },
    wheelSensitivity: 0.5,
    minZoom: 0.1,
    maxZoom: 10,
  });

  // Apply current filter state to floating graph
  applyFiltersToFloating();

  setTimeout(function() {
    if (cyFloating) { cyFloating.resize(); cyFloating.fit(null, 50); }
  }, 100);

  const header = document.getElementById('graphFloatingHeader');
  header.onmousedown = function(e) {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    const rect = w.getBoundingClientRect();
    GF_DRAG = { ox: e.clientX - rect.left, oy: e.clientY - rect.top };
    document.addEventListener('mousemove', onGfDrag);
    document.addEventListener('mouseup', onGfDragEnd);
  };

  const rh = document.getElementById('graphFloatingResize');
  rh.onmousedown = function(e) {
    e.preventDefault(); e.stopPropagation();
    const rect = w.getBoundingClientRect();
    GF_RESIZE = { ox: e.clientX, oy: e.clientY, w: rect.width, h: rect.height };
    document.addEventListener('mousemove', onGfResize);
    document.addEventListener('mouseup', onGfResizeEnd);
  };
}

// Apply current filter state to floating graph
function applyFiltersToFloating() {
  if (!cyFloating) return;
  cyFloating.nodes().forEach(n => {
    const type = n.data('type');
    if (type && state.activeFilterTypes.has(type)) {
      n.style('display', 'element');
    } else {
      n.style('display', 'none');
    }
  });
  cyFloating.style().update();
}

// toggleFilter에 플로팅 그래프 동기화 통합됨 (applyFilters에서 처리)

function onGfDrag(e) {
  if (!GF_DRAG) return;
  const w = document.getElementById('graphFloatingWindow');
  w.style.left = (e.clientX - GF_DRAG.ox) + 'px';
  w.style.top = (e.clientY - GF_DRAG.oy) + 'px';
}

function onGfDragEnd() {
  GF_DRAG = null;
  document.removeEventListener('mousemove', onGfDrag);
  document.removeEventListener('mouseup', onGfDragEnd);
}

function onGfResize(e) {
  if (!GF_RESIZE) return;
  const w = document.getElementById('graphFloatingWindow');
  const dw = e.clientX - GF_RESIZE.ox, dh = e.clientY - GF_RESIZE.oy;
  w.style.width = Math.max(300, GF_RESIZE.w + dw) + 'px';
  w.style.height = Math.max(200, GF_RESIZE.h + dh) + 'px';
  if (cyFloating) { cyFloating.resize(); cyFloating.fit(null, 50); }
}

function onGfResizeEnd() {
  GF_RESIZE = null;
  document.removeEventListener('mousemove', onGfResize);
  document.removeEventListener('mouseup', onGfResizeEnd);
}

function closeGraphFloating() {
  document.getElementById('graphFloatingOverlay').classList.remove('open');
  if (cyFloating) { 
    try { cyFloating.destroy(); } catch(e) {} 
    cyFloating = null; 
  }
  document.removeEventListener('mousemove', onGfDrag);
  document.removeEventListener('mouseup', onGfDragEnd);
  document.removeEventListener('mousemove', onGfResize);
  document.removeEventListener('mouseup', onGfResizeEnd);
  GF_DRAG = null; GF_RESIZE = null;
}

// ============================================================
// NODE OVERLAYS (이미지/URL 팝업)
// ============================================================

// uploadNodeImage
async function uploadNodeImage(name, file) {
  if (!file || !state.dirHandle) { showToast('⚠️ 폴더가 연결되지 않았습니다.'); return; }
  try {
    const imagesDir = await state.dirHandle.getDirectoryHandle('.images', { create: true });
    const ext = file.name.split('.').pop() || 'png';
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safeName}_${Date.now()}.${ext}`;
    const fileHandle = await imagesDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    const url = `.images/${fileName}`;
    await updateNodeImage(name, url);
    document.getElementById('wikiImageInput').value = url;
    showToast('✅ 이미지 업로드 완료');
  } catch (e) { showToast('❌ 업로드 실패: ' + e.message); }
}

async function resolveImageContent(raw) {
  if (!raw) return '';
  if (raw.startsWith('http') && (raw.match(/\.(jpe?g|png|gif|webp|svg)/i) || raw.includes('youtube') || raw.includes('youtu.be'))) {
    return raw.includes('youtube') || raw.includes('youtu.be')
      ? `<iframe src="https://www.youtube.com/embed/${getYouTubeId(raw)}" allowfullscreen></iframe>`
      : `<img src="${raw}" onerror="this.outerHTML='<div style=color:red;font-size:11px;>❌ 이미지 로드 실패</div>'">`;
  }
  if (raw.startsWith('.images/') && state.dirHandle) {
    try {
      const imagesDir = await state.dirHandle.getDirectoryHandle('.images');
      const fileName = raw.replace('.images/', '');
      const fileHandle = await imagesDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const blobUrl = URL.createObjectURL(file);
      return `<img src="${blobUrl}" onerror="this.outerHTML='<div style=color:red;font-size:11px;>❌ 이미지 로드 실패</div>'">`;
    } catch (e) { return `<div class="node-content-text">❌ 로컬 이미지 로드 실패: ${raw}</div>`; }
  }
  return `<div class="node-content-text">${raw.replace(/\n/g,'<br>')}</div>`;
}


// uploadNodeImage
async function uploadNodeImage(name, file) {
  if (!file || !state.dirHandle) { showToast('⚠️ 폴더가 연결되지 않았습니다.'); return; }
  try {
    const imagesDir = await state.dirHandle.getDirectoryHandle('.images', { create: true });
    const ext = file.name.split('.').pop() || 'png';
    const safeName = name.replace(/[\\/:*?"<>|]/g, '_');
    const fileName = `${safeName}_${Date.now()}.${ext}`;
    const fileHandle = await imagesDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();
    const url = `.images/${fileName}`;
    await updateNodeImage(name, url);
    document.getElementById('wikiImageInput').value = url;
    showToast('✅ 이미지 업로드 완료');
  } catch (e) { showToast('❌ 업로드 실패: ' + e.message); }
}

async function resolveImageContent(raw) {
  if (!raw) return '';
  if (raw.startsWith('http') && (raw.match(/\.(jpe?g|png|gif|webp|svg)/i) || raw.includes('youtube') || raw.includes('youtu.be'))) {
    return raw.includes('youtube') || raw.includes('youtu.be')
      ? `<iframe src="https://www.youtube.com/embed/${getYouTubeId(raw)}" allowfullscreen></iframe>`
      : `<img src="${raw}" onerror="this.outerHTML='<div style=color:red;font-size:11px;>❌ 이미지 로드 실패</div>'">`;
  }
  if (raw.startsWith('.images/') && state.dirHandle) {
    try {
      const imagesDir = await state.dirHandle.getDirectoryHandle('.images');
      const fileName = raw.replace('.images/', '');
      const fileHandle = await imagesDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const blobUrl = URL.createObjectURL(file);
      return `<img src="${blobUrl}" onerror="this.outerHTML='<div style=color:red;font-size:11px;>❌ 이미지 로드 실패</div>'">`;
    } catch (e) { return `<div class="node-content-text">❌ 로컬 이미지 로드 실패: ${raw}</div>`; }
  }
  return `<div class="node-content-text">${raw.replace(/\n/g,'<br>')}</div>`;
}

async function updateNodeOverlays() {
  const overlayLayer = document.getElementById('overlays');
  if (!overlayLayer || !state.cy) return;
  const nodes = state.cy.nodes();
  const activeIds = new Set();
  
  for (const node of nodes) {
    const raw = node.data('image');
    if (!raw || !raw.trim()) continue;
    const nid = node.id();
    activeIds.add(nid);
    const pos = node.renderedPosition();
    const w = node.renderedWidth();
    const h = node.renderedHeight();
    const btnId = 'img-btn-' + nid;
    let btn = document.getElementById(btnId);
    if (!btn) {
      btn = document.createElement('div');
      btn.id = btnId;
      btn.className = 'node-img-toggle';
      btn.onclick = (e) => { e.stopPropagation(); toggleNodeOverlay(nid); };
      overlayLayer.appendChild(btn);
    }
    btn.innerHTML = state.openImageNodes.has(nid) ? '❌' : '📎';
    btn.style.left = (pos.x + w/2 - 12) + 'px';
    btn.style.top = (pos.y - h/2 - 12) + 'px';
    btn.style.display = 'block';
    const popId = 'img-pop-' + nid;
    let pop = document.getElementById(popId);
    if (state.openImageNodes.has(nid)) {
      if (!pop) {
        pop = document.createElement('div');
        pop.id = popId;
        pop.className = 'node-img-popup';
        const content = await resolveImageContent(raw);
        pop.innerHTML = content + '<div class="close-btn" onclick="window.graph.toggleNodeOverlay(\''+nid+'\')">접기</div>';
        overlayLayer.appendChild(pop);
      }
      pop.style.display = 'block';
      pop.style.left = Math.max(5, Math.min(window.innerWidth - 200, pos.x - pop.offsetWidth/2)) + 'px';
      pop.style.top = (pos.y + h/2 + 5) + 'px';
    } else {
      if (pop) pop.remove();
    }
  }
  Array.from(overlayLayer.children).forEach(child => {
    if (child.id.startsWith('img-btn-')) {
      const nid = child.id.replace('img-btn-','');
      if (!activeIds.has(nid)) { 
        child.remove(); 
        const p = document.getElementById('img-pop-'+nid); 
        if (p) p.remove(); 
      }
    }
  });
}

async function resolveImageContent(raw) {
  if (!raw) return '';
  if (raw.startsWith('http') && (raw.match(/\.(jpe?g|png|gif|webp|svg)/i) || raw.includes('youtube') || raw.includes('youtu.be'))) {
    return raw.includes('youtube') || raw.includes('youtu.be')
      ? `<iframe src="https://www.youtube.com/embed/${getYouTubeId(raw)}" allowfullscreen></iframe>`
      : `<img src="${raw}" onerror="this.outerHTML='<div style=color:red;font-size:11px;>❌ 이미지 로드 실패</div>'">`;
  }
  if (raw.startsWith('.images/') && state.dirHandle) {
    try {
      const imagesDir = await state.dirHandle.getDirectoryHandle('.images');
      const fileName = raw.replace('.images/', '');
      const fileHandle = await imagesDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const blobUrl = URL.createObjectURL(file);
      return `<img src="${blobUrl}" onerror="this.outerHTML='<div style=color:red;font-size:11px;>❌ 이미지 로드 실패</div>'">`;
    } catch (e) {
      return `<div class="node-content-text">❌ 로컬 이미지 로드 실패: ${raw}</div>`;
    }
  }
  return `<div class="node-content-text">${raw.replace(/\n/g,'<br>')}</div>`;
}

async function toggleNodeOverlay(nid) {
  if (state.openImageNodes.has(nid)) state.openImageNodes.delete(nid);
  else state.openImageNodes.add(nid);
  await updateNodeOverlays();
}

function getYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('v')) return u.searchParams.get('v');
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|v\/))([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : '';
  } catch { return ''; }
}

// ============================================================
// WIKI MODE (편집/TTS 전환)
// ============================================================

function cycleWikiMode() {
  const modes = ['edit', 'tts'];
  const labels = ['편집', 'TTS'];
  const idx = (modes.indexOf(state.wikiMode) + 1) % modes.length;
  state.wikiMode = modes[idx];
  document.getElementById('wikiModeLabel').textContent = '· ' + labels[idx];
  document.getElementById('wikiTtsSection').style.display = state.wikiMode === 'tts' ? 'block' : 'none';
  if (state.wikiMode === 'tts') populateVoiceSelects();
}

// ============================================================
// GRAPH LOAD
// ============================================================

async function loadGraphForCurrentFile() {
  try {
    const analysisDir = await state.dirHandle.getDirectoryHandle('.analysis', { create: true });
    const jsonName = state.currentFileName.replace(/\.(txt|md)$/, '.graph.json');
    const fileHandle = await analysisDir.getFileHandle(jsonName);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);

    state.nodes.clear();
    state.edges = [];

    if (data.entities) {
      data.entities.forEach(e => {
        state.nodes.set(e.name, {
          name: e.name,
          type: e.type || '인물',
          desc: e.description || '',
          mentions: e.mentions || 1,
          emotion: e.emotion || '중립',
          image: e.image || ''
        });
      });
    }
    if (data.relations) {
      data.relations.forEach(r => {
        if (state.nodes.has(r.from) && state.nodes.has(r.to)) {
          state.edges.push({
            from: r.from,
            to: r.to,
            label: r.label || '관계',
            type: r.type || '연결',
            negated: r.negated || false,
            sentiment: r.sentiment || '중립',
            weight: 1
          });
        }
      });
    }

    updateGraphCounts();
    showToast('📂 그래프 데이터를 불러왔습니다.');
    document.getElementById('parseStats').textContent = `노드 ${state.nodes.size}개, 엣지 ${state.edges.length}개`;
    document.getElementById('parseResultFeedback').style.display = 'block';
    document.getElementById('parseResultFeedback').style.color = 'var(--text)';
    await window.editor.refreshFileList();
    await syncCytoscapeFromNodes();
  } catch (e) {}
}

// ============================================================
// EXPORT GRAPH TO CLIPBOARD
// ============================================================

function exportGraphToClipboard() {
  if (!state.cy) { showToast('⚠️ 그래프가 없습니다.'); return; }
  const data = {
    entities: [],
    relations: state.edges
  };
  for (const [name, n] of state.nodes) {
    data.entities.push({ name: n.name, type: n.type, description: n.desc });
  }
  const json = JSON.stringify(data, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    showToast('📋 그래프 JSON이 클립보드에 복사되었습니다!');
  }).catch(() => {
    showToast('⚠️ 클립보드 복사 실패');
  });
}

// ============================================================
// WIKI TTS
// ============================================================

function populateVoiceSelects() {
  const sel = document.getElementById('webSpeechVoiceSelect');
  const mapSel = document.getElementById('mapVoiceSelect');
  if (!sel) return;
  sel.innerHTML = '';
  if (mapSel) mapSel.innerHTML = '';
  if (typeof speechSynthesis === 'undefined') return;
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) {
    speechSynthesis.onvoiceschanged = populateVoiceSelects;
    return;
  }
  voices.forEach(v => {
    const opt = new Option(v.name + ' (' + v.lang + ')', v.name);
    sel.add(opt);
    if (mapSel) mapSel.add(new Option(v.name + ' (' + v.lang + ')', v.name));
  });
}

function onTtsProviderChange() {
  populateVoiceSelects();
}

let wikiTtsStopped = false;

function readWikiText() {
  if (typeof speechSynthesis === 'undefined') {
    showToast('⚠️ TTS 미지원 브라우저');
    return;
  }
  speechSynthesis.cancel();
  wikiTtsStopped = false;
  const selectedNode = state.selectedNode;
  if (!selectedNode) { showToast('⚠️ 노드를 먼저 선택하세요.'); return; }
  
  const text = selectedNode.desc || selectedNode.name || '';
  if (!text || text.trim().length < 2) { showToast('⚠️ 읽을 내용이 없습니다.'); return; }
  
  const voiceName = document.getElementById('webSpeechVoiceSelect')?.value || '';
  const speed = parseFloat(document.getElementById('speedControl')?.value || '0.9');
  const isAudiobook = document.getElementById('audiobookMode')?.checked || false;
  
  const voiceMappings = loadVoiceMappings();
  const mapping = voiceMappings.find(m => m.character === (selectedNode.name));
  const finalVoice = mapping ? mapping.voice : voiceName;
  
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (paragraphs.length === 0) paragraphs.push(text);
  let idx = 0;
  
  function speakNext() {
    if (wikiTtsStopped) return;
    if (idx >= paragraphs.length) { showToast('✅ 읽기 완료'); return; }
    const p = paragraphs[idx].trim();
    if (p.length < 2) { idx++; speakNext(); return; }
    const utter = new SpeechSynthesisUtterance(p);
    if (finalVoice) {
      const v = speechSynthesis.getVoices().find(vv => vv.name === finalVoice);
      if (v) utter.voice = v;
    }
    utter.rate = speed;
    utter.lang = 'ko-KR';
    utter.onend = function() {
      if (wikiTtsStopped) return;
      idx++;
      if (isAudiobook && idx < paragraphs.length) {
        setTimeout(function() { if (!wikiTtsStopped) speakNext(); }, 500);
      } else { speakNext(); }
    };
    utter.onerror = function() { if (!wikiTtsStopped) { idx++; speakNext(); } };
    speechSynthesis.speak(utter);
  }
  speakNext();
}

function stopReading() {
  wikiTtsStopped = true;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

function addVoiceMapping() {
  const charName = document.getElementById('mapCharName')?.value.trim();
  const voice = document.getElementById('mapVoiceSelect')?.value;
  if (!charName || !voice) { showToast('⚠️ 캐릭터명과 음성을 선택하세요.'); return; }
  const mappings = loadVoiceMappings();
  mappings.push({ character: charName, voice: voice });
  saveVoiceMappings(mappings);
  renderVoiceMappings();
  document.getElementById('mapCharName').value = '';
  showToast('✅ 음성 매핑 추가: ' + charName);
}

function removeVoiceMapping(index) {
  const mappings = loadVoiceMappings();
  mappings.splice(index, 1);
  saveVoiceMappings(mappings);
  renderVoiceMappings();
}

function loadVoiceMappings() {
  try { return JSON.parse(localStorage.getItem('wiki_voice_mappings') || '[]'); }
  catch(e) { return []; }
}

function saveVoiceMappings(mappings) {
  localStorage.setItem('wiki_voice_mappings', JSON.stringify(mappings));
}

function renderVoiceMappings() {
  const container = document.getElementById('voiceMappingContainer');
  if (!container) return;
  const mappings = loadVoiceMappings();
  if (mappings.length === 0) {
    container.innerHTML = '<div style="font-size:10px;color:var(--muted);">등록된 매핑이 없습니다.</div>';
    return;
  }
  container.innerHTML = mappings.map((m, i) => `
    <div class="voice-map-item">
      <span>${m.character} → ${m.voice}</span>
      <span class="del" onclick="window.graph.removeVoiceMapping(${i})">✕</span>
    </div>
  `).join('');
}

function toggleWikiPanel() {
  const card = document.getElementById('wikiCard');
  const tts = document.getElementById('wikiTtsSection');
  const btn = document.getElementById('wikiCollapseBtn');
  if (card.style.display === 'none') {
    card.style.display = '';
    if (tts) tts.style.display = '';
    if (btn) btn.textContent = '▼';
  } else {
    card.style.display = 'none';
    if (tts) tts.style.display = 'none';
    if (btn) btn.textContent = '▲';
  }
}

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.graph = {
  initCytoscape,
  syncCytoscapeFromNodes,
  applyFilters,
  toggleFilter,
  updateGraphCounts,
  selectNode,
  updateNodeType,
  updateNodeColor,
  updateNodeImage,
  saveNodeWiki,
  removeNode,
  toggleBreathe,
  toggleSpring,
  runGraphLayout,
  zoomGraph,
  resetGraphView,
  exportPNG,
  openGraphFloating,
  closeGraphFloating,
  toggleWikiPanel,
  updateNodeOverlays,
  toggleNodeOverlay,
  cycleWikiMode,
  loadGraphForCurrentFile,
  exportGraphToClipboard,
  populateVoiceSelects,
  onTtsProviderChange,
  readWikiText,
  stopReading,
  addVoiceMapping,
  removeVoiceMapping,
  renderVoiceMappings,
  loadVoiceMappings
};

{
  initCytoscape,
  syncCytoscapeFromNodes,
  applyFilters,
  toggleFilter,
  updateGraphCounts,
  selectNode,
  updateNodeType,
  updateNodeColor,
  updateNodeImage,
  saveNodeWiki,
  removeNode,
  toggleBreathe,
  toggleSpring,
  runGraphLayout,
  zoomGraph,
  resetGraphView,
  exportPNG,
  openGraphFloating,
  closeGraphFloating,
  updateNodeOverlays,
  toggleNodeOverlay,
  cycleWikiMode,
  loadGraphForCurrentFile,
  exportGraphToClipboard,
  populateVoiceSelects,
  onTtsProviderChange,
  readWikiText,
  stopReading,
  addVoiceMapping,
  removeVoiceMapping,
  renderVoiceMappings,
  loadVoiceMappings
};

// ============================================================
// MODULES - 분석/비평 프롬프트, 결과 처리, 통계
// ============================================================





// ============================================================
// ANALYSIS PROMPT
// ============================================================

const ANALYSIS_PROMPT = `당신은 소설 분석 전문가입니다. 다음 텍스트에서 등장인물, 장소, 사건, 아이템을 추출하고, 각 개체 간의 관계를 JSON 형식으로 출력해주세요.

출력 형식 (반드시 아래 JSON 형식을 지켜주세요):
{
  "entities": [
    {"name": "이름", "type": "인물|장소|사건|아이템", "description": "설명"}
  ],
  "relations": [
    {"from": "출발", "to": "도착", "label": "관계명", "type": "행위|위치|소지|동반|이동|목적|참여|발생|대립|우호|가족"}
  ]
}

분석할 텍스트:`;

// ============================================================
// CRITIQUE PROMPT
// ============================================================

const CRITIQUE_PROMPT = `# 웹소설 형식·내용·친절함 통합 비평 시스템 (Reader-First 100pt)

당신은 웹소설 장르 문법과 서사 심리학에 정통하며, 무엇보다 '독자에 대한 친절함'을 상업성의 최고 가치로 두는 냉정하고 예리한 수석 비평가입니다. 텍스트를 받으면 인사 없이 아래 형식대로 즉시 분석을 시작하세요. 모든 항목은 100점 만점으로 채점하며, 70~80점대 중간 점수로 얼버무리지 말고 엄격하고 날카롭게 평가하세요.

## 점수 산정 기준 (100점 만점)
- 91~100점: 독보적 (최상위권 수준. 수정이 불필요함)
- 71~90점: 경쟁력 (유료 연재 가능 수준. 흡입력이 높고 대중성이 확실함)
- 51~70점: 정체 (평이한 수준. 활자는 읽히나 상업적 쾌감이나 배려가 부족함)
- 31~50점: 이탈 (조기 하차 유발 수준. 문장이나 전개 교정 필수)
- 1~30점: 해체 (연재 불가 수준. 전면 재작성 필요)

## 평가 항목 (각 100점 만점)
1. 문장과 리듬: 호흡의 완급 조절, Show(보여주기)와 Tell(말하기)의 균형, 문장의 직관성과 매끄러운 연결
2. 묘사와 이미지: 시각 외 다감각의 활용, 눈앞에 정밀하게 그려지는 선명도와 미장센
3. 정보와 전개: 첫 문장의 자이가르닉 효과(의심/호기심 유발), 끊임없는 의문 유착(간질간질한 텐션), 사건의 흥미도, 끝부분의 자이가르닉 재발동(다음 장면 유도)
4. 캐릭터와 대사: 주인공의 호감 가는 매력적인 행동, 독자의 감정적 공감대 형성(특정 감정의 동기화), 대사 속 권력 관계
5. 가독성과 친절함: 과도한 설정 과시(설명충)나 난해한 갈등으로 독자를 지치게 하지 않는가, 독자에게 스트레스나 답답함(불필요한 고구마)을 주지 않고 장르적 보상을 친절하게 제공하는가

---

## 전문 분석 항목 (각 항목은 2~4문장으로 구체적으로 분석)
- 문체 분석: 문장 길이 분포, 수식/은유 사용, 어조 일관성, 문장의 리듬감
- 호흡/페이스 분석: 장면별 속도, 긴장과 이완의 완급 조절, 리듬 패턴
- 서사 구조 분석: 플롯 구성, 갈등 구조, 전환점, 도입-전개-절정-결말 밸런스
- 독자 심리 분석: 자이가르닉 효과 활용도, 몰입 유도 전략, 감정 동기화(공감/긴장/카타르시스)
- 장르 적합성: 해당 장르의 독자 기대치 대비 충족도, 장르 문법 준수 여부 및 차별화 전략

## 텍스트 분석 출력 형식 (반드시 아래 JSON 형식으로만 출력)

{
  "scores": {
    "문장과 리듬": 0,
    "묘사와 이미지": 0,
    "정보와 전개": 0,
    "캐릭터와 대사": 0,
    "가독성과 친절함": 0
  },
  "average": 0,
  "critique": {
    "summary": "이 글의 가장 강력한 상업적 무기와 치명적인 약점 (독자가 겪게 될 최종적인 독서 경험과 피로도 정의)",
    "analysis": "문체 측면: ...\n서사 심리 측면: ...\n친절함 측면: ...",
    "best_sentence": {
      "quote": "최강의 문장 인용구",
      "reason": "호기심을 극대화했거나 독자에게 가장 친절한 쾌감을 준 구체적인 이유"
    },
    "worst_sentence": {
      "quote": "최약의 문장 인용구",
      "reason": "갈등을 불필요하게 복잡하게 만들었거나 독자에게 불친절하여 피로감을 유발한 구체적인 이유"
    },
    "style_analysis": "문체 분석: 문장 길이 분포, 수식/은유 사용, 어조 일관성, 문장의 리듬감에 대한 전문적인 분석",
    "pace_analysis": "호흡/페이스 분석: 장면별 속도, 긴장과 이완의 완급 조절, 리듬 패턴에 대한 분석",
    "structure_analysis": "서사 구조 분석: 플롯 구성, 갈등 구조, 전환점, 도입-전개-절정-결말 밸런스 분석",
    "reader_psychology": "독자 심리 분석: 자이가르닉 효과 활용도, 몰입 유도 전략, 감정 동기화(공감/긴장/카타르시스) 분석",
    "genre_fitness": "장르 적합성: 해당 장르의 독자 기대치 대비 충족도, 장르 문법 준수 여부 및 차별화 전략 분석"
  }
}`;

// ============================================================
// COPY PROMPTS
// ============================================================

function copyWithPrompt() {
  const editor = document.getElementById('editor');
  const text = editor.innerText || editor.textContent || '';
  if (!text || text.trim().length < 10) {
    showToast('⚠️ 분석할 텍스트가 너무 짧습니다. (최소 10자 이상)');
    return;
  }
  const full = ANALYSIS_PROMPT + '\n\n' + text;

  navigator.clipboard.writeText(full).then(() => {
    document.getElementById('copyToast').style.display = 'block';
    setTimeout(() => { document.getElementById('copyToast').style.display = 'none'; }, 3000);
    showToast('✅ 프롬프트 + 텍스트가 복사되었습니다!');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = full;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    document.getElementById('copyToast').style.display = 'block';
    setTimeout(() => { document.getElementById('copyToast').style.display = 'none'; }, 3000);
    showToast('✅ 복사 완료! (Fallback)');
  });
}

function copyCritiquePrompt() {
  const editor = document.getElementById('editor');
  const text = editor.innerText || editor.textContent || '';
  if (!text || text.trim().length < 50) {
    showToast('⚠️ 비평할 텍스트가 너무 짧습니다. (최소 50자 이상)');
    return;
  }
  const full = CRITIQUE_PROMPT + '\n\n## 분석할 텍스트\n\n' + text;

  navigator.clipboard.writeText(full).then(() => {
    document.getElementById('critiqueCopyToast').style.display = 'block';
    setTimeout(() => { document.getElementById('critiqueCopyToast').style.display = 'none'; }, 3000);
    showToast('✅ 비평 프롬프트 + 텍스트가 복사되었습니다!');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = full;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    document.getElementById('critiqueCopyToast').style.display = 'block';
    setTimeout(() => { document.getElementById('critiqueCopyToast').style.display = 'none'; }, 3000);
    showToast('✅ 복사 완료! (Fallback)');
  });
}

// ============================================================
// JSON AUTO-FIX
// ============================================================

function autoFixJSON(raw) {
  let fixed = raw;
  fixed = fixed.replace(/^\uFEFF/, '');
  fixed = fixed.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  fixed = fixed.replace(/\/\/.*$/gm, '');
  fixed = fixed.replace(/,\s*([}\]])/g, '$1');
  fixed = fixed.trim();
  return fixed;
}

// ============================================================
// APPLY GRAPH DATA
// ============================================================

function applyGraphData(data) {
  state.nodes.clear();
  state.edges = [];

  if (data.entities && Array.isArray(data.entities)) {
    const sorted = [...data.entities].sort((a, b) => {
      const ia = state.TYPE_ORDER.indexOf(a.type || '인물');
      const ib = state.TYPE_ORDER.indexOf(b.type || '인물');
      return ia - ib;
    });
    sorted.forEach(e => {
      const name = e.name?.trim();
      if (!name) return;
      state.nodes.set(name, {
        name: name,
        type: e.type || '인물',
        desc: e.description || '',
        mentions: e.mentions || 1,
        emotion: e.emotion || '중립'
      });
    });
  }

  if (data.relations && Array.isArray(data.relations)) {
    data.relations.forEach(r => {
      const from = r.from?.trim();
      const to = r.to?.trim();
      if (!from || !to) return;
      if (state.nodes.has(from) && state.nodes.has(to)) {
        state.edges.push({
          from: from,
          to: to,
          label: r.label || '관계',
          type: r.type || '연결',
          negated: r.negated || false,
          sentiment: r.sentiment || '중립',
          weight: 1
        });
      }
    });
  }

  const stats = `노드 ${state.nodes.size}개, 엣지 ${state.edges.length}개`;
  document.getElementById('parseStats').textContent = stats;
  document.getElementById('parseResultFeedback').style.display = 'block';
  document.getElementById('parseResultFeedback').style.color = 'var(--text)';
  updateGraphCounts();
  showToast(`✅ 그래프 생성 완료! ${stats}`);

  syncCytoscapeFromNodes();
  setTimeout(saveGraphToFile, 500);
}

// ============================================================
// PROCESS PASTED RESULT
// ============================================================

function processPastedResult() {
  const raw = document.getElementById('resultPasteArea').value.trim();
  if (!raw) {
    showToast('⚠️ 분석 결과를 먼저 붙여넣어주세요.');
    return;
  }

  try {
    const data = JSON.parse(raw);
    applyGraphData(data);
    return;
  } catch (e) {
    const fixed = autoFixJSON(raw);
    try {
      const data = JSON.parse(fixed);
      document.getElementById('resultPasteArea').value = fixed;
      showToast('🔧 자동 수정 완료!');
      applyGraphData(data);
      return;
    } catch (e2) {
      document.getElementById('parseStats').textContent = `❌ 오류: ${e2.message}`;
      document.getElementById('parseResultFeedback').style.display = 'block';
      document.getElementById('parseResultFeedback').style.color = '#ff6b6b';
      showToast(`❌ JSON 파싱 실패: ${e2.message}`);
    }
  }
}

function autoFixAndProcess() {
  const raw = document.getElementById('resultPasteArea').value.trim();
  if (!raw) {
    showToast('⚠️ 분석 결과를 먼저 붙여넣어주세요.');
    return;
  }
  const fixed = autoFixJSON(raw);
  document.getElementById('resultPasteArea').value = fixed;
  processPastedResult();
}

function clearResultArea() {
  document.getElementById('resultPasteArea').value = '';
  document.getElementById('parseResultFeedback').style.display = 'none';
  showToast('🗑️ 결과 영역이 초기화되었습니다.');
}

// ============================================================
// SAVE GRAPH TO FILE
// ============================================================

async function saveGraphToFile() {
  if (!state.dirHandle || !state.currentFileName) {
    return;
  }
  if (state.nodes.size === 0) {
    return;
  }

  const graphData = {
    fileName: state.currentFileName,
    analyzedAt: new Date().toISOString(),
    model: 'Manual',
    entities: [...state.nodes.values()].map(n => ({
      name: n.name,
      type: n.type,
      description: n.desc || '',
      mentions: n.mentions || 1,
      emotion: n.emotion || '중립',
      image: n.image || ''
    })),
    relations: state.edges.map(e => ({
      from: e.from,
      to: e.to,
      label: e.label || '관계',
      type: e.type || '연결',
      negated: e.negated || false,
      sentiment: e.sentiment || '중립'
    }))
  };

  try {
    const analysisDir = await state.dirHandle.getDirectoryHandle('.analysis', { create: true });
    const jsonName = state.currentFileName.replace(/\.(txt|md)$/, '.graph.json');
    const fileHandle = await analysisDir.getFileHandle(jsonName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(graphData, null, 2));
    await writable.close();
    showToast('💾 그래프 데이터가 저장되었습니다: .analysis/' + jsonName);
    await window.editor.refreshFileList();
  } catch (e) {}
}

// ============================================================
// CRITIQUE RESULT PROCESSING
// ============================================================

function processCritiqueResult() {
  const raw = document.getElementById('critiquePasteArea').value.trim();
  if (!raw) {
    showToast('⚠️ 비평 결과(JSON)를 먼저 붙여넣어주세요.');
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const fixed = autoFixJSON(raw);
    try {
      data = JSON.parse(fixed);
      document.getElementById('critiquePasteArea').value = fixed;
      showToast('🔧 자동 수정 완료!');
    } catch (e2) {
      showToast('❌ JSON 파싱 실패: ' + e.message);
      return;
    }
  }

  renderCritiqueResult(data);
}

// ============================================================
// RENDER CRITIQUE RESULT
// ============================================================

function renderCritiqueResult(data) {
  const container = document.getElementById('critiqueResult');
  const scores = data.scores || {};
  const avg = data.average || 0;
  const critique = data.critique || {};

  let grade = '해체';
  let gradeClass = 'critical';
  if (avg >= 91) { grade = '독보적'; gradeClass = 'excellent'; }
  else if (avg >= 71) { grade = '경쟁력'; gradeClass = 'good'; }
  else if (avg >= 51) { grade = '정체'; gradeClass = 'fair'; }
  else if (avg >= 31) { grade = '이탈'; gradeClass = 'poor'; }

  const items = ['문장과 리듬', '묘사와 이미지', '정보와 전개', '캐릭터와 대사', '가독성과 친절함'];
  const scoreLabels = {
    '문장과 리듬': '문장과 리듬',
    '묘사와 이미지': '묘사와 이미지',
    '정보와 전개': '정보와 전개',
    '캐릭터와 대사': '캐릭터와 대사',
    '가독성과 친절함': '가독성과 친절함'
  };

  let barsHTML = '';
  items.forEach(key => {
    const val = scores[key] || 0;
    const pct = Math.min(100, Math.max(0, val));
    barsHTML += `
      <div class="score-bar-item">
        <span class="label">${scoreLabels[key] || key}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%; background:${pct >= 70 ? '#4ade80' : pct >= 50 ? '#facc15' : '#f87171'};"></div>
        </div>
        <span class="score-num">${Math.round(val)}</span>
      </div>
    `;
  });

  container.innerHTML = `
    <div class="score-summary">
      <div class="score-avg">
        ${Math.round(avg)}<span class="label"> / 100</span>
      </div>
      <div class="score-grade ${gradeClass}">${grade}</div>
      <div style="font-size:11px; color:var(--muted); margin-left:auto;">${items.length}개 항목 평균</div>
    </div>

    <div class="radar-wrap"><canvas id="radarChart" width="240" height="240"></canvas></div>

    <div class="score-bars">${barsHTML}</div>

    ${critique.summary ? `
    <div class="critique-section">
      <h4>📌 총평</h4>
      <p class="text">${critique.summary}</p>
    </div>` : ''}

    ${critique.analysis ? `
    <div class="critique-section">
      <h4>🔍 핵심 분석</h4>
      <p class="text">${critique.analysis.replace(/\n/g, '<br>')}</p>
    </div>` : ''}

    ${critique.best_sentence ? `
    <div class="critique-section">
      <h4>✅ 최강의 문장</h4>
      <div class="sentence-box best">
        <div class="quote">"${critique.best_sentence.quote || ''}"</div>
        ${critique.best_sentence.reason ? `<div class="reason">${critique.best_sentence.reason}</div>` : ''}
      </div>
    </div>` : ''}

    ${critique.worst_sentence ? `
    <div class="critique-section">
      <h4>❌ 최약의 문장</h4>
      <div class="sentence-box worst">
        <div class="quote">"${critique.worst_sentence.quote || ''}"</div>
        ${critique.worst_sentence.reason ? `<div class="reason">${critique.worst_sentence.reason}</div>` : ''}
      </div>
    </div>` : ''}

    ${critique.style_analysis ? `
    <div class="critique-section prof">
      <h4>🖋️ 문체 분석</h4>
      <p class="text">${critique.style_analysis}</p>
    </div>` : ''}

    ${critique.pace_analysis ? `
    <div class="critique-section prof">
      <h4>🌊 호흡/페이스 분석</h4>
      <p class="text">${critique.pace_analysis}</p>
    </div>` : ''}

    ${critique.structure_analysis ? `
    <div class="critique-section prof">
      <h4>🏗️ 서사 구조 분석</h4>
      <p class="text">${critique.structure_analysis}</p>
    </div>` : ''}

    ${critique.reader_psychology ? `
    <div class="critique-section prof">
      <h4>🧠 독자 심리 분석</h4>
      <p class="text">${critique.reader_psychology}</p>
    </div>` : ''}

    ${critique.genre_fitness ? `
    <div class="critique-section prof">
      <h4>🎯 장르 적합성</h4>
      <p class="text">${critique.genre_fitness}</p>
    </div>` : ''}
  `;

  container.classList.add('show');
  container.oncontextmenu = function(e) {
    const sel = window.getSelection();
    if (sel && sel.toString().trim()) {
      e.preventDefault();
      const input = document.getElementById('critiqueMaskText');
      const words = input.value ? input.value.split(',').map(w => w.trim()).filter(w => w) : [];
      sel.toString().split(',').forEach(w => {
        const t = w.trim();
        if (t && !words.includes(t)) words.push(t);
      });
      input.value = words.join(', ');
      updateCritiqueMask();
      sel.removeAllRanges();
      showToast('✅ 마스킹 단어 추가됨');
    }
  };
  drawRadarChart(document.getElementById('radarChart'), scores, items);
  showToast('📊 비평 결과가 표시되었습니다!');
}

// ============================================================
// RADAR CHART
// ============================================================

function drawRadarChart(canvas, scores, labels) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w/2, cy = h/2;
  const r = Math.min(w,h)/2 - 28;
  const n = labels.length;
  const angleStep = (2*Math.PI)/n;
  const startAngle = -Math.PI/2;

  const isDark = document.body.classList.contains('dark-mode');
  const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
  const axisColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
  const textColor = isDark ? '#ccc' : '#666';
  const fillColor = 'rgba(99,102,241,0.25)';
  const strokeColor = '#818cf8';

  ctx.clearRect(0,0,w,h);

  function getPoint(i, radius) {
    const angle = startAngle + i*angleStep;
    return { x:cx + radius*Math.cos(angle), y:cy + radius*Math.sin(angle) };
  }

  [0.25, 0.5, 0.75, 1.0].forEach(function(pct) {
    ctx.beginPath();
    for (let i=0; i<=n; i++) {
      const p = getPoint(i % n, r*pct);
      i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  });

  for (let i=0; i<n; i++) {
    const p = getPoint(i, r);
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(p.x,p.y);
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  ctx.beginPath();
  for (let i=0; i<=n; i++) {
    const idx = i % n;
    const val = scores[labels[idx]] || 0;
    const pct = Math.min(1, Math.max(0, val/100));
    const p = getPoint(idx, r*pct);
    i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let i=0; i<n; i++) {
    const val = scores[labels[i]] || 0;
    const pct = Math.min(1, Math.max(0, val/100));
    const p = getPoint(i, r*pct);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, 2*Math.PI);
    ctx.fillStyle = strokeColor;
    ctx.fill();
  }

  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i=0; i<n; i++) {
    const p = getPoint(i, r+16);
    const label = labels[i];
    if (label.length > 5) {
      ctx.font = '9px sans-serif';
      const parts = label.split(' ');
      if (parts.length > 1) {
        ctx.fillStyle = textColor;
        ctx.fillText(parts[0], p.x, p.y-6);
        ctx.fillText(parts.slice(1).join(' '), p.x, p.y+6);
      } else {
        ctx.fillStyle = textColor;
        ctx.fillText(label, p.x, p.y);
      }
    } else {
      ctx.fillStyle = textColor;
      ctx.fillText(label, p.x, p.y);
    }
    }
  }

async function exportCritiqueAsImage(toClipboard) {
  const container = document.getElementById('critiqueResult');
  if (!container || !container.classList.contains('show')) {
    showToast('❌ 열린 비평 결과가 없습니다.');
    return;
  }
  const scale = parseFloat(document.getElementById('critiquePngScale')?.value) || 2;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    showToast('❌ 결과 영역이 비어 있습니다.');
    return;
  }
  const maskedEls = [];
  container.querySelectorAll('.mask-word').forEach(el => {
    maskedEls.push({ el, bg: el.style.background, color: el.style.color });
    el.style.setProperty('background', '#000', 'important');
    el.style.setProperty('color', '#000', 'important');
  });
  const overflowEls = [];
  for (let p = container.parentElement; p && p !== document.body; p = p.parentElement) {
    const ov = getComputedStyle(p).overflow;
    if (ov !== 'visible') { overflowEls.push({ el: p, val: p.style.overflow }); p.style.overflow = 'visible'; }
  }
  try {
    const canvas = await html2canvas(container, {
      scale, useCORS: false, allowTaint: true, backgroundColor: '#1e222c',
      width: rect.width, height: rect.height,
      windowWidth: rect.width, windowHeight: rect.height,
      logging: true
    });
    overflowEls.forEach(item => { item.el.style.overflow = item.val; });
    maskedEls.forEach(item => { if (item.el) { item.el.style.background = item.bg; item.el.style.color = item.color; } });
    if (toClipboard) {
      canvas.toBlob(async b => {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); showToast('✅ 클립보드 복사 완료 (' + scale + 'x)'); } catch (e) { showToast('❌ 복사 실패'); }
      });
    } else {
      const link = document.createElement('a');
      link.download = 'critique_' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '_' + scale + 'x.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      showToast('✅ PNG 저장 완료 (' + scale + 'x)');
    }
  } catch (e) {
    overflowEls.forEach(item => { item.el.style.overflow = item.val; });
    maskedEls.forEach(item => { if (item.el) { item.el.style.background = item.bg; item.el.style.color = item.color; } });
    showToast('❌ 이미지 생성 실패: ' + e.message);
  }
}

window.modules = {
  exportCritiqueAsImage,
  toggleSplitRefLock, toggleSplitRefMode, toggleSplitMode,
  copyWithPrompt,
  copyCritiquePrompt,
  processPastedResult,
  autoFixAndProcess,
  clearResultArea,
  processCritiqueResult,
  renderCritiqueResult,
  drawRadarChart,
  applyGraphData,
  autoFixJSON
};

{
  exportCritiqueAsImage,
  toggleSplitRefLock, toggleSplitRefMode, toggleSplitMode,
  copyWithPrompt,
  copyCritiquePrompt,
  processPastedResult,
  autoFixAndProcess,
  clearResultArea,
  processCritiqueResult,
  renderCritiqueResult,
  drawRadarChart,
  applyGraphData,
  autoFixJSON
};

{ // ============================================================
// TYPE MUSIC - 메인 컨트롤러
// ============================================================

  playKeyboardSound, 
  playImprovNote, 
  getAudioContext 


  initSoundfont, 
  playNote, 
  isSoundfontReady 


  loadAudioBuffer, 
  playSegment, 
  getSegmentCount, 
  getDuration,
  stopPlayback 


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

function initTypeMusic() {
  // 초기화 시 AudioContext 준비 (사용자 상호작용 전까지 대기)
  // Soundfont는 첫 사용 시 로드
  console.log('🎵 타자 음악 초기화 완료');
}

function toggleTypeMusic() {
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

function setTypeMusicMode(mode) {
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

function handleTypeKey(key) {
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

function loadAudioFile(arrayBuffer) {
  return new Promise((resolve, reject) => {
    loadAudioBuffer(arrayBuffer, (buf, segments) => {
      state.audioBuffer = buf;
      updateAudioClipStatus();
      resolve({ duration: getDuration(buf), segments: segments });
    }, reject);
  });
}

function loadMidiFile(arrayBuffer) {
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

function playPreview() {
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

function stopAll() {
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
  }
  state.playing = false;
  stopPlayback();
  document.getElementById('typeMusicMidPreviewBtn').textContent = '▶ 미리듣기';
  document.getElementById('typeMusicStatus').textContent = '';
}

function getTypeMusicStatus() {
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

function stopPreview() {
  if (state.previewTimer) {
    clearTimeout(state.previewTimer);
    state.previewTimer = null;
  }
  document.getElementById('typeMusicMidPreviewBtn').textContent = '▶ 미리듣기';
  document.getElementById('typeMusicStatus').textContent = '';
}

function updateAudioClipStatus() {
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

function bindTypeMusicUI() {
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

{
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
}

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



