// Netlify serverless function — proxies PSA cert lookups server-side.
// This exists because PSA's Cloudflare protection appears to throttle
// requests that look like they're coming straight from a public browser
// (random Origin header, no server-to-server pattern). Routing through
// here means PSA sees a normal server request instead.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let certNumber, token;
  try {
    ({ certNumber, token } = JSON.parse(event.body || '{}'));
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Malformed request body' }) };
  }

  if (!certNumber || !token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing certNumber or token' }) };
  }

  try {
    const psaRes = await fetch(
      `https://api.psacard.com/publicapi/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`,
      { headers: { authorization: `bearer ${token}` } }
    );
    const text = await psaRes.text();
    return {
      statusCode: psaRes.status,
      headers: { 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not reach PSA: ' + err.message }) };
  }
};
