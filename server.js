import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as youtube from './src/crawlers/youtube.js';
import * as fmkorea from './src/crawlers/fmkorea.js';
import * as dcinside from './src/crawlers/dcinside.js';
import * as dogdrip from './src/crawlers/dogdrip.js';
import { analyzePosts } from './src/analyzer.js';
import { explainMeme } from './src/ai-provider.js';
import * as storage from './src/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── 크롤링 로직 ─────────────────────────────────

async function runCrawl() {
  console.log('[밈 레이더] 크롤링 시작...');
  const settings = storage.getSettings();

  try {
    // 소스별 24시간 캐시 확인
    const sources = [
      { key: 'youtube', crawl: () => youtube.crawl(settings), label: 'YouTube' },
      { key: 'fmkorea',  crawl: () => fmkorea.crawl(),        label: 'FM' },
      { key: 'dcinside', crawl: () => dcinside.crawl(),       label: 'DC' },
      { key: 'dogdrip',  crawl: () => dogdrip.crawl(),        label: '개드립' },
    ];

    // 순차 크롤링 (puppeteer 메모리 절약)
    const allCrawled = [];
    for (const s of sources) {
      const cached = storage.getCrawlCache(s.key);
      if (cached) {
        console.log(`[${s.label}] 캐시 사용 (${cached.length}개)`);
        allCrawled.push(cached);
        continue;
      }
      try {
        const posts = await s.crawl();
        if (posts.length > 0) storage.setCrawlCache(s.key, posts);
        allCrawled.push(posts);
      } catch (err) {
        console.error(`[${s.label}] 크롤링 실패:`, err.message);
        allCrawled.push([]);
      }
    }

    const counts = sources.map((s, i) => `${s.label}: ${allCrawled[i].length}개`).join(', ');
    console.log(`[밈 레이더] ${counts} 수집`);

    const posts = allCrawled.flat();

    if (posts.length === 0) {
      console.log('[밈 레이더] 수집된 데이터 없음');
      return [];
    }

    // 기존 데이터와 합치기
    const existingData = storage.getCrawlData();
    const combined = [...existingData, ...posts];
    storage.saveCrawlData(combined);

    // 3단계 밈 분석
    const trends = await analyzePosts(combined);

    // AI 캐시에서 기존 설명 복원
    const aiCache = storage.getAiCache();
    for (const trend of trends) {
      if (aiCache[trend.phrase]) {
        trend.explanation = aiCache[trend.phrase].explanation;
      }
    }

    storage.saveTrends(trends);
    storage.setLastCrawl(Date.now());

    console.log(`[밈 레이더] 완료! ${trends.length}개 트렌드 발견`);
    return trends;
  } catch (err) {
    console.error('[밈 레이더] 크롤링 실패:', err.message);
    return [];
  }
}

// ─── API 라우트 ──────────────────────────────────

// 트렌드 조회
app.get('/api/trends', (req, res) => {
  const trends = storage.getTrends();
  res.json({ trends });
});

// 수동 크롤링 (force=true로 캐시 무시)
app.post('/api/refresh', async (req, res) => {
  try {
    if (req.body.force) {
      storage.clearCrawlCache();
      console.log('[밈 레이더] 캐시 초기화 (강제 새로고침)');
    }
    const trends = await runCrawl();
    res.json({ trends });
  } catch (err) {
    console.error('크롤링 오류:', err);
    res.status(500).json({ error: err.message });
  }
});

// AI 밈 설명
app.post('/api/explain', async (req, res) => {
  try {
    const { trend } = req.body;
    const settings = storage.getSettings();
    const explanation = await explainMeme(trend, settings);

    // 캐시 저장
    const cache = storage.getAiCache();
    cache[trend.phrase] = { explanation, timestamp: Date.now() };
    storage.setAiCache(cache);

    res.json({ explanation });
  } catch (err) {
    console.error('AI 설명 오류:', err);
    res.status(500).json({ error: err.message });
  }
});

// 상태 조회
app.get('/api/status', (req, res) => {
  const lastCrawl = storage.getLastCrawl();
  const crawlData = storage.getCrawlData();
  const videoSet = new Set(crawlData.map(d => d.source));
  res.json({
    lastCrawl,
    stats: {
      comments: crawlData.length,
      videos: videoSet.size,
      trends: storage.getTrends().length,
    },
  });
});

// 설정 조회
app.get('/api/settings', (req, res) => {
  const settings = storage.getSettings();
  const safe = {
    ...settings,
    apiKey: settings.apiKey ? '••••••••' : '',
    youtubeApiKey: settings.youtubeApiKey ? '••••••••' : '',
  };
  res.json({ settings: safe });
});

// 설정 저장
app.post('/api/settings', (req, res) => {
  const { settings } = req.body;
  storage.saveSettings(settings);
  res.json({ ok: true });
});

// 데이터 초기화
app.post('/api/clear-data', (req, res) => {
  storage.clearData();
  storage.clearCrawlCache();
  res.json({ ok: true });
});

// AI 캐시 초기화
app.post('/api/clear-cache', (req, res) => {
  storage.clearAiCache();
  res.json({ ok: true });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// ─── 서버 시작 ───────────────────────────────────

app.listen(PORT, () => {
  console.log(`[밈 레이더] 서버 시작: http://localhost:${PORT}`);

  // 시작 시 첫 크롤링
  runCrawl();

  // 주기적 자동 크롤링
  const settings = storage.getSettings();
  setInterval(() => {
    runCrawl();
  }, settings.crawlInterval * 60 * 1000);
});
