// 밈 레이더 - 팝업 UI

const feed = document.getElementById('feed');
const btnRefresh = document.getElementById('btn-refresh');
const btnSettings = document.getElementById('btn-settings');
const statusText = document.getElementById('status-text');
const lastUpdate = document.getElementById('last-update');

const SOURCE_NAMES = {
  dcinside: 'DC인사이드',
  fmkorea: '에펨코리아',
  instiz: '인스티즈',
  yeosig: '여성시대',
};

// 초기 로드
init();

async function init() {
  await loadTrends();
  await loadStatus();
}

async function loadTrends() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TRENDS' });
    renderFeed(response.trends || []);
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
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (response.lastCrawl) {
      const ago = getTimeAgo(response.lastCrawl);
      lastUpdate.textContent = `${ago} 업데이트`;
    }
  } catch {
    // ignore
  }
}

function renderFeed(trends) {
  if (!trends || trends.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <p>아직 수집된 밈이 없습니다.<br>새로고침 버튼을 눌러 크롤링을 시작하세요!</p>
      </div>`;
    statusText.textContent = '데이터 없음';
    return;
  }

  statusText.textContent = `${trends.length}개 트렌드 감지`;
  feed.innerHTML = '';

  trends.forEach((trend, index) => {
    const card = createCard(trend, index);
    feed.appendChild(card);
  });
}

function createCard(trend, index) {
  const card = document.createElement('div');
  card.className = 'meme-card';

  // 소스 태그
  const sourceTags = trend.sources
    .map(
      (s) =>
        `<span class="source-tag tag-${s}">${SOURCE_NAMES[s] || s}</span>`
    )
    .join('');

  // 샘플 텍스트
  const samples = trend.samples
    .map((s) => `<div class="sample-item">"${escapeHtml(s)}"</div>`)
    .join('');

  card.innerHTML = `
    <div class="card-top">
      <span class="card-rank">#${index + 1}</span>
      <span class="card-score">점수 ${trend.score}</span>
    </div>
    <div class="card-phrase">${escapeHtml(trend.phrase)}</div>
    <div class="card-meta">
      <span class="meta-item">${trend.count}회 등장</span>
      <span class="meta-item">${trend.sourceCount}개 커뮤니티</span>
      <span class="meta-item">${trend.type === 'sentence' ? '문장 반복' : trend.type === 'keyword_pattern' ? '키워드 패턴' : '부분문자열'}</span>
    </div>
    <div class="card-sources">${sourceTags}</div>
    ${samples ? `<details class="card-samples"><summary>사용 예시 보기</summary><div class="sample-list">${samples}</div></details>` : ''}
    ${
      trend.explanation
        ? `<div class="card-explanation">${formatExplanation(trend.explanation)}</div>`
        : `<button class="card-explain-btn" data-phrase="${escapeAttr(trend.phrase)}">🤖 AI에게 이 밈 설명 요청</button>`
    }
  `;

  // AI 설명 버튼 이벤트
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
    const response = await chrome.runtime.sendMessage({
      type: 'EXPLAIN_MEME',
      trend,
    });

    if (response.explanation) {
      btn.replaceWith(createExplanationEl(response.explanation));
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

function createExplanationEl(text) {
  const div = document.createElement('div');
  div.className = 'card-explanation';
  div.innerHTML = formatExplanation(text);
  return div;
}

function formatExplanation(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

// 새로고침
btnRefresh.addEventListener('click', async () => {
  btnRefresh.classList.add('spinning');
  feed.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>커뮤니티 크롤링 중...</p>
    </div>`;
  statusText.textContent = '크롤링 중...';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'REFRESH' });
    renderFeed(response.trends || []);
    await loadStatus();
  } catch (err) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>크롤링 중 오류 발생<br>${escapeHtml(err.message)}</p>
      </div>`;
  }

  btnRefresh.classList.remove('spinning');
});

// 설정
btnSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 유틸
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
