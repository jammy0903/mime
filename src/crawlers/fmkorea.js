// 에펨코리아 댓글 크롤러 (puppeteer-extra stealth)

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const BOARDS = [
  { url: 'https://www.fmkorea.com/index.php?mid=best&page=1', name: 'best' },
  { url: 'https://www.fmkorea.com/index.php?mid=best&page=2', name: 'best' },
  { url: 'https://www.fmkorea.com/index.php?mid=humor&page=1', name: 'humor' },
];

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const MAX_POSTS = 15; // 게시판당 최대 방문 글 수

export async function crawl() {
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    const allPosts = [];

    for (const board of BOARDS) {
      try {
        await page.goto(board.url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Turnstile 챌린지 대기
        const challenged = await page.evaluate(() =>
          document.title.includes('보안') || !!document.querySelector('.cf-turnstile')
        );
        if (challenged) {
          console.log(`[FM] Turnstile 챌린지 감지, 자동 해결 대기...`);
          await page.waitForFunction(
            () => !document.querySelector('.cf-turnstile') && !document.title.includes('보안'),
            { timeout: 20000 }
          ).catch(() => {});
        }

        // 글 URL 수집
        const postUrls = await page.evaluate(() => {
          const links = [];
          for (const a of document.querySelectorAll('h3.title a, td.title a')) {
            const href = a.getAttribute('href');
            if (href && /\/\d+$/.test(href)) {
              links.push(href.startsWith('http') ? href : 'https://www.fmkorea.com' + href);
            }
          }
          return [...new Set(links)];
        });

        const targets = postUrls.slice(0, MAX_POSTS);
        console.log(`[FM/${board.name}] ${targets.length}개 글 댓글 수집 시작`);

        for (const postUrl of targets) {
          try {
            await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 20000 });

            const comments = await page.evaluate(() => {
              const results = [];
              for (const el of document.querySelectorAll('.fdb_lst_ul .xe_content')) {
                const text = el.textContent.replace(/\s+/g, ' ').trim();
                if (text.length > 2) results.push(text);
              }
              return results;
            });

            // 글 ID를 source로 사용 (예: fm-9534433234)
            const postId = postUrl.match(/\/(\d+)$/)?.[1] || postUrl;
            const source = `fm-${postId}`;

            for (const text of comments) {
              allPosts.push({
                text,
                source,
                timestamp: Date.now(),
                url: postUrl,
              });
            }

            if (comments.length > 0) {
              console.log(`[FM] ${postId}: ${comments.length}개 댓글`);
            }
          } catch (err) {
            // 개별 글 실패는 무시
          }
        }
      } catch (err) {
        console.error(`[FM] 게시판 크롤링 실패 ${board.url}:`, err.message);
      }
    }

    console.log(`[FM] 총 ${allPosts.length}개 댓글 수집 완료`);
    return allPosts;
  } catch (err) {
    console.error(`[FM] 브라우저 실행 실패:`, err.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export const source = 'fmkorea';
