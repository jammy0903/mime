// 인스티즈 댓글 크롤러

const BOARDS = [
  { url: 'https://www.instiz.net/pt?page=1', name: '익잡' },
  { url: 'https://www.instiz.net/pt?page=2', name: '익잡' },
  { url: 'https://www.instiz.net/pt?category=1&page=1', name: '핫토픽' },
];

const MAX_POSTS = 15; // 게시판당 최대 방문 글 수
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

export async function crawl() {
  const allPosts = [];

  for (const board of BOARDS) {
    try {
      // 1. 게시판 페이지에서 글 URL 수집
      const response = await fetch(board.url, { headers: HEADERS });
      if (!response.ok) continue;

      const html = await response.text();
      const postUrls = [...html.matchAll(/href="(https:\/\/www\.instiz\.net\/pt\/(\d+)[^"]*)"/g)]
        .map(m => ({ url: m[1].replace(/\?.*/, ''), id: m[2] }));

      // 중복 제거
      const seen = new Set();
      const unique = postUrls.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });

      const targets = unique.slice(0, MAX_POSTS);
      console.log(`[인스티즈/${board.name}] ${targets.length}개 글 댓글 수집 시작`);

      // 2. 각 글 방문하여 댓글 수집 (5개씩 병렬)
      const BATCH = 5;
      for (let i = 0; i < targets.length; i += BATCH) {
        const batch = targets.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(async (post) => {
          const res = await fetch(post.url, { headers: HEADERS });
          if (!res.ok) return [];

          const postHtml = await res.text();
          const comments = extractComments(postHtml);
          if (comments.length > 0) {
            console.log(`[인스티즈] ${post.id}: ${comments.length}개 댓글`);
          }
          return comments.map(text => ({
            text,
            source: `iz-${post.id}`,
            timestamp: Date.now(),
            url: post.url,
          }));
        }));

        for (const r of results) {
          if (r.status === 'fulfilled') allPosts.push(...r.value);
        }
      }
    } catch (err) {
      console.error(`[인스티즈] 게시판 크롤링 실패 ${board.url}:`, err.message);
    }
  }

  console.log(`[인스티즈] 총 ${allPosts.length}개 댓글 수집 완료`);
  return allPosts;
}

function extractComments(html) {
  const comments = [];

  // 인스티즈 댓글: <span id="n숫자">댓글내용</span>
  const matches = [...html.matchAll(/<span[^>]+id="n(\d+)"[^>]*>([\s\S]*?)<\/span>/g)];

  for (const m of matches) {
    let text = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // 노이즈 스킵: 숫자만, 비로그인 안내 문구
    if (text.length > 2
        && !/^\d+$/.test(text)
        && !text.includes('로그인 후 이용해')
        && !text.includes('회원만 볼 수 있어요')) {
      comments.push(text);
    }
  }

  return comments;
}

export const source = 'instiz';
