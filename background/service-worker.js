// 밈 레이더 - 백그라운드 서비스 워커

import * as dcinside from '../lib/crawlers/dcinside.js';
import * as fmkorea from '../lib/crawlers/fmkorea.js';
import * as instiz from '../lib/crawlers/instiz.js';
import * as yeosig from '../lib/crawlers/yeosig.js';
import { analyzePosts } from '../lib/analyzer.js';
import { explainMeme } from '../lib/ai-provider.js';
import * as storage from '../lib/storage.js';

const crawlers = { dcinside, fmkorea, instiz, yeosig };

// 확장프로그램 설치/업데이트 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('[밈 레이더] 설치됨');
  // 30분마다 크롤링 알람
  chrome.alarms.create('crawl', { periodInMinutes: 30 });
  // 설치 직후 첫 크롤링
  runCrawl();
});

// 알람 핸들러
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'crawl') {
    runCrawl();
  }
});

// 팝업에서 오는 메시지 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_TRENDS') {
    storage.getTrends().then((trends) => sendResponse({ trends }));
    return true; // 비동기 응답
  }

  if (message.type === 'REFRESH') {
    runCrawl().then(() => {
      storage.getTrends().then((trends) => sendResponse({ trends }));
    });
    return true;
  }

  if (message.type === 'EXPLAIN_MEME') {
    storage.getSettings().then((settings) => {
      explainMeme(message.trend, settings).then((explanation) => {
        // 캐시에 저장
        storage.getAiCache().then((cache) => {
          cache[message.trend.phrase] = {
            explanation,
            timestamp: Date.now(),
          };
          storage.setAiCache(cache);
        });
        sendResponse({ explanation });
      });
    });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    storage.getLastCrawl().then((lastCrawl) => {
      sendResponse({ lastCrawl });
    });
    return true;
  }
});

// 메인 크롤링 로직
async function runCrawl() {
  console.log('[밈 레이더] 크롤링 시작...');
  const settings = await storage.getSettings();

  // 활성화된 소스만 크롤링
  const allPosts = [];
  const crawlPromises = [];

  for (const [name, crawler] of Object.entries(crawlers)) {
    if (settings.sources[name]) {
      crawlPromises.push(
        crawler.crawl().then((posts) => {
          console.log(`[밈 레이더] ${name}: ${posts.length}개 수집`);
          allPosts.push(...posts);
        }).catch((err) => {
          console.error(`[밈 레이더] ${name} 크롤링 실패:`, err);
        })
      );
    }
  }

  await Promise.all(crawlPromises);

  if (allPosts.length === 0) {
    console.log('[밈 레이더] 수집된 데이터 없음');
    return;
  }

  // 기존 데이터와 합치기
  const existingData = await storage.getCrawlData();
  const combined = [...existingData, ...allPosts];
  await storage.saveCrawlData(combined);

  // 3단계 밈 분석
  const trends = analyzePosts(combined);

  // AI 캐시에서 기존 설명 가져오기
  const aiCache = await storage.getAiCache();
  for (const trend of trends) {
    if (aiCache[trend.phrase]) {
      trend.explanation = aiCache[trend.phrase].explanation;
    }
  }

  await storage.saveTrends(trends);
  await storage.setLastCrawl(Date.now());

  // 뱃지 업데이트
  const newCount = trends.filter((t) => !t.explanation).length;
  if (newCount > 0) {
    chrome.action.setBadgeText({ text: String(trends.length) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF6B6B' });
  }

  console.log(`[밈 레이더] 완료! ${trends.length}개 트렌드 발견`);
}
