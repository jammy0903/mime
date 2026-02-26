// DC인사이드 핫갤/실베 크롤러

const SOURCE = 'dcinside';
const URLS = [
  'https://gall.dcinside.com/board/lists/?id=hit&page=1', // 핫갤
  'https://gall.dcinside.com/board/lists/?id=hit&page=2',
  'https://gall.dcinside.com/board/lists/?id=hit&page=3',
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
      console.error(`[DC] 크롤링 실패 ${url}:`, err.message);
    }
  }

  return posts;
}

function parseHtml(html) {
  const posts = [];

  // 글 제목 추출: <td class="gall_tit">...<a href="...">제목</a>...
  const titleRegex =
    /<td\s+class="gall_tit[^"]*"[^>]*>[\s\S]*?<a[^>]+href="[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/a>/g;
  let match;

  while ((match = titleRegex.exec(html)) !== null) {
    let title = match[1]
      .replace(/<[^>]+>/g, '') // HTML 태그 제거
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (title && title.length > 2 && !title.includes('설문') && !title.includes('공지')) {
      posts.push({
        text: title,
        source: SOURCE,
        timestamp: Date.now(),
        url: 'https://gall.dcinside.com',
      });
    }
  }

  return posts;
}

export const source = SOURCE;
