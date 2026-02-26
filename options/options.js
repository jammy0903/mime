// 밈 레이더 - 옵션 페이지

const elProvider = document.getElementById('ai-provider');
const elApiKey = document.getElementById('api-key');
const elInterval = document.getElementById('crawl-interval');
const elSrcDc = document.getElementById('src-dcinside');
const elSrcFm = document.getElementById('src-fmkorea');
const elSrcInstiz = document.getElementById('src-instiz');
const elSrcYeosig = document.getElementById('src-yeosig');
const btnSave = document.getElementById('btn-save');
const btnClear = document.getElementById('btn-clear');
const btnClearCache = document.getElementById('btn-clear-cache');
const saveStatus = document.getElementById('save-status');

// 설정 로드
loadSettings();

async function loadSettings() {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || {};

  elProvider.value = settings.aiProvider || 'claude';
  elApiKey.value = settings.apiKey || '';
  elInterval.value = String(settings.crawlInterval || 30);

  const sources = settings.sources || {
    dcinside: true,
    fmkorea: true,
    instiz: true,
    yeosig: true,
  };
  elSrcDc.checked = sources.dcinside !== false;
  elSrcFm.checked = sources.fmkorea !== false;
  elSrcInstiz.checked = sources.instiz !== false;
  elSrcYeosig.checked = sources.yeosig !== false;
}

// 저장
btnSave.addEventListener('click', async () => {
  const settings = {
    aiProvider: elProvider.value,
    apiKey: elApiKey.value,
    crawlInterval: parseInt(elInterval.value),
    sources: {
      dcinside: elSrcDc.checked,
      fmkorea: elSrcFm.checked,
      instiz: elSrcInstiz.checked,
      yeosig: elSrcYeosig.checked,
    },
    maxDays: 3,
  };

  await chrome.storage.local.set({ settings });

  // 알람 주기 업데이트
  await chrome.alarms.clear('crawl');
  await chrome.alarms.create('crawl', {
    periodInMinutes: settings.crawlInterval,
  });

  saveStatus.textContent = '저장됨!';
  setTimeout(() => {
    saveStatus.textContent = '';
  }, 2000);
});

// 데이터 초기화
btnClear.addEventListener('click', async () => {
  if (confirm('수집된 모든 데이터를 삭제하시겠습니까?')) {
    await chrome.storage.local.remove(['crawl_data', 'trends', 'last_crawl']);
    saveStatus.textContent = '데이터 초기화됨';
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 2000);
  }
});

// AI 캐시 초기화
btnClearCache.addEventListener('click', async () => {
  await chrome.storage.local.remove(['ai_cache']);
  saveStatus.textContent = 'AI 캐시 초기화됨';
  setTimeout(() => {
    saveStatus.textContent = '';
  }, 2000);
});
