// 인스티즈 크롤러

const SOURCE = 'instiz';
const URLS = [
  'https://www.instiz.net/pt?page=1', // 익명잡담 (이슈)
  'https://www.instiz.net/pt?page=2',
  'https://www.instiz.net/pt?page=3',
  'https://www.instiz.net/pt?category=1&page=1', // 핫토픽
];

export async function crawl() {
  const posts = [];

  for (const url of URLS) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      });

      if (!response.ok) continue;

      const html = await response.text();
      const extracted = parseHtml(html);
      posts.push(...extracted);
    } catch (err) {
      console.error(`[인스티즈] 크롤링 실패 ${url}:`, err.message);
    }
  }

  return posts;
}

function parseHtml(html) {
  const posts = [];

  // 인스티즈 글 제목 패턴: <a ... class="...listsubject..."...>제목</a>
  const patterns = [
    /<a[^>]+class="[^"]*listsubject[^"]*"[^>]*>([\s\S]*?)<\/a>/g,
    /<td\s+class="[^"]*listsubject[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g,
    /<span\s+class="[^"]*subject[^"]*"[^>]*>([\s\S]*?)<\/span>/g,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      let title = match[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      if (title && title.length > 2 && !title.includes('공지') && !title.includes('광고')) {
        posts.push({
          text: title,
          source: SOURCE,
          timestamp: Date.now(),
          url: 'https://www.instiz.net',
        });
      }
    }
  }

  return posts;
}

export const source = SOURCE;
