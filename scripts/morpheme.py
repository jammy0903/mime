#!/usr/bin/env python3
"""
Korean morphological analysis using KoNLPy Okt.
Reads JSON array of comment texts from stdin,
outputs morpheme-analyzed results to stdout.

역할: 조사/어미/접미사만 제거, 의미 있는 형태소는 모두 보존.
필터링은 Node.js 분석기의 TF-IDF 스코어링에서 처리.
"""

import sys
import json
from konlpy.tag import Okt

okt = Okt()

# 제거할 POS 태그 (문법적 요소만)
REMOVE_TAGS = {'Josa', 'Punctuation', 'Foreign', 'Alpha', 'Number',
               'Unknown', 'Hashtag', 'ScreenName', 'Email', 'URL',
               'Suffix', 'Eomi', 'PreEomi', 'Conjunction',
               'Determiner', 'Exclamation'}

# 유지할 POS 태그 (의미 있는 형태소)
KEEP_TAGS = {'Noun', 'Verb', 'Adjective', 'Adverb'}


def analyze_comments(comments):
    """Analyze a batch of comments."""
    results = []
    for text in comments:
        if not text or len(text.strip()) < 3:
            results.append({'morphemes': [], 'nouns': [], 'raw': text or ''})
            continue

        try:
            # POS tagging WITHOUT stemming (원형 보존)
            # stem=False: "좋아요"→"좋아"(O) vs stem=True: "좋다"(X)
            pos_result = okt.pos(text, stem=False, norm=True)

            morphemes = []
            nouns = []
            for word, tag in pos_result:
                if tag not in KEEP_TAGS:
                    continue
                # 1글자 형태소는 노이즈가 많으므로 제거
                if len(word) < 2:
                    continue
                # ㅋㅋㅋ, ㅎㅎㅎ 등 반복 자음 제거
                if all(c in 'ㅋㅎㅠㅜㄷㄹ' for c in word):
                    continue
                morphemes.append(word)
                if tag == 'Noun':
                    nouns.append(word)

            results.append({
                'morphemes': morphemes,
                'nouns': nouns,
                'raw': text,
            })
        except Exception:
            results.append({'morphemes': [], 'nouns': [], 'raw': text})

    return results


def main():
    data = json.loads(sys.stdin.read())
    comments = data.get('comments', [])
    results = analyze_comments(comments)
    json.dump(results, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    main()
