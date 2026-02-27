// 밈 레이더 - 웹앱 프론트엔드

const feed = document.getElementById('feed');
const btnRefresh = document.getElementById('btn-refresh');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsOverlay = document.getElementById('settings-overlay');
const trendCount = document.getElementById('trend-count');
const lastUpdateEl = document.getElementById('last-update');

// ─── 초기 로드 ───────────────────────────────────

init();

async function init() {
  await loadTrends();
  await loadStatus();
}

async function loadTrends() {
  try {
    const res = await fetch('/api/trends');
    const data = await res.json();
    renderFeed(data.trends || []);
  } catch (err) {
    console.error('트렌드 로드 실패:', err);
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔌</div>
        <p>데이터를 불러올 수 없습니다.<br>새로고침을 눌러주세요.</p>
      </div>`;
  }
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.lastCrawl) {
      lastUpdateEl.textContent = getTimeAgo(data.lastCrawl) + ' 업데이트';
    }
    if (data.stats) {
      renderStats(data.stats);
    }
  } catch {
    // ignore
  }
}

function renderStats(stats) {
  const bar = document.getElementById('stats-bar');
  if (!stats || stats.comments === 0) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = `
    <span class="stat-chip">댓글 <b>${stats.comments.toLocaleString()}</b>개</span>
    <span class="stat-chip">영상 <b>${stats.videos}</b>개</span>
    <span class="stat-chip">트렌드 <b>${stats.trends}</b>개</span>
  `;
}

// ─── 피드 렌더링 ─────────────────────────────────

function renderFeed(trends) {
  if (!trends || trends.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <p>아직 수집된 밈이 없습니다.<br>새로고침 버튼을 눌러 크롤링을 시작하세요!</p>
      </div>`;
    trendCount.textContent = '';
    return;
  }

  trendCount.textContent = trends.length;
  feed.innerHTML = '';

  trends.forEach((trend, index) => {
    const card = createCard(trend, index);
    feed.appendChild(card);
  });
}

function createCard(trend, index) {
  const card = document.createElement('div');
  card.className = 'meme-card';

  // 소스 태그 (영상 수 표시)
  const videoCount = trend.sources.length;
  const sourceTags = `<span class="source-tag tag-youtube">▶ YouTube ${videoCount}개 영상</span>`;

  const samples = trend.samples
    .map((s) => `<div class="sample-item">"${escapeHtml(s)}"</div>`)
    .join('');

  const typeLabel =
    trend.type === 'sentence' ? '문장 반복' :
    trend.type === 'keyword_pattern' ? '키워드 패턴' :
    trend.type === 'ngram' ? 'N-gram' : '기타';

  card.innerHTML = `
    <div class="card-top">
      <span class="card-rank">#${index + 1}</span>
      <span class="card-score">점수 ${trend.score}</span>
    </div>
    <div class="card-phrase">${escapeHtml(trend.phrase)}</div>
    <div class="card-meta">
      <span class="meta-item">${trend.count}회 등장</span>
      <span class="meta-item">${trend.sourceCount}개 영상</span>
      <span class="meta-item">${typeLabel}</span>
    </div>
    <div class="card-sources">${sourceTags}</div>
    ${samples ? `<details class="card-samples"><summary>사용 예시 보기</summary><div class="sample-list">${samples}</div></details>` : ''}
    ${
      trend.explanation
        ? `<div class="card-explanation">${formatExplanation(trend.explanation)}</div>`
        : `<button class="card-explain-btn" data-phrase="${escapeAttr(trend.phrase)}">🤖 AI에게 이 밈 설명 요청</button>`
    }
  `;

  const explainBtn = card.querySelector('.card-explain-btn');
  if (explainBtn) {
    explainBtn.addEventListener('click', () => requestExplanation(trend, card));
  }

  return card;
}

async function requestExplanation(trend, card) {
  const btn = card.querySelector('.card-explain-btn');
  btn.textContent = '🤖 설명 생성 중...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trend }),
    });

    const data = await res.json();

    if (data.explanation) {
      const div = document.createElement('div');
      div.className = 'card-explanation';
      div.innerHTML = formatExplanation(data.explanation);
      btn.replaceWith(div);
    } else {
      btn.textContent = '🤖 설명 생성 실패 - 다시 시도';
      btn.disabled = false;
    }
  } catch (err) {
    btn.textContent = '🤖 설명 생성 실패 - 다시 시도';
    btn.disabled = false;
    console.error('설명 요청 실패:', err);
  }
}

function formatExplanation(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// ─── 새로고침 ────────────────────────────────────

btnRefresh.addEventListener('click', async () => {
  btnRefresh.classList.add('spinning');
  feed.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>YouTube 댓글 수집 중...</p>
    </div>`;

  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    renderFeed(data.trends || []);
    loadStatus();
  } catch (err) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>크롤링 중 오류 발생<br>${escapeHtml(err.message)}</p>
      </div>`;
  }

  btnRefresh.classList.remove('spinning');
});

// ─── 설정 모달 ───────────────────────────────────

btnSettings.addEventListener('click', () => {
  settingsOverlay.classList.remove('hidden');
  loadSettingsForm();
});

btnCloseSettings.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

async function loadSettingsForm() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    const s = data.settings;

    document.getElementById('ai-provider').value = s.aiProvider || 'claude';
    document.getElementById('api-key').value = s.apiKey || '';
    document.getElementById('crawl-interval').value = String(s.crawlInterval || 30);
    document.getElementById('youtube-api-key').value = s.youtubeApiKey || '';
    document.getElementById('max-videos').value = String(s.maxVideos || 20);
  } catch (err) {
    console.error('설정 로드 실패:', err);
  }
}

document.getElementById('btn-save').addEventListener('click', async () => {
  const settings = {
    aiProvider: document.getElementById('ai-provider').value,
    apiKey: document.getElementById('api-key').value,
    crawlInterval: parseInt(document.getElementById('crawl-interval').value),
    youtubeApiKey: document.getElementById('youtube-api-key').value,
    maxVideos: parseInt(document.getElementById('max-videos').value),
    maxDays: 3,
  };

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });

    const status = document.getElementById('save-status');
    status.textContent = '저장됨!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (err) {
    console.error('설정 저장 실패:', err);
  }
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!confirm('수집된 모든 데이터를 삭제하시겠습니까?')) return;

  await fetch('/api/clear-data', { method: 'POST' });
  const status = document.getElementById('save-status');
  status.textContent = '데이터 초기화됨';
  setTimeout(() => { status.textContent = ''; }, 2000);
  renderFeed([]);
});

document.getElementById('btn-clear-cache').addEventListener('click', async () => {
  await fetch('/api/clear-cache', { method: 'POST' });
  const status = document.getElementById('save-status');
  status.textContent = 'AI 캐시 초기화됨';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

// ─── 유틸 ────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
