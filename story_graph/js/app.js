// ============================================================
// APP - 초기화, 폴더 연결, 파일 목록, UI 컨트롤
// ============================================================

import { state } from './state.js';
import { 
  initCytoscape, 
  syncCytoscapeFromNodes, 
  updateGraphCounts 
} from './graph.js';
import { 
  openFile, 
  createNewDocument, 
  refreshFileList,
  setupAutoSave
} from './editor.js';
import { initTypeMusic, bindTypeMusicUI } from './audio/type-music.js';

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

export async function openLocalFolder() {
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

export async function disconnectFolder() {
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

export async function checkAndRestoreFolder() {
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

export async function restoreFolderPermission() {
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

export function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-theme');
  document.body.classList.toggle('light-theme', !isDark);
  document.getElementById('themeBtn').textContent =
    isDark ? '🌞 라이트 모드' : '🌙 다크 모드';
}

// ============================================================
// MENU
// ============================================================

export function toggleMenu(item, id) {
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

export function closeAllMenus() {
  document.querySelectorAll('.dropdown').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.menubar .menu-item').forEach(m => m.classList.remove('active'));
}

// ============================================================
// TAB
// ============================================================

export function switchRightTab(id, btn) {
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

function makeResizer(el, target, side) {
  let startX, startWidth;
  el.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = target.getBoundingClientRect().width;
    el.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev) => {
      const delta = side === 'left' ? (ev.clientX - startX) : (startX - ev.clientX);
      const w = Math.max(180, Math.min(600, startWidth + delta));
      target.style.width = w + 'px';
    };
    const onUp = () => {
      el.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// ============================================================
// HELP
// ============================================================

export function showHelp() { 
  document.getElementById('helpDialog').classList.add('open'); 
}

export function closeHelp() { 
  document.getElementById('helpDialog').classList.remove('open'); 
}

export function showAbout() {
  alert('⚓ 소설 관계도 분석기 v5.0\n\n📋 수동 복사 방식\n📊 웹소설 비평 시스템\n🖥️ Cytoscape.js 기반 그래프\n🌊 떨림 + 🌀 스프링 효과');
}

// ============================================================
// TOAST
// ============================================================

let toastTimeout = null;

export function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ============================================================
// INIT
// ============================================================

export async function initApp() {
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
  
  window.editor = await import('./editor.js');
  window.graph = await import('./graph.js');
  window.modules = await import('./modules.js');
  window.typeMusic = await import('./audio/type-music.js');

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
  makeResizer(document.getElementById('resizerLeft'), document.getElementById('leftPanel'), 'left');
  makeResizer(document.getElementById('resizerRight'), document.getElementById('rightPanel'), 'right');
  
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

// NOTE: initApp()은 index.html의 <script type="module">에서 호출하므로
// 여기서는 호출하지 않음 (중복 실행 방지)

export default { initApp };