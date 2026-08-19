// ============================================================
// GRAPH - Cytoscape 그래프, 필터, 효과, 레이아웃, 노드 위키
// ============================================================

import { state } from './state.js';
import { showToast } from './app.js';

// ============================================================
// COLOR MAP (state에서 가져오기)
// ============================================================

const COLORS = state.COLOR_MAP;
const TYPE_ICON = state.TYPE_ICON;
const TYPE_LABEL = state.TYPE_LABEL;

// ============================================================
// CYTOSCAPE INIT
// ============================================================

export function initCytoscape() {
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
  });

  setTimeout(function() {
    if (state.cy) { 
      state.cy.resize(); 
      state.cy.fit(null, 50); 
    }
  }, 100);

  state.cy.on('layoutstop', function() { 
    setTimeout(updateNodeOverlays, 100); 
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

export function syncCytoscapeFromNodes() {
  if (!state.cy) return;
  state.cy.elements().remove();
  state.cy.add(getCytoscapeElements());
  state.cy.layout({
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
  }).run();
  updateGraphCounts();
  if (state.breatheActive) startBreathe();
  if (state.springActive) startSpring();
  setTimeout(updateNodeOverlays, 600);
}

// ============================================================
// FILTERS
// ============================================================

export function applyFilters() {
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
}

export function toggleFilter(type, el) {
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

export function updateGraphCounts() {
  document.getElementById('graphCount').textContent = `노드 ${state.nodes.size} · 엣지 ${state.edges.length}`;
}

// ============================================================
// NODE SELECTION
// ============================================================

export function selectNode(node) {
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

export function updateNodeType(name, type) {
  const n = state.nodes.get(name);
  if (n) { 
    n.type = type; 
    syncCytoscapeFromNodes(); 
  }
}

export function updateNodeColor(name, color) {
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

export function updateNodeImage(name, url) {
  const nd = state.nodes.get(name);
  if (nd) {
    nd.image = url;
    if (state.cy) {
      const n = state.cy.getElementById(name);
      if (n.length) n.data('image', url);
    }
    updateNodeOverlays();
  }
}

export function saveNodeWiki(name) {
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
    updateNodeOverlays();
  }
}

export function removeNode(name) {
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

export function toggleBreathe() {
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

export function toggleSpring() {
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

export function runGraphLayout(name) {
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
  layout.on('layoutstop', updateNodeOverlays);
  layout.run();
  showToast('📐 레이아웃: ' + name);
}

// ============================================================
// GRAPH CONTROLS
// ============================================================

export function zoomGraph(factor) {
  if (!state.cy) return;
  const zoom = state.cy.zoom() * factor;
  state.cy.zoom({ level: Math.min(2, Math.max(0.2, zoom)) });
}

export function resetGraphView() {
  if (!state.cy) return;
  state.cy.fit();
  state.cy.zoom(1);
  state.cy.pan({ x: 0, y: 0 });
  if (state.breatheActive) startBreathe();
  if (state.springActive) startSpring();
}

export function exportPNG(toClipboard) {
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

export function openGraphFloating() {
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
  });
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

export function closeGraphFloating() {
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

export function updateNodeOverlays() {
  const overlayLayer = document.getElementById('overlays');
  if (!overlayLayer || !state.cy) return;
  const nodes = state.cy.nodes();
  const activeIds = new Set();
  nodes.forEach(node => {
    const raw = node.data('image');
    if (!raw || !raw.trim()) return;
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
        const content = raw.startsWith('http') && (raw.match(/\.(jpe?g|png|gif|webp|svg)/i) || raw.includes('youtube') || raw.includes('youtu.be'))
          ? (raw.includes('youtube') || raw.includes('youtu.be')
            ? `<iframe src="https://www.youtube.com/embed/${getYouTubeId(raw)}" allowfullscreen></iframe>`
            : `<img src="${raw}" onerror="this.outerHTML='<div style=color:red;font-size:11px;>❌ 이미지 로드 실패</div>'">`)
          : `<div class="node-content-text">${raw.replace(/\n/g,'<br>')}</div>`;
        pop.innerHTML = content + '<div class="close-btn" onclick="window.graph.toggleNodeOverlay(\''+nid+'\')">접기</div>';
        overlayLayer.appendChild(pop);
      }
      pop.style.display = 'block';
      pop.style.left = Math.max(5, Math.min(window.innerWidth - 200, pos.x - pop.offsetWidth/2)) + 'px';
      pop.style.top = (pos.y + h/2 + 5) + 'px';
    } else {
      if (pop) pop.remove();
    }
  });
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

export function toggleNodeOverlay(nid) {
  if (state.openImageNodes.has(nid)) state.openImageNodes.delete(nid);
  else state.openImageNodes.add(nid);
  updateNodeOverlays();
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

export function cycleWikiMode() {
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

export async function loadGraphForCurrentFile() {
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
          emotion: e.emotion || '중립'
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
    syncCytoscapeFromNodes();
  } catch (e) {}
}

// ============================================================
// EXPORT GRAPH TO CLIPBOARD
// ============================================================

export function exportGraphToClipboard() {
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

export function populateVoiceSelects() {
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

export function onTtsProviderChange() {
  populateVoiceSelects();
}

let wikiTtsStopped = false;

export function readWikiText() {
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

export function stopReading() {
  wikiTtsStopped = true;
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

export function addVoiceMapping() {
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

export function removeVoiceMapping(index) {
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

export default {
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