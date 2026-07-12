/* PSA Public API helper — now routed through a Netlify function proxy
   (netlify/functions/psa-lookup.js) instead of calling PSA directly from
   the browser. See that file for why. */
(function () {
  const DEFAULT_PROXY = '/.netlify/functions/psa-lookup';

  async function psaLookupCert(certNumber, token, proxyUrl) {
    if (!token) {
      const err = new Error('No PSA API token saved. Add one in Settings.');
      err.code = 'NO_TOKEN';
      throw err;
    }
    const res = await fetch(proxyUrl || DEFAULT_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ certNumber, token }),
    });
    if (res.status === 429) {
      const err = new Error('PSA is rate-limiting requests right now.');
      err.code = 'RATE_LIMIT';
      throw err;
    }
    if (res.status === 500) {
      const err = new Error('PSA rejected the request — your API token may be invalid or expired.');
      err.code = 'AUTH';
      throw err;
    }
    if (!res.ok) {
      const err = new Error('PSA lookup failed (HTTP ' + res.status + ')');
      err.code = 'HTTP';
      throw err;
    }
    const data = await res.json();
    if (data.IsValidRequest === false) {
      const err = new Error(data.ServerMessage || 'Invalid cert number');
      err.code = 'INVALID';
      throw err;
    }
    return data;
  }

  // PSA's exact response field names aren't fully documented publicly, so this
  // reads several plausible key variants defensively and falls back gracefully.
  function mapPSAResponse(data) {
    const cert = data.PSACert || data.psaCert || data.Cert || data.cert || data;
    const pick = (...keys) => {
      for (const k of keys) {
        if (cert && cert[k] !== undefined && cert[k] !== null && String(cert[k]).trim() !== '') return cert[k];
      }
      return '';
    };
    const year = pick('Year', 'year');
    const brand = pick('Brand', 'brand', 'Set', 'set');
    const subject = pick('Subject', 'subject', 'PlayerName', 'playerName');
    const variety = pick('Variety', 'variety', 'CardVariety');
    const cardNumber = pick('CardNumber', 'cardNumber');
    const grade = pick('CardGrade', 'cardGrade', 'Grade', 'grade');

    const nameParts = [year, brand, subject, variety].filter(Boolean);
    let cardName = nameParts.join(' ').trim();
    if (cardNumber) cardName += ` #${cardNumber}`;

    // Grade often comes back like "GEM MT 10" or "MINT 9" — pull the trailing number/word.
    let gradeShort = '';
    if (grade) {
      const m = String(grade).match(/(\d+(\.\d+)?)\s*$/);
      if (m) gradeShort = m[1];
      else if (/auth/i.test(grade)) gradeShort = 'Authentic';
      else gradeShort = String(grade);
    }

    return {
      cardName: cardName || '',
      grade: gradeShort || '',
      gradeLabel: grade || '',
      raw: cert,
      found: !!(cardName || gradeShort),
    };
  }

  window.psaApi = { psaLookupCert, mapPSAResponse };
})();
