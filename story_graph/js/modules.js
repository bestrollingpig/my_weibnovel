// ============================================================
// MODULES - 분석/비평 프롬프트, 결과 처리, 통계
// ============================================================

import { state } from './state.js';
import { showToast } from './app.js';
import { syncCytoscapeFromNodes, updateGraphCounts } from './graph.js';

// ============================================================
// ANALYSIS PROMPT
// ============================================================

export const ANALYSIS_PROMPT = `당신은 소설 분석 전문가입니다. 다음 텍스트에서 등장인물, 장소, 사건, 아이템을 추출하고, 각 개체 간의 관계를 JSON 형식으로 출력해주세요.

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

export const CRITIQUE_PROMPT = `# 웹소설 형식·내용·친절함 통합 비평 시스템 (Reader-First 100pt)

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

export function copyWithPrompt() {
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

export function copyCritiquePrompt() {
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

export function autoFixJSON(raw) {
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

export function applyGraphData(data) {
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

export function processPastedResult() {
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

export function autoFixAndProcess() {
  const raw = document.getElementById('resultPasteArea').value.trim();
  if (!raw) {
    showToast('⚠️ 분석 결과를 먼저 붙여넣어주세요.');
    return;
  }
  const fixed = autoFixJSON(raw);
  document.getElementById('resultPasteArea').value = fixed;
  processPastedResult();
}

export function clearResultArea() {
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
      emotion: n.emotion || '중립'
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

export function processCritiqueResult() {
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

export function renderCritiqueResult(data) {
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
  drawRadarChart(document.getElementById('radarChart'), scores, items);
  showToast('📊 비평 결과가 표시되었습니다!');
}

// ============================================================
// RADAR CHART
// ============================================================

export function drawRadarChart(canvas, scores, labels) {
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

// ============================================================
// EXPOSE TO GLOBAL
// ============================================================

window.modules = {
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

export default {
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