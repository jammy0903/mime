// 디시인사이드 실시간베스트 댓글 크롤러 (puppeteer-extra stealth)

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const BOARDS = [
  'https://gall.dcinside.com/board/lists/?id=dcbest&page=1',
  'https://gall.dcinside.com/board/lists/?id=dcbest&page=2',
];

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium-browser';
const MAX_POSTS = 15;

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
    const visited = new Set();

    for (const boardUrl of BOARDS) {
      try {
        await page.goto(boardUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // 글 URL 수집
        const postLinks = await page.evaluate(() => {
          const links = [];
          for (const a of document.querySelectorAll('td.gall_tit a:not(.reply_numbox)')) {
            const href = a.getAttribute('href');
            if (href && href.includes('/board/view/')) {
              links.push('https://gall.dcinside.com' + href);
            }
          }
          return links;
        });

        const targets = postLinks.filter(url => {
          const no = url.match(/no=(\d+)/)?.[1];
          if (!no || visited.has(no)) return false;
          visited.add(no);
          return true;
        }).slice(0, MAX_POSTS);

        console.log(`[DC] ${targets.length}개 글 댓글 수집 시작`);

        for (const postUrl of targets) {
          try {
            await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 15000 });

            const comments = await page.evaluate(() => {
              const results = [];
              for (const el of document.querySelectorAll('.cmt_txtbox .usertxt')) {
                const text = el.textContent.replace(/\s+/g, ' ').trim();
                if (text.length > 2) results.push(text);
              }
              return results;
            });

            const postId = postUrl.match(/no=(\d+)/)?.[1] || postUrl;
            const source = `dc-${postId}`;

            for (const text of comments) {
              allPosts.push({
                text,
                source,
                timestamp: Date.now(),
                url: postUrl,
              });
            }

            if (comments.length > 0) {
              console.log(`[DC] ${postId}: ${comments.length}개 댓글`);
            }
          } catch (err) {
            // 개별 글 실패는 무시
          }
        }
      } catch (err) {
        console.error(`[DC] 게시판 크롤링 실패:`, err.message);
      }
    }

    console.log(`[DC] 총 ${allPosts.length}개 댓글 수집 완료`);
    return allPosts;
  } catch (err) {
    console.error(`[DC] 브라우저 실행 실패:`, err.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export const source = 'dcinside';
