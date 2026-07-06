// ============================================================
// STATE MANAGEMENT - 모든 공유 상태를 중앙에서 관리
// ============================================================

export const state = {
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

export function getGraphData() {
  return {
    nodes: state.nodes,
    edges: state.edges
  };
}

export function setGraphData(nodes, edges) {
  state.nodes = nodes;
  state.edges = edges;
}

export function getCurrentFile() {
  return {
    name: state.currentFileName,
    handle: state.currentFileHandle
  };
}

export function isFolderConnected() {
  return state.dirHandle !== null;
}

export function getNodeByName(name) {
  return state.nodes.get(name);
}

export function addNode(nodeData) {
  state.nodes.set(nodeData.name, nodeData);
}

export function removeNode(name) {
  state.nodes.delete(name);
  state.edges = state.edges.filter(e => e.from !== name && e.to !== name);
}

export function addEdge(edgeData) {
  if (state.nodes.has(edgeData.from) && state.nodes.has(edgeData.to)) {
    state.edges.push(edgeData);
    return true;
  }
  return false;
}

export function getEdgesForNode(name) {
  return state.edges.filter(e => e.from === name || e.to === name);
}

export function clearGraph() {
  state.nodes.clear();
  state.edges = [];
  state.selectedNode = null;
}

export default state;