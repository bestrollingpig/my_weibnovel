// ============================================================
// VENDOR - 외부 라이브러리 로더
// ============================================================

// ============================================================
// CDN URLs
// ============================================================

const CDN = {
  cytoscape: 'https://unpkg.com/cytoscape/dist/cytoscape.min.js',
  cytoscapeDagre: 'https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js',
  soundfont: 'https://unpkg.com/soundfont-player@0.12.0/dist/soundfont-player.js',
  dagre: 'https://unpkg.com/dagre@0.8.5/dist/dagre.min.js'
};

// ============================================================
// LOAD FUNCTIONS
// ============================================================

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    // 이미 로드되었는지 확인
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      if (s.src && s.src.includes(src.split('/').pop())) {
        resolve();
        return;
      }
    }
    
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(script);
  });
}

export async function loadCytoscape() {
  await loadScript(CDN.cytoscape);
  await loadScript(CDN.dagre);
  await loadScript(CDN.cytoscapeDagre);
  
  // Cytoscape가 전역에 로드되었는지 확인
  if (typeof cytoscape === 'undefined') {
    throw new Error('Cytoscape failed to load');
  }
  
  return window.cytoscape;
}

export async function loadSoundfont() {
  await loadScript(CDN.soundfont);
  
  if (typeof Soundfont === 'undefined') {
    throw new Error('Soundfont-player failed to load');
  }
  
  return window.Soundfont;
}

export async function loadDagre() {
  await loadScript(CDN.dagre);
  
  if (typeof dagre === 'undefined') {
    throw new Error('Dagre failed to load');
  }
  
  return window.dagre;
}

// ============================================================
// PRELOAD ALL
// ============================================================

export async function preloadAll() {
  try {
    await loadCytoscape();
    await loadSoundfont();
    console.log('✅ 모든 라이브러리 로드 완료');
  } catch (e) {
    console.warn('⚠️ 라이브러리 로드 실패:', e.message);
  }
}

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.vendor = {
  loadCytoscape,
  loadSoundfont,
  loadDagre,
  preloadAll,
  CDN
};

export default {
  loadCytoscape,
  loadSoundfont,
  loadDagre,
  preloadAll,
  CDN
};