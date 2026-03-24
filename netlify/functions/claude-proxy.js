const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'GROQ_API_KEY not configured on server.' })
    };
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid request body.' })
    };
  }

  // Build Groq/OpenAI-compatible request
  const messages = [];
  if (parsedBody.system) {
    messages.push({ role: 'system', content: parsedBody.system });
  }
  if (parsedBody.messages?.length) {
    messages.push(...parsedBody.messages);
  }

  const groqBody = JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages,
    max_tokens: 1500,
    temperature: 0.7
  });

  try {
    const rawResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Length': Buffer.byteLength(groqBody)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(data));
      });

      req.on('error', reject);
      req.setTimeout(25000, () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });
      req.write(groqBody);
      req.end();
    });

    const parsed = JSON.parse(rawResponse);

    if (parsed.error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: parsed.error.message || 'Groq API error' })
      };
    }

    const text = parsed.choices?.[0]?.message?.content || "";

    // Return in format compatible with app.js (same as before)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ content: [{ text }] })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
