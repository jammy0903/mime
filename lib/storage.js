// Chrome Storage 래퍼

const STORAGE_KEYS = {
  CRAWL_DATA: 'crawl_data',
  TRENDS: 'trends',
  SETTINGS: 'settings',
  AI_CACHE: 'ai_cache',
  LAST_CRAWL: 'last_crawl',
};

const DEFAULT_SETTINGS = {
  aiProvider: 'claude',
  apiKey: '',
  crawlInterval: 30, // 분
  sources: {
    dcinside: true,
    fmkorea: true,
    instiz: true,
    yeosig: true,
  },
  maxDays: 3,
};

export async function get(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      resolve(result[key] ?? null);
    });
  });
}

export async function set(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

export async function getSettings() {
  const settings = await get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(settings) {
  await set(STORAGE_KEYS.SETTINGS, settings);
}

export async function getCrawlData() {
  return (await get(STORAGE_KEYS.CRAWL_DATA)) || [];
}

export async function saveCrawlData(data) {
  // 3일 이상 된 데이터 제거
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const filtered = data.filter((d) => d.timestamp > threeDaysAgo);
  await set(STORAGE_KEYS.CRAWL_DATA, filtered);
}

export async function getTrends() {
  return (await get(STORAGE_KEYS.TRENDS)) || [];
}

export async function saveTrends(trends) {
  await set(STORAGE_KEYS.TRENDS, trends);
}

export async function getAiCache() {
  return (await get(STORAGE_KEYS.AI_CACHE)) || {};
}

export async function setAiCache(cache) {
  await set(STORAGE_KEYS.AI_CACHE, cache);
}

export async function setLastCrawl(timestamp) {
  await set(STORAGE_KEYS.LAST_CRAWL, timestamp);
}

export async function getLastCrawl() {
  return await get(STORAGE_KEYS.LAST_CRAWL);
}

export { STORAGE_KEYS, DEFAULT_SETTINGS };
