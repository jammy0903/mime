// YouTube 댓글 크롤러
// Mode A: YouTube Data API v3 (API 키 있을 때)
// Mode B: youtubei.js / InnerTube (API 키 없거나 할당량 초과 시 폴백)

import { Innertube } from 'youtubei.js';

const MAX_COMMENTS_PER_VIDEO = 100;

// 밈 발견을 위한 검색 쿼리
// 핵심: 다양한 장르의 인기 영상 + 밈 생산지
const TRENDING_QUERIES = [
  // 밈 직접 검색
  { q: '밈', upload_date: 'week', sort_by: 'view_count' },
  { q: '밈 모음', upload_date: 'month', sort_by: 'view_count' },
  { q: '요즘 유행', upload_date: 'week', sort_by: 'view_count' },
  { q: '유행어', upload_date: 'month', sort_by: 'view_count' },
  { q: '드립', upload_date: 'week', sort_by: 'view_count' },
  { q: '짤', upload_date: 'week', sort_by: 'view_count' },
  // 밈 생산지 크리에이터
  { q: '침착맨', upload_date: 'month', sort_by: 'view_count' },
  { q: '피식대학', upload_date: 'month', sort_by: 'view_count' },
  { q: '숏박스', upload_date: 'month', sort_by: 'view_count' },
  { q: '신서유기', upload_date: 'month', sort_by: 'view_count' },
  { q: '웃긴 숏츠', upload_date: 'week', sort_by: 'view_count' },
  // 다양한 장르 인기 영상 (밈이 퍼진 곳)
  { q: '레전드', upload_date: 'week', sort_by: 'view_count' },
  { q: '핫클립', upload_date: 'week', sort_by: 'view_count' },
  { q: '리액션', upload_date: 'week', sort_by: 'view_count' },
  { q: '브이로그', upload_date: 'week', sort_by: 'view_count' },
];

/**
 * 메인 크롤링 함수
 * @param {object} settings - { youtubeApiKey, maxVideos }
 * @returns {Promise<Array>} - 댓글 데이터 배열
 */
export async function crawl(settings = {}) {
  const { youtubeApiKey, maxVideos = 20 } = settings;

  // API 키가 있으면 Data API 먼저 시도
  if (youtubeApiKey) {
    try {
      const result = await crawlWithDataApi(youtubeApiKey, maxVideos);
      console.log(`[YouTube] Data API: ${result.length}개 댓글 수집`);
      return result;
    } catch (err) {
      // 할당량 초과(403) 또는 기타 API 오류 → youtubei.js 폴백
      console.warn(`[YouTube] Data API 실패 (${err.message}), InnerTube 폴백...`);
    }
  }

  // Mode B: youtubei.js 폴백
  try {
    const result = await crawlWithInnerTube(maxVideos);
    console.log(`[YouTube] InnerTube: ${result.length}개 댓글 수집`);
    return result;
  } catch (err) {
    console.error('[YouTube] InnerTube 폴백도 실패:', err.message);
    return [];
  }
}

// ─── Mode A: YouTube Data API v3 ────────────────────

async function crawlWithDataApi(apiKey, maxVideos) {
  // 1. 한국 인기 동영상 가져오기
  const videosUrl = `https://www.googleapis.com/youtube/v3/videos?` +
    `chart=mostPopular&regionCode=KR&maxResults=${maxVideos}` +
    `&part=snippet&key=${apiKey}`;

  const videosRes = await fetch(videosUrl);
  if (!videosRes.ok) {
    const errText = await videosRes.text();
    throw new Error(`Videos API ${videosRes.status}: ${errText}`);
  }

  const videosData = await videosRes.json();
  const videos = (videosData.items || [])
    .map((v) => ({ id: v.id, title: v.snippet.title }))
    .filter((v) => !isPoliticsOrEntertainmentVideo(v.title));

  if (videos.length === 0) {
    throw new Error('인기 동영상 없음');
  }

  // 2. 각 영상별 댓글 수집 (병렬)
  const allComments = [];
  const commentPromises = videos.map(async (video) => {
    try {
      const comments = await fetchCommentsDataApi(video, apiKey);
      allComments.push(...comments);
    } catch (err) {
      console.warn(`[YouTube] 댓글 수집 실패 (${video.id}):`, err.message);
    }
  });

  await Promise.all(commentPromises);
  return allComments;
}

async function fetchCommentsDataApi(video, apiKey) {
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?` +
    `videoId=${video.id}&maxResults=100&order=relevance` +
    `&part=snippet&textFormat=plainText&key=${apiKey}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 403) {
      const errText = await res.text();
      if (errText.includes('commentsDisabled')) {
        throw new Error('댓글 비활성화');
      }
      throw new Error(`403: ${errText}`);
    }
    throw new Error(`Comments API ${res.status}`);
  }

  const data = await res.json();
  return (data.items || [])
    .map((item) => {
      const snippet = item.snippet.topLevelComment.snippet;
      return {
        text: snippet.textDisplay,
        likes: snippet.likeCount || 0,
        source: video.id,
        sourceTitle: video.title,
        timestamp: new Date(snippet.publishedAt).getTime(),
        url: `https://www.youtube.com/watch?v=${video.id}`,
      };
    })
    .filter((c) => !isNoiseComment(c.text));
}

// ─── Mode B: youtubei.js (InnerTube) ────────────────

async function crawlWithInnerTube(maxVideos) {
  const yt = await Innertube.create({
    lang: 'ko',
    location: 'KR',
    retrieve_player: false,
  });

  // 1. 실시간 인기/조회수 상위 영상 가져오기
  console.log('[YouTube/IT] 실시간 인기 영상 수집 중...');
  const videos = [];
  const seenIds = new Set();

  for (const tq of TRENDING_QUERIES) {
    if (videos.length >= maxVideos) break;

    try {
      const search = await yt.search(tq.q, {
        sort_by: tq.sort_by,
        upload_date: tq.upload_date,
      });
      const results = search.results?.filter(r => r.type === 'Video' && r.id) || [];

      for (const r of results) {
        if (seenIds.has(r.id)) continue;
        const title = r.title?.text || r.title?.toString() || '';
        // 정치/연예 영상 스킵
        if (isPoliticsOrEntertainmentVideo(title)) continue;
        seenIds.add(r.id);
        videos.push({ id: r.id, title });
        if (videos.length >= maxVideos) break;
      }
    } catch (err) {
      console.warn(`[YouTube/IT] 검색 실패 (${tq.q}):`, err.message);
    }
  }

  if (videos.length === 0) {
    throw new Error('검색으로 영상을 찾을 수 없음');
  }

  console.log(`[YouTube/IT] ${videos.length}개 영상 발견`);

  // 2. 각 영상별 댓글 수집 (배치)
  const allComments = [];
  const batchSize = 3;

  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    const promises = batch.map(async (video) => {
      try {
        const comments = await fetchCommentsInnerTube(yt, video);
        allComments.push(...comments);
        if (comments.length > 0) {
          console.log(`[YouTube/IT] ${video.id}: ${comments.length}개 댓글`);
        }
      } catch (err) {
        // 댓글 없는 영상은 조용히 스킵
      }
    });
    await Promise.all(promises);
  }

  return allComments;
}

async function fetchCommentsInnerTube(yt, video) {
  const comments = [];

  const commentThread = await yt.getComments(video.id);

  if (!commentThread || !commentThread.contents) {
    return comments;
  }

  // 댓글 수집
  for (const thread of commentThread.contents) {
    const comment = thread.comment;
    if (!comment) continue;

    const text = comment.content?.text || comment.content?.toString() || '';
    const likes = parseInt(comment.like_count, 10) || 0;
    if (text && !isNoiseComment(text)) {
      comments.push({
        text,
        likes,
        source: video.id,
        sourceTitle: video.title,
        timestamp: Date.now(),
        url: `https://www.youtube.com/watch?v=${video.id}`,
      });
    }

    if (comments.length >= MAX_COMMENTS_PER_VIDEO) break;
  }

  // 댓글이 부족하면 다음 페이지도 가져오기
  let continuation = commentThread;
  let pages = 0;
  while (continuation.has_continuation && comments.length < MAX_COMMENTS_PER_VIDEO && pages < 4) {
    try {
      continuation = await continuation.getContinuation();
      if (!continuation?.contents) break;

      for (const thread of continuation.contents) {
        const comment = thread.comment;
        if (!comment) continue;

        const text = comment.content?.text || comment.content?.toString() || '';
        const likes = parseInt(comment.like_count, 10) || 0;
        if (text && !isNoiseComment(text)) {
          comments.push({
            text,
            likes,
            source: video.id,
            sourceTitle: video.title,
            timestamp: Date.now(),
            url: `https://www.youtube.com/watch?v=${video.id}`,
          });
        }

        if (comments.length >= MAX_COMMENTS_PER_VIDEO) break;
      }
      pages++;
    } catch {
      break; // continuation 실패 시 중단
    }
  }

  return comments;
}

// ─── 노이즈 필터 ────────────────────────────────────

function isNoiseComment(text) {
  if (!text || text.length < 3) return true;

  const t = text.trim();

  // 구독/좋아요/알림 관련
  if (/구독|좋아요\s*누|알림\s*설정|첫\s*댓|선댓|ㄱㄱ|댓글\s*달아/.test(t)) return true;

  // 타임스탬프만 있는 댓글 (예: "2:30", "1:23:45")
  if (/^\d{1,2}(:\d{2}){1,2}$/.test(t)) return true;

  // 이모지/특수문자만 있는 댓글
  const textOnly = t.replace(/[\s\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '');
  if (textOnly.length < 2) return true;

  // 너무 짧은 반복 (ㅋㅋㅋ, ㅎㅎ 등)
  if (/^[ㅋㅎㅠㅜㄷㄹ]{2,}$/.test(t)) return true;

  // "n번째 시청" 류
  if (/\d+\s*번째\s*(시청|재생|감상)/.test(t)) return true;

  // 한글이 거의 없는 댓글 (영어/외국어 전용) → 한글 비율 20% 미만이면 스킵
  const koreanChars = (t.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g) || []).length;
  const totalChars = t.replace(/\s/g, '').length;
  if (totalChars > 5 && koreanChars / totalChars < 0.2) return true;

  // 정치 관련 키워드
  if (/대통령|국회|여당|야당|민주당|국민의힘|이재명|윤석열|한동훈|국정|탄핵|계엄|비상계엄|정치|의원|투표|선거|연임/.test(t)) return true;

  // 연예/팬덤 키워드
  if (/임영웅|장원영|아이유|방탄소년단|BTS|블랙핑크|뉴진스|아이브|세븐틴|에스파|르세라핌|스트레이키즈|데뷔|컴백|앨범|음원|팬미팅|콘서트|공연|굿즈/.test(t)) return true;

  return false;
}

// 정치/연예 영상 자체를 걸러내는 필터
function isPoliticsOrEntertainmentVideo(title) {
  if (!title) return false;
  if (/대통령|국회|여당|야당|민주당|국민의힘|이재명|윤석열|한동훈|탄핵|계엄|선거|정치|국정/.test(title)) return true;
  if (/임영웅|장원영|아이유|BTS|방탄소년단|블랙핑크|뉴진스|아이브|세븐틴|에스파|르세라핌|스트레이키즈|컴백|데뷔|음원차트|빌보드/.test(title)) return true;
  return false;
}

export const source = 'youtube';
