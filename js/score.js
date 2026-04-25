// score.js — Score lookup page logic.

const SCORE_API_URL = window.APPS_SCRIPT_URL || '';

document.addEventListener('DOMContentLoaded', function () {
  const form       = document.getElementById('score-form');
  const input      = document.getElementById('short-code-input');
  const resultBox  = document.getElementById('score-result');
  const errorBox   = document.getElementById('score-error');
  const btn        = document.getElementById('lookup-btn');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const code = input.value.trim().toUpperCase();

    if (!code || code.length !== 6) {
      showError('Please enter a valid 6-character short code.');
      return;
    }

    lookupScore(code);
  });

  function lookupScore(code) {
    setLoading(true);
    clearMessages();

    api({ action: 'lookupScore', shortCode: code })
      .then(function (data) {
        if (!data.success) {
          showError(data.error || 'Short code not found. Please check and try again.');
          return;
        }

        if (data.pending) {
          showPending(data.message);
          return;
        }

        showResult(data);
      })
      .catch(function () {
        showError('Could not connect to the server. Please try again later.');
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function showResult(data) {
    const pct = Number(data.percentage).toFixed(2);
    resultBox.innerHTML = [
      '<div class="result-card">',
      '  <div class="result-check">✅</div>',
      '  <h2>' + escHtml(data.firstName) + ' ' + escHtml(data.lastName) + '</h2>',
      '  <p class="result-exam">' + escHtml(data.examTitle || '') + '</p>',
      '  <div class="score-display">',
      '    <span class="score-fraction">' + data.score + ' / ' + data.totalPoints + '</span>',
      '    <span class="score-percent ' + gradeClass(pct) + '">' + pct + '%</span>',
      '  </div>',
      '  <p class="result-date">Submitted: ' + escHtml(data.dateTaken || '') + '</p>',
      '</div>'
    ].join('\n');
    resultBox.classList.remove('hidden');
  }

  function showPending(message) {
    resultBox.innerHTML = '<div class="result-pending"><span class="pending-icon">⏳</span><p>' + escHtml(message) + '</p></div>';
    resultBox.classList.remove('hidden');
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  function clearMessages() {
    errorBox.classList.add('hidden');
    resultBox.classList.add('hidden');
    resultBox.innerHTML = '';
    errorBox.textContent = '';
  }

  function setLoading(loading) {
    btn.disabled = loading;
    btn.textContent = loading ? 'Looking up…' : 'Look Up My Score';
  }

  function gradeClass(pct) {
    pct = Number(pct);
    if (pct >= 90) return 'grade-excellent';
    if (pct >= 75) return 'grade-passing';
    return 'grade-failing';
  }
});

// ─────────────────────────────────────────────────────────────
// SHARED API HELPER
// ─────────────────────────────────────────────────────────────

function api(body) {
  const url = window.APPS_SCRIPT_URL;
  if (!url) return Promise.reject(new Error('Apps Script URL not configured.'));
  // text/plain avoids the CORS preflight that Apps Script cannot handle
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
