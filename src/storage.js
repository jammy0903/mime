// 인메모리 스토리지

const DEFAULT_SETTINGS = {
  aiProvider: process.env.AI_PROVIDER || 'claude',
  apiKey: process.env.AI_API_KEY || '',
  crawlInterval: 30,
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  maxVideos: 80,
  maxDays: 3,
};

const store = {
  crawlData: [],
  trends: [],
  settings: { ...DEFAULT_SETTINGS },
  aiCache: {},
  lastCrawl: null,
};

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...store.settings };
}

export function saveSettings(settings) {
  // API 키가 마스킹된 값이면 기존 키 유지
  if (settings.apiKey === '••••••••') {
    settings.apiKey = store.settings.apiKey;
  }
  if (settings.youtubeApiKey === '••••••••') {
    settings.youtubeApiKey = store.settings.youtubeApiKey;
  }
  store.settings = { ...store.settings, ...settings };
}

export function getCrawlData() {
  return store.crawlData;
}

export function saveCrawlData(data) {
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  store.crawlData = data.filter((d) => d.timestamp > threeDaysAgo);
}

export function getTrends() {
  return store.trends;
}

export function saveTrends(trends) {
  store.trends = trends;
}

export function getAiCache() {
  return store.aiCache;
}

export function setAiCache(cache) {
  store.aiCache = cache;
}

export function getLastCrawl() {
  return store.lastCrawl;
}

export function setLastCrawl(timestamp) {
  store.lastCrawl = timestamp;
}

export function clearData() {
  store.crawlData = [];
  store.trends = [];
  store.lastCrawl = null;
}

export function clearAiCache() {
  store.aiCache = {};
}
