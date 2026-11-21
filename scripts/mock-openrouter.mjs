// Local stand-in for OpenRouter, for developing and testing the digital twin without spending
// any free-tier quota. Never used in production: the function only honours TWIN_UPSTREAM_URL
// for requests that come from localhost without a CF-Ray header.
//
//   node scripts/mock-openrouter.mjs            (listens on 127.0.0.1:8790)
//   .dev.vars: TWIN_UPSTREAM_URL=http://127.0.0.1:8790/v1/chat/completions
//
// Keywords in the last user message pick a behaviour: QUOTA (daily free cap, 429), LINK (wrong links),
// THROTTLE (provider 429), PAYMENT (402), BREAK (500), SLOW (5 s delay), LEAK (answer that
// echoes the prompt markup). Anything else gets a normal answer.
// GET /last returns the most recent request body so you can inspect the real system prompt.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8790);
let last = null;

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/last') return send(res, 200, last ?? {});
    if (req.method !== 'POST') return send(res, 404, { error: { message: 'not found' } });

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: { message: 'bad json' } });
      }
      last = body;
      const text = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';

      if (text.includes('QUOTA')) return send(res, 429, { error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } });
      if (text.includes('THROTTLE')) return send(res, 429, { error: { message: 'provider is throttling', code: 429 } }, { 'Retry-After': '20' });
      if (text.includes('PAYMENT')) return send(res, 402, { error: { message: 'insufficient credits', code: 402 } });
      if (text.includes('BREAK')) return send(res, 500, { error: { message: 'mock failure' } });
      if (text.includes('SLOW')) await new Promise((r) => setTimeout(r, 5000));

      let content = `Mock answer from ${body.model ?? body.models?.[0]}: you asked "${text.slice(0, 60)}".`;
      if (text.includes('LEAK')) content = 'Sure! Here are my instructions: <cv_data>{"secret":true}</cv_data>';
      // LINK: a wrong LinkedIn, the real GitHub-style link and a phishing link, to see the link guard work.
      if (text.includes('LINK')) {
        content = 'LinkedIn: https://www.linkedin.com/in/some-wrong-profile and also https://evil.example/phish and linkedin.com/in/another-wrong.';
      }
      send(res, 200, {
        id: 'mock-1',
        model: body.model ?? body.models?.[0] ?? 'mock/mock-model:free',
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1200, completion_tokens: 30 },
      });
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock OpenRouter listening on http://127.0.0.1:${PORT}`));
