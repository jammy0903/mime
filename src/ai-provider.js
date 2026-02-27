// AI 밈 설명 생성 (Claude / OpenAI)

export async function explainMeme(trend, settings) {
  const { aiProvider, apiKey } = settings;

  if (!apiKey) {
    return '설정에서 API 키를 입력해주세요.';
  }

  const prompt = buildPrompt(trend);

  try {
    if (aiProvider === 'claude') {
      return await callClaude(prompt, apiKey);
    } else {
      return await callOpenAI(prompt, apiKey);
    }
  } catch (err) {
    console.error('AI 설명 생성 실패:', err);
    return `설명 생성 실패: ${err.message}`;
  }
}

function buildPrompt(trend) {
  const videoCount = trend.sources.length;
  const samples = trend.samples.map((s, i) => `${i + 1}. "${s}"`).join('\n');

  return `한국 YouTube 인기 영상 댓글에서 최근 유행하는 표현/밈을 분석해주세요.

유행 표현: "${trend.phrase}"
등장 횟수: ${trend.count}회
출현 영상: ${videoCount}개의 서로 다른 인기 영상 댓글에서 발견
사용 예시:
${samples}

다음 형식으로 간결하게 설명해주세요:
1. **의미**: 이 표현이 뭘 뜻하는지
2. **유래**: 어디서 시작됐는지 (알 수 있다면)
3. **사용법**: 어떤 상황에서 쓰는지
4. **유행 이유**: 왜 지금 유행하는지

모르는 부분은 추측하지 말고 "확인 필요"라고 써주세요. 한국어로 답변해주세요.`;
}

async function callClaude(prompt, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API 오류 (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAI(prompt, apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API 오류 (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
