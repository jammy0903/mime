// 개드립 댓글 크롤러 (puppeteer-extra stealth)

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const BOARDS = [
  'https://www.dogdrip.net/dogdrip?page=1',
  'https://www.dogdrip.net/dogdrip?page=2',
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

        // 글 URL 수집 (개드립: /숫자 형태)
        const postLinks = await page.evaluate(() => {
          const links = [];
          for (const a of document.querySelectorAll('a')) {
            const href = a.getAttribute('href') || '';
            const text = a.textContent.trim();
            if (/www\.dogdrip\.net\/\d{8,}/.test(href) && text.length > 3) {
              links.push(href);
            }
          }
          return links;
        });

        const targets = postLinks.filter(url => {
          const id = url.match(/\/(\d+)$/)?.[1];
          if (!id || visited.has(id)) return false;
          visited.add(id);
          return true;
        }).slice(0, MAX_POSTS);

        console.log(`[개드립] ${targets.length}개 글 댓글 수집 시작`);

        for (const postUrl of targets) {
          try {
            await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 15000 });

            const comments = await page.evaluate(() => {
              const results = [];
              // 개드립은 XE/Rhymix 기반 — .xe_content가 본문+댓글 모두 사용
              // 댓글 영역: .fdb_lst_ul 내부의 .xe_content
              const commentEls = document.querySelectorAll('.fdb_lst_ul .xe_content');
              if (commentEls.length > 0) {
                commentEls.forEach(el => {
                  const text = el.textContent.replace(/\s+/g, ' ').trim();
                  if (text.length > 2) results.push(text);
                });
              } else {
                // fallback: 댓글 영역 전체
                document.querySelectorAll('.xe_content').forEach((el, i) => {
                  if (i === 0) return; // 첫 번째는 본문
                  const text = el.textContent.replace(/\s+/g, ' ').trim();
                  if (text.length > 2) results.push(text);
                });
              }
              return results;
            });

            const postId = postUrl.match(/\/(\d+)$/)?.[1] || postUrl;
            const source = `dog-${postId}`;

            for (const text of comments) {
              allPosts.push({
                text,
                source,
                timestamp: Date.now(),
                url: postUrl,
              });
            }

            if (comments.length > 0) {
              console.log(`[개드립] ${postId}: ${comments.length}개 댓글`);
            }
          } catch (err) {
            // 개별 글 실패는 무시
          }
        }
      } catch (err) {
        console.error(`[개드립] 게시판 크롤링 실패:`, err.message);
      }
    }

    console.log(`[개드립] 총 ${allPosts.length}개 댓글 수집 완료`);
    return allPosts;
  } catch (err) {
    console.error(`[개드립] 브라우저 실행 실패:`, err.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export const source = 'dogdrip';
