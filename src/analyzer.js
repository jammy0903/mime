// 밈 레이더 - 형태소 분석 + TF-IDF 기반 밈 탐지 엔진
//
// 파이프라인:
//   0) KoNLPy Okt 형태소 분석 (조사/어미만 제거)
//   1) 문장 유사도 클러스터링 → 거의 같은 문장 그룹핑
//   2) 형태소 기반 핫 키워드 → 주변 문장 수집 → 패턴 추출
//   3) 형태소 N-gram 빈도 → 짧은 밈 표현 감지
//   4) TF-IDF 스코어링 → 흔한 표현 vs 밈 자동 구분

import { analyzeComments } from './morpheme.js';

// ─── 텍스트 정규화 ─────────────────────────────────

const NOISE_RE = /[ㅋㅎㅠㅜㄷ]{2,}|\.{2,}|!{2,}|\?{2,}|~+/g;
const YT_NOISE =
  /\b(구독|좋아요|알림|채널|편집|자막|shorts|short|subscribe|like|comment|share)\b/gi;

function normalize(text) {
  if (!text) return '';
  let s = text;
  s = s.replace(/https?:\/\/\S+/g, '');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(YT_NOISE, '');
  s = s.replace(NOISE_RE, '');
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/\[[^\]]*\]/g, '');
  s = s.replace(/\d{1,2}:\d{2}(:\d{2})?/g, '');
  s = s.replace(/[^\wㄱ-ㅎㅏ-ㅣ가-힣\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ─── 1단계: 문장 유사도 클러스터링 ──────────────────

function charTrigrams(str) {
  const set = new Set();
  const s = str.replace(/\s/g, '');
  for (let i = 0; i <= s.length - 3; i++) {
    set.add(s.substring(i, i + 3));
  }
  return set;
}

function jaccard(setA, setB) {
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter++;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function clusterSentences(posts, threshold = 0.45) {
  const items = posts.map((p) => {
    const norm = normalize(p.text);
    return {
      original: p.text,
      norm,
      trigrams: charTrigrams(norm),
      source: p.source,
    };
  }).filter((item) => item.norm.length >= 3);

  const invertedIndex = new Map();
  items.forEach((item, idx) => {
    for (const tg of item.trigrams) {
      if (!invertedIndex.has(tg)) invertedIndex.set(tg, []);
      invertedIndex.get(tg).push(idx);
    }
  });

  const candidatePairs = new Map();
  for (const [, indices] of invertedIndex) {
    if (indices.length > 200) continue;
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const key = `${indices[a]},${indices[b]}`;
        candidatePairs.set(key, (candidatePairs.get(key) || 0) + 1);
      }
    }
  }

  const parent = items.map((_, i) => i);
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const [key, sharedCount] of candidatePairs) {
    if (sharedCount < 3) continue;
    const [i, j] = key.split(',').map(Number);
    if (find(i) === find(j)) continue;
    if (jaccard(items[i].trigrams, items[j].trigrams) >= threshold) {
      union(i, j);
    }
  }

  const clusters = new Map();
  items.forEach((item, idx) => {
    const root = find(idx);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(item);
  });

  return clusters;
}

// ─── 2단계: 형태소 핫 키워드 → 문장 패턴 ──────────

function extractMorphemeKeywords(morphemeData, posts) {
  const freq = new Map();

  for (let i = 0; i < morphemeData.length; i++) {
    const md = morphemeData[i];
    const source = posts[i].source;
    const seen = new Set();

    for (const word of md.morphemes) {
      if (word.length < 2) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      if (!freq.has(word)) freq.set(word, { count: 0, sources: new Set() });
      freq.get(word).count++;
      freq.get(word).sources.add(source);
    }
  }

  // 핫 키워드: 빈도 상위 + 2개 이상 영상
  // TF-IDF로 정렬: 특정 영상에 집중된 키워드 우선
  const totalVideos = new Set(posts.map((p) => p.source)).size;
  const entries = [...freq.entries()]
    .filter(([, d]) => d.count >= 3 && d.sources.size >= 2)
    .map(([word, data]) => {
      const tf = Math.log2(data.count + 1);
      const idf = Math.log2(totalVideos / data.sources.size + 1);
      return { word, ...data, sources: [...data.sources], tfidf: tf * idf };
    });

  // TF-IDF 내림차순 정렬 (흔한 단어는 IDF가 낮아서 자동으로 뒤로)
  entries.sort((a, b) => b.tfidf - a.tfidf);
  return entries.slice(0, 40);
}

function findSentencePattern(keyword, posts) {
  const sentences = [];
  for (const p of posts) {
    const norm = normalize(p.text);
    if (norm.includes(keyword)) {
      sentences.push({ norm, source: p.source, original: p.text });
    }
  }

  if (sentences.length < 3) return null;

  const trigSets = sentences.map((s) => charTrigrams(s.norm));
  const parent = sentences.map((_, i) => i);
  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      if (find(i) === find(j)) continue;
      if (jaccard(trigSets[i], trigSets[j]) >= 0.35) {
        union(i, j);
      }
    }
  }

  const groups = new Map();
  sentences.forEach((s, idx) => {
    const root = find(idx);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(s);
  });

  let bestGroup = [];
  for (const [, group] of groups) {
    if (group.length > bestGroup.length) bestGroup = group;
  }

  if (bestGroup.length < 3) return null;

  bestGroup.sort((a, b) => a.norm.length - b.norm.length);
  const representative = bestGroup[Math.floor(bestGroup.length * 0.3)];
  const sources = new Set();
  for (const s of bestGroup) sources.add(s.source);

  return {
    phrase: representative.norm,
    count: bestGroup.length,
    sources: [...sources],
    samples: bestGroup.slice(0, 5).map((s) => s.original.substring(0, 100)),
    keyword,
  };
}

// ─── 3단계: 원본 어절 N-gram (형태소 스코어링 보조) ───

// 불용어 (N-gram에서 전체가 불용어면 스킵)
const STOP_WORDS = new Set([
  '은', '는', '이', '가', '을', '를', '에', '에서', '의', '와', '과',
  '로', '으로', '도', '만', '까지', '부터', '보다', '처럼', '같이',
  '한테', '에게', '마다', '밖에', '이라', '라고',
  '것', '수', '등', '더', '안', '못', '잘', '또', '그냥', '좀',
  '나', '너', '우리', '거', '게', '건', '걸', '뭐', '왜',
  '그래서', '그런데', '그리고', '하지만', '그래도', '근데',
]);

function isStopWord(w) {
  if (w.length < 2) return true;
  if (STOP_WORDS.has(w)) return true;
  if (/^\d+$/.test(w)) return true;
  if (/^[ㄱ-ㅎㅏ-ㅣ]{1,3}$/.test(w)) return true; // ㅋㅋ, ㅎㅎ
  return false;
}

function findWordNgrams(posts, minN = 2, maxN = 5) {
  const ngramFreq = new Map();

  for (const p of posts) {
    const norm = normalize(p.text);
    const words = norm.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length < minN) continue;

    const seen = new Set();

    for (let n = minN; n <= Math.min(maxN, words.length); n++) {
      for (let start = 0; start <= words.length - n; start++) {
        const ngramWords = words.slice(start, start + n);
        // 전부 불용어면 스킵
        if (ngramWords.every((w) => isStopWord(w))) continue;
        // ㅋㅋ류만 포함하면 스킵
        if (ngramWords.every((w) => /^[ㅋㅎㅠㅜㄷ]+$/.test(w) || isStopWord(w))) continue;

        const ngram = ngramWords.join(' ');
        if (seen.has(ngram)) continue;
        seen.add(ngram);

        if (!ngramFreq.has(ngram)) {
          ngramFreq.set(ngram, { count: 0, sources: new Set(), samples: [], totalLikes: 0 });
        }
        const entry = ngramFreq.get(ngram);
        entry.count++;
        entry.sources.add(p.source);
        entry.totalLikes += (p.likes || 0);
        if (entry.samples.length < 5) {
          entry.samples.push(p.text.substring(0, 100));
        }
      }
    }
  }

  const totalVideos = new Set(posts.map((p) => p.source)).size;
  const results = [];

  for (const [ngram, data] of ngramFreq) {
    if (data.count < 3 || data.sources.size < 2) continue;

    const tf = Math.log2(data.count + 1);
    const idf = Math.log2(totalVideos / data.sources.size + 1);
    const tfidf = tf * idf;

    results.push({
      phrase: ngram,
      count: data.count,
      sources: [...data.sources],
      samples: data.samples,
      tfidf,
      totalLikes: data.totalLikes,
      avgLikes: data.count > 0 ? data.totalLikes / data.count : 0,
    });
  }

  results.sort((a, b) => b.tfidf - a.tfidf);

  // 더 긴 N-gram이 짧은 것을 포함하면 긴 것만 유지
  const filtered = [];
  for (const r of results) {
    const dominated = filtered.some(
      (f) => f.phrase.includes(r.phrase) && f.count >= r.count * 0.5
    );
    if (!dominated) {
      filtered.push(r);
    }
  }

  return filtered.slice(0, 50);
}

// 형태소 기반 신선도 점수: 흔하지 않은 명사가 포함되면 밈 가능성 높음
function computeNoveltyScore(phrase, morphemeData, posts) {
  // 형태소 분석 결과에서 이 phrase에 포함된 명사 빈도 조사
  const nounFreq = new Map();
  for (const md of morphemeData) {
    for (const noun of md.nouns) {
      nounFreq.set(noun, (nounFreq.get(noun) || 0) + 1);
    }
  }

  const phraseWords = phrase.split(/\s+/);
  let novelty = 0;
  let matched = 0;

  for (const word of phraseWords) {
    // 이 단어가 명사 목록에서 얼마나 드문지
    for (const [noun, freq] of nounFreq) {
      if (word.includes(noun) || noun.includes(word)) {
        // 드문 명사일수록 높은 점수 (역빈도)
        const rarity = Math.max(0, 5 - Math.log2(freq + 1));
        if (rarity > 0) {
          novelty += rarity;
          matched++;
        }
        break;
      }
    }
  }

  return matched > 0 ? novelty / matched : 0;
}

// ─── TF-IDF 계산 ────────────────────────────────

function computeTfIdf(count, sourceCount, totalVideoCount) {
  const tf = Math.log2(count + 1);
  const idf = Math.log2(totalVideoCount / sourceCount + 1);
  const concentration = count / sourceCount;
  return { tf, idf, tfidf: tf * idf, concentration };
}

// ─── 최소한의 블랙리스트 (명백한 비밈 표현만) ────────

const BLACKLIST_PHRASES = [
  // 연예인/정치인/유명인 이름
  '임영웅', '장원영', '아이유', 'BTS', '방탄소년단',
  '블랙핑크', '뉴진스', '아이브', '세븐틴', '스트레이키즈',
  '에스파', '르세라핀',
  '허경환', '침착맨', '주호민', '이말년', '김동현',
  '이재명', '윤석열', '한동훈',
  // 영어 (한국 밈에서 의미 없음)
  'of the', 'in the', 'to the', 'and the', 'for the',
  'this is', 'thank you', 'love this',
  'congratulations', 'congrats',
  // 커뮤니티 스팸/매크로
  '십자가', '예수님', '부활하셔서', '구원도 주심',
  '실베 절취선', '절취선',
  '대한민국 파이팅', '일류국가로 영원하라',
  '펫티켓', '반려견주',
];

// 인사/응원 패턴 (정규식)
const GREETING_PATTERN = /^(감사합니다|축하합니다|안녕하세요|수고하세요|수고했습니다|죄송합니다|미안합니다|응원합니다|감사해요|고맙습니다|반갑습니다|사랑합니다)$/;

// ─── 메인: 형태소 기반 통합 분석 ──────────────────

export async function analyzePosts(posts) {
  if (!posts || posts.length === 0) return [];

  const allSources = new Set(posts.map((p) => p.source));
  const totalVideoCount = allSources.size;

  console.log(`[분석] ${posts.length}개 댓글, ${totalVideoCount}개 영상 분석 시작`);

  // === 0단계: 형태소 분석 ===
  console.log('[분석] 형태소 분석 중...');
  const commentTexts = posts.map((p) => p.text);
  const morphemeData = await analyzeComments(commentTexts);
  console.log(`[분석] 형태소 분석 완료 (${morphemeData.length}개)`);

  const results = new Map();

  // === 1단계: 문장 클러스터링 (원본 텍스트 기반) ===
  console.log('[분석] 1단계: 문장 클러스터링...');
  const clusters = clusterSentences(posts);
  for (const [, members] of clusters) {
    if (members.length < 3) continue;

    const sources = new Set(members.map((m) => m.source));
    if (sources.size < 2) continue;

    const sorted = [...members].sort((a, b) => a.norm.length - b.norm.length);
    const rep = sorted[Math.floor(sorted.length * 0.3)];

    if (rep.norm.length < 5) continue;
    if (GREETING_PATTERN.test(rep.norm.replace(/\s/g, ''))) continue;

    const { tfidf, concentration } = computeTfIdf(
      members.length, sources.size, totalVideoCount
    );

    // 클러스터 멤버의 좋아요 합산
    let totalLikes = 0;
    for (const m of members) {
      const matchPost = posts.find((p) => p.text === m.original);
      if (matchPost) totalLikes += (matchPost.likes || 0);
    }

    results.set(rep.norm, {
      phrase: rep.norm,
      type: 'sentence',
      count: members.length,
      sourceCount: sources.size,
      sources: [...sources],
      samples: members.slice(0, 5).map((m) => m.original.substring(0, 100)),
      tfidf,
      concentration,
      totalLikes,
      avgLikes: members.length > 0 ? totalLikes / members.length : 0,
      score: 0,
    });
  }

  // === 2단계: 형태소 핫 키워드 → 문장 패턴 ===
  console.log('[분석] 2단계: 형태소 키워드 패턴...');
  const hotKeywords = extractMorphemeKeywords(morphemeData, posts);
  console.log(`[분석] 핫 키워드 ${hotKeywords.length}개 (TF-IDF 정렬): ${hotKeywords.slice(0, 10).map((k) => `${k.word}(${k.tfidf.toFixed(1)})`).join(', ')}`);

  for (const kw of hotKeywords) {
    const pattern = findSentencePattern(kw.word, posts);
    if (!pattern) continue;
    if (pattern.phrase.split(/\s+/).length < 2) continue;
    if (pattern.sources.length < 2) continue; // 2개 이상 영상에서 나와야 밈

    let isDup = false;
    for (const [existing] of results) {
      if (jaccard(charTrigrams(existing), charTrigrams(pattern.phrase)) > 0.5) {
        isDup = true;
        break;
      }
    }
    if (isDup) continue;

    const { tfidf, concentration } = computeTfIdf(
      pattern.count, pattern.sources.length, totalVideoCount
    );

    // 키워드 패턴의 좋아요 합산
    let kwPatternLikes = 0;
    for (const p of posts) {
      if (normalize(p.text).includes(kw.word)) {
        kwPatternLikes += (p.likes || 0);
      }
    }

    results.set(pattern.phrase, {
      phrase: pattern.phrase,
      type: 'keyword_pattern',
      count: pattern.count,
      sourceCount: pattern.sources.length,
      sources: pattern.sources,
      samples: pattern.samples,
      keyword: pattern.keyword,
      tfidf,
      concentration,
      totalLikes: kwPatternLikes,
      avgLikes: pattern.count > 0 ? kwPatternLikes / pattern.count : 0,
      score: 0,
    });
  }

  // (2.5단계 삭제: 단어 하나짜리 트렌드는 밈이 아님 → 2어절 이상만 인정)

  // === 3단계: 원본 어절 N-gram ===
  console.log('[분석] 3단계: 어절 N-gram...');
  const ngrams = findWordNgrams(posts);
  console.log(`[분석] N-gram 후보 ${ngrams.length}개`);

  for (const ng of ngrams) {
    let isDup = false;
    for (const [existing] of results) {
      const existNoSpace = existing.replace(/\s/g, '');
      const ngNoSpace = ng.phrase.replace(/\s/g, '');
      if (existNoSpace.includes(ngNoSpace) || ngNoSpace.includes(existNoSpace)) {
        isDup = true;
        break;
      }
      if (jaccard(charTrigrams(existing), charTrigrams(ng.phrase)) > 0.4) {
        isDup = true;
        break;
      }
    }
    if (isDup) continue;

    // 형태소 신선도 점수 추가
    const novelty = computeNoveltyScore(ng.phrase, morphemeData, posts);

    results.set(ng.phrase, {
      phrase: ng.phrase,
      type: 'ngram',
      count: ng.count,
      sourceCount: ng.sources.length,
      sources: ng.sources,
      samples: ng.samples,
      tfidf: ng.tfidf,
      concentration: ng.count / ng.sources.length,
      novelty,
      totalLikes: ng.totalLikes || 0,
      avgLikes: ng.avgLikes || 0,
      score: 0,
    });
  }

  // === 최종 필터 (최소한만) ===
  for (const [key, val] of results) {
    const lower = val.phrase.toLowerCase();
    // 블랙리스트 (연예인/영어만)
    if (BLACKLIST_PHRASES.some((bw) => lower.includes(bw.toLowerCase()))) {
      results.delete(key);
      continue;
    }
    // 한글 필수
    if (!/[가-힣]/.test(val.phrase)) {
      results.delete(key);
      continue;
    }
    // 인사/응원 정확히 일치하는 것만 제거
    if (GREETING_PATTERN.test(val.phrase.replace(/\s/g, ''))) {
      results.delete(key);
      continue;
    }
  }

  // === 영상 제목 다양성 계산 (밈은 다른 장르 영상에서도 등장) ===
  const titleMap = new Map(); // videoId → title
  for (const p of posts) {
    if (p.sourceTitle && !titleMap.has(p.source)) {
      titleMap.set(p.source, p.sourceTitle);
    }
  }

  function computeTitleDiversity(sources) {
    if (sources.length <= 1) return 0;
    const titles = sources.map((s) => titleMap.get(s) || '').filter(Boolean);
    if (titles.length <= 1) return 0;
    // 제목 간 평균 trigram 비유사도 (diverse할수록 1에 가까움)
    let totalDissimilarity = 0;
    let pairs = 0;
    for (let i = 0; i < titles.length; i++) {
      for (let j = i + 1; j < titles.length; j++) {
        const sim = jaccard(charTrigrams(titles[i]), charTrigrams(titles[j]));
        totalDissimilarity += (1 - sim);
        pairs++;
      }
    }
    return pairs > 0 ? totalDissimilarity / pairs : 0;
  }

  // === 단어 빈도 맵 (일반 표현 페널티용) ===
  const globalWordFreq = new Map();
  for (const p of posts) {
    const words = normalize(p.text).split(/\s+/).filter((w) => w.length >= 2);
    const seen = new Set();
    for (const w of words) {
      if (seen.has(w)) continue;
      seen.add(w);
      globalWordFreq.set(w, (globalWordFreq.get(w) || 0) + 1);
    }
  }
  const totalComments = posts.length;

  // 매우 흔한 단어 목록 (전체 댓글의 5% 이상에서 출현)
  const veryCommonWords = new Set();
  for (const [word, count] of globalWordFreq) {
    if (count / totalComments >= 0.05) {
      veryCommonWords.add(word);
    }
  }

  // === 스팸 복붙 감지: 완전 동일 문장이 다수 소스에 복사된 경우 ===
  // 밈은 약간씩 변형되지만, 스팸은 글자 하나 안 바뀜
  const exactDupMap = new Map(); // normalized text → Set<source>
  for (const p of posts) {
    const norm = normalize(p.text);
    if (norm.length < 10) continue;
    if (!exactDupMap.has(norm)) exactDupMap.set(norm, new Set());
    exactDupMap.get(norm).add(p.source);
  }
  // 3개+ 소스에서 완전 동일 문장 = 스팸 복붙
  const spamTexts = new Set();
  for (const [text, sources] of exactDupMap) {
    if (sources.size >= 3) spamTexts.add(text);
  }
  if (spamTexts.size > 0) {
    console.log(`[분석] 스팸 복붙 ${spamTexts.size}개 감지`);
  }

  // === TF-IDF + 다양성 + 신선도 기반 스코어링 ===
  const trends = [...results.values()];
  for (const t of trends) {
    // TF-IDF가 핵심
    const tfidfScore = t.tfidf * 20;
    // 빈도 보너스
    const freqScore = Math.log2(t.count + 1) * 8;
    // 다중 소스 보너스
    const sourceScore = Math.min(t.sourceCount, 8) * 15;
    // 집중도 보너스
    const concentrationBonus = Math.min(t.concentration, 10) * 3;
    // 영상 제목 다양성
    const diversity = computeTitleDiversity(t.sources);
    const diversityScore = diversity * 50;
    // 형태소 신선도
    const noveltyScore = (t.novelty || 0) * 15;
    // 타입 보너스
    const typeBonus =
      t.type === 'sentence' ? 25 :
      t.type === 'keyword_pattern' ? 20 :
      t.type === 'ngram' ? 10 : 0;
    // 길이 보너스
    const lenScore = t.phrase.length >= 4 && t.phrase.length <= 30 ? 10 : 0;

    // ★ 일반 표현 페널티: N-gram의 모든 단어가 매우 흔하면 감점
    let genericPenalty = 0;
    if (t.type === 'ngram') {
      const words = t.phrase.split(/\s+/);
      const allCommon = words.every((w) => veryCommonWords.has(w));
      if (allCommon) {
        genericPenalty = -150; // 큰 감점
      } else {
        // 흔한 단어 비율에 따라 부분 감점
        const commonRatio = words.filter((w) => veryCommonWords.has(w)).length / words.length;
        genericPenalty = -commonRatio * 80;
      }
    }

    // ★ 스팸 복붙 페널티: 완전 동일 문장이 5개+ 소스에 복붙
    let spamPenalty = 0;
    if (spamTexts.has(t.phrase) || spamTexts.has(normalize(t.phrase))) {
      spamPenalty = -500;
    } else if (t.type === 'sentence' && t.samples) {
      // 샘플 중 스팸 텍스트와 겹치면 부분 감점
      const spamOverlap = t.samples.filter(s => spamTexts.has(normalize(s))).length;
      if (spamOverlap > 0) spamPenalty = -spamOverlap * 100;
    }

    // ★ 좋아요 기반 점수: 밈 댓글은 공감을 받아 좋아요가 높음
    const avgLikes = t.avgLikes || 0;
    const likesScore = Math.log2(avgLikes + 1) * 15;

    t.diversity = Math.round(diversity * 100) / 100;
    t.avgLikes = Math.round(avgLikes * 10) / 10;
    t.score = Math.round(
      (tfidfScore + freqScore + sourceScore + concentrationBonus + diversityScore + noveltyScore + typeBonus + lenScore + genericPenalty + likesScore + spamPenalty) * 10
    ) / 10;
  }

  // === "웃기다" 관련 표현 대폭 감점 ===
  // 유튜브 = 재미 콘텐츠 → "웃기다"는 당연한 반응, 밈 아님
  const FUNNY_RE = /웃기|웃긴|웃김|웃겨|웃겼|웃기노|웃기네|웃기다|웃긴다|개웃|ㅋㅋ/;

  for (const t of trends) {
    if (FUNNY_RE.test(t.phrase)) {
      t.score -= 300;
      t.isGenericReaction = true;
    }
  }

  // === 일반 반응 N-gram 추가 감점 ===
  for (const t of trends) {
    if (t.type !== 'ngram') continue;
    if (t.isGenericReaction) continue; // 이미 감점됨
    const p = t.phrase;
    // "너무 좋아요", "너무 예뻐요" 등
    if (/^(너무|진짜|겁나|개|완전)\s/.test(p) && /[요네김다]$/.test(p)) {
      t.score -= 100;
      t.isGenericReaction = true;
    }
    // "X 좋아요", "X 대박" 등
    if (/\s(좋아요|예뻐요|대박|최고|감동)$/.test(p)) {
      t.score -= 80;
      t.isGenericReaction = true;
    }
    // "아니 근데", "근데 진짜", "모습 너무", "내가 좋아하는" 등 일반 2어절
    if (/^(아니|근데|그래서|그런데|진짜|제일|모습|내가)\s/.test(p) && t.phrase.split(/\s+/).length === 2) {
      t.score -= 60;
      t.isGenericReaction = true;
    }
    // "X 않을까", "X 좋아하는" 등 일반 어미
    if (/\s(않을까|좋아하는|싶다|같다)$/.test(p)) {
      t.score -= 60;
      t.isGenericReaction = true;
    }
  }

  trends.sort((a, b) => b.score - a.score);

  console.log(`[분석] 최종 ${trends.length}개 트렌드`);
  if (trends.length > 0) {
    console.log(`[분석] Top 5:`);
    trends.slice(0, 5).forEach((t, i) =>
      console.log(`  ${i + 1}. "${t.phrase}" (점수=${t.score}, TF-IDF=${t.tfidf.toFixed(2)}, 다양성=${t.diversity}, 빈도=${t.count}, 영상=${t.sourceCount}, 평균좋아요=${t.avgLikes || 0})`)
    );
  }

  return trends.slice(0, 50);
}
