// KoNLPy Okt 형태소 분석 Node.js 연동
// Python subprocess로 배치 처리

import { execFile } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_PATH = join(__dirname, '..', '.venv', 'bin', 'python3');
const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'morpheme.py');

/**
 * 댓글 배열을 형태소 분석
 * @param {string[]} comments - 댓글 텍스트 배열
 * @returns {Promise<Array<{morphemes: string[], nouns: string[], raw: string}>>}
 */
export async function analyzeComments(comments) {
  if (!comments || comments.length === 0) return [];

  // 배치 크기 제한 (너무 크면 메모리 이슈)
  const BATCH_SIZE = 500;
  const results = [];

  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    const batch = comments.slice(i, i + BATCH_SIZE);
    const batchResult = await runPython(batch);
    results.push(...batchResult);
  }

  return results;
}

function runPython(comments) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({ comments });

    const proc = execFile(
      PYTHON_PATH,
      [SCRIPT_PATH],
      { maxBuffer: 50 * 1024 * 1024, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          console.error('[Morpheme] Python error:', stderr || err.message);
          // 폴백: 형태소 분석 없이 원본 반환
          resolve(comments.map((c) => ({
            morphemes: c.split(/\s+/).filter((w) => w.length >= 2),
            nouns: [],
            raw: c,
          })));
          return;
        }

        try {
          const results = JSON.parse(stdout);
          resolve(results);
        } catch (e) {
          console.error('[Morpheme] JSON parse error:', e.message);
          resolve(comments.map((c) => ({
            morphemes: c.split(/\s+/).filter((w) => w.length >= 2),
            nouns: [],
            raw: c,
          })));
        }
      }
    );

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
