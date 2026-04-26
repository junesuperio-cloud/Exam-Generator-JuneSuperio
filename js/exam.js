// exam.js — Student exam page: entry, fullscreen, anti-cheat, timers, all question types, submission.

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
var ExamState = {
  examId:           null,
  examData:         null,
  studentId:        null,
  firstName:        '',
  lastName:         '',
  answers:          {},
  currentIndex:     0,
  startTime:        null,
  wholeTimerSecondsLeft: 0,
  perQTimerSecondsLeft:  0,
  wholeTimerInterval:    null,
  perQTimerInterval:     null,
  violationCount:   0,
  violationLog:     [],
  violationFlag:    'NONE',
  examStarted:      false,
  examSubmitted:    false,
  antiCheat:        {},
  firstViolationHandled: false,
  // Grace period state
  graceActive:      false,
  graceInterval:    null,
  graceCountdown:   0
};

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  // Disable right-click, text copy, and common cheat shortcuts globally
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  document.addEventListener('copy',        function(e){ e.preventDefault(); });
  document.addEventListener('selectstart', function(e){ if (ExamState.examStarted) e.preventDefault(); });
  document.addEventListener('keydown', blockCheatKeys);

  const params = new URLSearchParams(window.location.search);
  ExamState.examId = params.get('exam');

  if (!ExamState.examId) {
    showError('No exam ID found in the URL. Please use the link provided by your instructor.');
    return;
  }

  checkWindow();
});

function checkWindow() {
  setStatus('Checking exam availability…');
  api({ action: 'checkExamWindow', examId: ExamState.examId })
    .then(function (data) {
      if (!data.success) {
        showError(data.message || 'This exam is not available.');
        return;
      }
      ExamState.antiCheat = data.antiCheat || {};
      showEntryForm(data);
    })
    .catch(function () {
      showError('Could not connect to the server. Please check your internet connection and try again.');
    });
}

// ─────────────────────────────────────────────────────────────
// ENTRY FORM
// ─────────────────────────────────────────────────────────────
function showEntryForm(windowData) {
  show('entry-section');
  hide('status-section');

  document.getElementById('exam-title-display').textContent = windowData.title || 'Exam';

  if (windowData.closeDateTime) {
    document.getElementById('exam-close-info').textContent = 'This exam closes on ' + windowData.closeDateTime;
    show('exam-close-info');
  }

  document.getElementById('begin-btn').addEventListener('click', function () {
    var fn = document.getElementById('first-name').value.trim();
    var ln = document.getElementById('last-name').value.trim();
    if (!fn || !ln) {
      document.getElementById('entry-error').textContent = 'Please enter your first and last name.';
      show('entry-error');
      return;
    }
    hide('entry-error');
    ExamState.firstName = fn;
    ExamState.lastName  = ln;

    // Check for an existing submission before loading the exam
    var btn = document.getElementById('begin-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    api({ action: 'checkStudentExists', examId: ExamState.examId, firstName: fn, lastName: ln })
      .then(function (data) {
        if (data.exists) {
          showAlreadySubmitted(data.shortCode);
        } else {
          loadExam();
        }
      })
      .catch(function () {
        // If check fails, proceed — don't block the student
        loadExam();
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Begin Exam →';
      });
  });
}

function showAlreadySubmitted(shortCode) {
  hide('entry-section');
  var info = document.getElementById('already-short-code-info');
  if (info) {
    info.textContent = shortCode
      ? 'Your short code is: ' + shortCode + ' — use it on the score page.'
      : 'Use the score page to look up your result.';
  }
  var link = document.getElementById('already-view-score-btn');
  if (link) link.href = window.SCORE_PAGE_URL || 'score.html';
  show('already-submitted-section');
}

// ─────────────────────────────────────────────────────────────
// LOAD EXAM
// ─────────────────────────────────────────────────────────────
function loadExam() {
  setStatus('Loading exam…');
  hide('entry-section');
  show('status-section');

  api({ action: 'getExamForStudent', examId: ExamState.examId })
    .then(function (data) {
      if (!data.success) {
        showError(data.message || 'Could not load the exam. Please try again.');
        return;
      }
      ExamState.examData = data;
      ExamState.startTime = new Date().toISOString();
      ExamState.studentId = 'TMP-' + Date.now(); // temporary until submission

      // Restore any saved progress
      restoreProgress();

      if (ExamState.antiCheat && ExamState.antiCheat.fullscreen) {
        showFullscreenPrompt(function () { startExam(); });
      } else {
        startExam();
      }
    })
    .catch(function () {
      showError('Could not load the exam. Please check your internet connection and refresh the page.');
    });
}

// ─────────────────────────────────────────────────────────────
// FULLSCREEN
// ─────────────────────────────────────────────────────────────
function showFullscreenPrompt(callback) {
  var modal = document.getElementById('fullscreen-modal');
  modal.classList.remove('hidden');
  document.getElementById('enter-fullscreen-btn').onclick = function () {
    requestFullscreen(document.documentElement);
    modal.classList.add('hidden');
    callback();
  };
}

function requestFullscreen(el) {
  if      (el.requestFullscreen)       el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.mozRequestFullScreen)    el.mozRequestFullScreen();
  else if (el.msRequestFullscreen)     el.msRequestFullscreen();
}

function exitFullscreenDetected() {
  return !document.fullscreenElement && !document.webkitFullscreenElement &&
         !document.mozFullScreenElement && !document.msFullscreenElement;
}

// ─────────────────────────────────────────────────────────────
// ANTI-CHEAT LISTENERS
// ─────────────────────────────────────────────────────────────
function attachAntiCheatListeners() {
  var ac = ExamState.antiCheat;
  if (!ac || !ac.enabled) return;

  if (ac.tabDetection) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur',  onWindowBlur);
    window.addEventListener('focus', onWindowFocus);
  }

  if (ac.fullscreen) {
    document.addEventListener('fullscreenchange',       onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    document.addEventListener('mozfullscreenchange',    onFullscreenChange);
    document.addEventListener('MSFullscreenChange',     onFullscreenChange);
  }

  // Grace-period return button
  var graceBtn = document.getElementById('grace-return-btn');
  if (graceBtn) {
    graceBtn.addEventListener('click', function () {
      cancelGrace();
      if (ExamState.antiCheat.fullscreen) requestFullscreen(document.documentElement);
    });
  }
}

function onVisibilityChange() {
  if (!ExamState.examStarted || ExamState.examSubmitted) return;
  if (document.hidden) {
    startGracePeriod('TAB_SWITCH');
  } else if (ExamState.graceActive) {
    cancelGrace();
  }
}

function onWindowBlur() {
  if (!ExamState.examStarted || ExamState.examSubmitted) return;
  // Only trigger grace if tab detection is on; fullscreen-only exams rely on fullscreenchange
  if (ExamState.antiCheat.tabDetection) startGracePeriod('WINDOW_BLUR');
}

function onWindowFocus() {
  if (!ExamState.examStarted || ExamState.examSubmitted) return;
  if (ExamState.graceActive) cancelGrace();
}

function onFullscreenChange() {
  if (!ExamState.examStarted || ExamState.examSubmitted) return;
  if (exitFullscreenDetected()) {
    startGracePeriod('FULLSCREEN_EXIT');
  } else if (ExamState.graceActive) {
    cancelGrace();
  }
}

// ─────────────────────────────────────────────────────────────
// GRACE PERIOD
// ─────────────────────────────────────────────────────────────
function startGracePeriod(type) {
  if (ExamState.graceActive || ExamState.examSubmitted) return;
  ExamState.graceActive    = true;
  ExamState.graceCountdown = 30;
  pauseTimers();

  var msgEl  = document.getElementById('grace-message');
  var cntEl  = document.getElementById('grace-countdown');
  if (msgEl) msgEl.textContent = type === 'FULLSCREEN_EXIT'
    ? 'You exited fullscreen mode.' : 'You switched away from this tab or window.';
  if (cntEl) cntEl.textContent = '30';
  document.getElementById('grace-overlay').classList.remove('hidden');

  ExamState.graceInterval = setInterval(function () {
    ExamState.graceCountdown--;
    if (cntEl) cntEl.textContent = ExamState.graceCountdown;

    if (ExamState.graceCountdown <= 0) {
      clearInterval(ExamState.graceInterval);
      ExamState.graceInterval = null;
      ExamState.graceActive   = false;
      document.getElementById('grace-overlay').classList.add('hidden');
      // Grace expired — now record it as a real violation
      recordViolation(type);
    }
  }, 1000);
}

function cancelGrace() {
  if (!ExamState.graceActive) return;
  clearInterval(ExamState.graceInterval);
  ExamState.graceInterval = null;
  ExamState.graceActive   = false;
  ExamState.graceCountdown = 0;
  document.getElementById('grace-overlay').classList.add('hidden');
  resumeTimers();
}

function recordViolation(type) {
  if (ExamState.examSubmitted) return;
  ExamState.violationCount++;
  var logEntry = { type: type, timestamp: new Date().toISOString(), count: ExamState.violationCount };
  ExamState.violationLog.push(logEntry);

  api({ action: 'logViolation', studentId: ExamState.studentId, examId: ExamState.examId,
        type: type, timestamp: logEntry.timestamp }).catch(function(){});

  pauseTimers();

  if (ExamState.violationCount === 1) {
    ExamState.violationFlag = 'WARNING';
    showViolationWarning(type);
  } else {
    ExamState.violationFlag = 'AUTO-SUBMITTED';
    autoSubmitExam();
  }
}

function showViolationWarning(type) {
  var overlay = document.getElementById('violation-overlay');
  var msg     = document.getElementById('violation-message');
  msg.textContent = type === 'FULLSCREEN_EXIT'
    ? 'You exited fullscreen mode. This is your ONE warning. A second violation will automatically submit your exam.'
    : 'You switched away from this window or tab. This is your ONE warning. A second violation will automatically submit your exam.';
  overlay.classList.remove('hidden');
  ExamState.firstViolationHandled = true;

  document.getElementById('violation-return-btn').onclick = function () {
    overlay.classList.add('hidden');
    if (ExamState.antiCheat.fullscreen) requestFullscreen(document.documentElement);
    resumeTimers();
  };
}

function autoSubmitExam() {
  if (ExamState.examSubmitted) return;
  ExamState.examSubmitted = true;
  stopAllTimers();
  saveProgress();

  submitToServer(function (shortCode) {
    showAutoSubmitOverlay(shortCode);
  });
}

function showAutoSubmitOverlay(shortCode) {
  var overlay = document.getElementById('auto-submit-overlay');
  document.getElementById('auto-submit-code').textContent = shortCode || 'N/A';
  overlay.classList.remove('hidden');
}

function blockCheatKeys(e) {
  if (!ExamState.examStarted) return;
  var blocked = (
    (e.ctrlKey && ['c','v','a','u','s'].includes(e.key.toLowerCase())) ||
    e.key === 'F12'
  );
  if (blocked) e.preventDefault();
}

// ─────────────────────────────────────────────────────────────
// START EXAM
// ─────────────────────────────────────────────────────────────
function startExam() {
  ExamState.examStarted = true;
  hide('status-section');
  show('exam-section');

  var data = ExamState.examData;

  // Per-question timer always disables back navigation
  if (data.perQuestionTimer && Number(data.perQuestionTimer) > 0) {
    data.allowBackNav = false;
  }

  // Show no-back-nav notice if applicable
  if (!data.allowBackNav) {
    document.getElementById('no-back-notice').classList.remove('hidden');
  }

  // Start whole exam timer
  if (data.wholeTimer && Number(data.wholeTimer) > 0) {
    ExamState.wholeTimerSecondsLeft = Number(data.wholeTimer) * 60;
    show('whole-timer-container');
    startWholeTimer();
  }

  attachAntiCheatListeners();
  renderQuestion(ExamState.currentIndex);
}

// ─────────────────────────────────────────────────────────────
// QUESTION RENDERING
// ─────────────────────────────────────────────────────────────
function renderQuestion(index) {
  var questions = ExamState.examData.questions;
  if (index < 0 || index >= questions.length) return;

  ExamState.currentIndex = index;
  var q = questions[index];

  // Update progress
  document.getElementById('question-number').textContent = 'Question ' + (index + 1) + ' of ' + questions.length;
  updateProgressBar(index + 1, questions.length);

  // Render question body
  var container = document.getElementById('question-container');
  container.innerHTML = '';

  var card = document.createElement('div');
  card.className = 'question-card';

  var qText = document.createElement('div');
  qText.className = 'question-text';
  qText.textContent = (index + 1) + '. ' + q.text;
  card.appendChild(qText);

  var inputArea = document.createElement('div');
  inputArea.className = 'question-inputs';
  inputArea.appendChild(renderInputForType(q));
  card.appendChild(inputArea);

  container.appendChild(card);

  // Start per-question timer
  if (ExamState.examData.perQuestionTimer && Number(ExamState.examData.perQuestionTimer) > 0) {
    startPerQuestionTimer(Number(ExamState.examData.perQuestionTimer));
  }

  // Navigation buttons
  var prevBtn = document.getElementById('prev-btn');
  var nextBtn = document.getElementById('next-btn');

  prevBtn.style.display = (ExamState.examData.allowBackNav && index > 0) ? 'inline-block' : 'none';

  if (index === questions.length - 1) {
    nextBtn.textContent = 'Submit Exam';
    nextBtn.className = 'btn btn-success';
    nextBtn.onclick = function () { confirmSubmit(); };
  } else {
    nextBtn.textContent = 'Next →';
    nextBtn.className = 'btn btn-primary';
    nextBtn.onclick = function () { goNext(); };
  }

  prevBtn.onclick = function () { goPrev(); };

  // Restore existing answer for this question
  restoreQuestionAnswer(q);
}

function renderInputForType(q) {
  var wrapper = document.createElement('div');
  var saved   = ExamState.answers[q.questionId];

  switch (q.type) {
    case 'multiple_choice':
      // Always display options in sequential a/b/c/d order.
      // Options may be shuffled (content reordered) — strip any original letter prefix
      // and relabel sequentially so display is always a. b. c. d.
      // The raw option text is saved as the answer value (preserves original letter for scoring).
      var seqLetters = ['a', 'b', 'c', 'd', 'e'];
      q.options.forEach(function (opt, oi) {
        var label = document.createElement('label');
        label.className = 'option-label';
        var radio = document.createElement('input');
        radio.type  = 'radio';
        radio.name  = 'q_' + q.questionId;
        radio.value = opt; // keep original value so scoring logic still works
        radio.addEventListener('change', function () { saveAnswer(q.questionId, opt); });
        if (saved === opt) radio.checked = true;
        // Strip existing letter prefix (e.g. "C. " or "c) ") and relabel sequentially
        var displayText = String(opt).replace(/^[A-Ea-e][\s.)\-]+\s*/, '').trim();
        label.appendChild(radio);
        label.appendChild(document.createTextNode(' ' + (seqLetters[oi] || (oi + 1)) + '. ' + displayText));
        wrapper.appendChild(label);
      });
      break;

    case 'true_false':
      ['True', 'False'].forEach(function (val) {
        var label  = document.createElement('label');
        label.className = 'option-label';
        var radio  = document.createElement('input');
        radio.type  = 'radio';
        radio.name  = 'q_' + q.questionId;
        radio.value = val;
        radio.addEventListener('change', function () { saveAnswer(q.questionId, val); });
        if (saved === val) radio.checked = true;
        label.appendChild(radio);
        label.appendChild(document.createTextNode(' ' + val));
        wrapper.appendChild(label);
      });
      break;

    case 'identification':
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'text-input';
      inp.placeholder = 'Type your answer here…';
      inp.value = saved || '';
      inp.addEventListener('input', function () { saveAnswer(q.questionId, inp.value); });
      wrapper.appendChild(inp);
      break;

    case 'multiple_response':
      var hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Select all correct answers.';
      wrapper.appendChild(hint);
      var savedArr = Array.isArray(saved) ? saved : [];
      var seqLettersMR = ['a', 'b', 'c', 'd', 'e', 'f'];
      q.options.forEach(function (opt, oi) {
        var label = document.createElement('label');
        label.className = 'option-label';
        var cb    = document.createElement('input');
        cb.type   = 'checkbox';
        cb.value  = opt;
        cb.checked = savedArr.includes(opt);
        cb.addEventListener('change', function () {
          var checks = Array.from(wrapper.querySelectorAll('input[type=checkbox]:checked')).map(function(c){ return c.value; });
          saveAnswer(q.questionId, checks);
        });
        var displayText = String(opt).replace(/^[A-Fa-f][\s.)\-]+\s*/, '').trim();
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + (seqLettersMR[oi] || (oi + 1)) + '. ' + displayText));
        wrapper.appendChild(label);
      });
      break;

    case 'short_answer':
    case 'essay':
      var ta = document.createElement('textarea');
      ta.className = 'essay-input';
      ta.rows = 6;
      ta.placeholder = q.type === 'essay' ? 'Write your essay here…' : 'Write your answer here…';
      ta.value = saved || '';
      ta.addEventListener('input', function () { saveAnswer(q.questionId, ta.value); });
      wrapper.appendChild(ta);
      break;

    case 'enumeration':
      var count   = q.options && q.options.length ? q.options.length : 3;
      var savedEn = Array.isArray(saved) ? saved : [];
      for (var i = 0; i < count; i++) {
        var row    = document.createElement('div');
        row.className = 'enum-row';
        var lbl    = document.createElement('span');
        lbl.textContent = (i + 1) + '. ';
        var enInp  = document.createElement('input');
        enInp.type = 'text';
        enInp.className = 'enum-input';
        enInp.value = savedEn[i] || '';
        enInp.dataset.index = i;
        enInp.addEventListener('input', function () {
          var allInputs = wrapper.querySelectorAll('.enum-input');
          var vals = Array.from(allInputs).map(function(x){ return x.value; });
          saveAnswer(q.questionId, vals);
        });
        row.appendChild(lbl);
        row.appendChild(enInp);
        wrapper.appendChild(row);
      }
      break;

    case 'matching_type':
      var hint2 = document.createElement('p');
      hint2.className = 'hint';
      hint2.textContent = 'Match each item in Column A to the correct item in Column B.';
      wrapper.appendChild(hint2);

      // Build Column B options from answerKey values (not exposed in answer; use q.matchOptions if provided)
      // For matching type, q.options contains Column A items; Column B items come from a separate field
      var colBItems = q.matchColumnB || [];
      var savedMap  = (typeof saved === 'object' && !Array.isArray(saved)) ? saved : {};

      q.options.forEach(function (colAItem) {
        var row2   = document.createElement('div');
        row2.className = 'match-row';
        var colAEl = document.createElement('span');
        colAEl.className = 'match-col-a';
        colAEl.textContent = colAItem;
        var arrow  = document.createElement('span');
        arrow.textContent = ' → ';
        var sel    = document.createElement('select');
        sel.className = 'match-select';
        var blank  = document.createElement('option');
        blank.value = '';
        blank.textContent = '-- Select match --';
        sel.appendChild(blank);
        colBItems.forEach(function (b) {
          var opt2  = document.createElement('option');
          opt2.value = b;
          opt2.textContent = b;
          if (savedMap[colAItem] === b) opt2.selected = true;
          sel.appendChild(opt2);
        });
        sel.addEventListener('change', function () {
          var allSelects = wrapper.querySelectorAll('.match-select');
          var map = {};
          allSelects.forEach(function (s, si) { map[q.options[si]] = s.value; });
          saveAnswer(q.questionId, map);
        });
        row2.appendChild(colAEl);
        row2.appendChild(arrow);
        row2.appendChild(sel);
        wrapper.appendChild(row2);
      });
      break;

    default:
      var unknown = document.createElement('p');
      unknown.textContent = 'Unknown question type: ' + q.type;
      wrapper.appendChild(unknown);
  }

  return wrapper;
}

function restoreQuestionAnswer(q) {
  // Input values are already set during renderInputForType by reading ExamState.answers
  // This is a no-op kept for clarity
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────
function goNext() {
  stopPerQTimer();
  if (ExamState.currentIndex < ExamState.examData.questions.length - 1) {
    renderQuestion(ExamState.currentIndex + 1);
  }
}

function goPrev() {
  if (!ExamState.examData.allowBackNav) return;
  stopPerQTimer();
  if (ExamState.currentIndex > 0) {
    renderQuestion(ExamState.currentIndex - 1);
  }
}

function saveAnswer(questionId, value) {
  ExamState.answers[questionId] = value;
  saveProgress();
  updateProgressBar(ExamState.currentIndex + 1, ExamState.examData.questions.length);
}

function updateProgressBar(current, total) {
  var pct = Math.round((current / total) * 100);
  var bar = document.getElementById('progress-bar-fill');
  if (bar) bar.style.width = pct + '%';
  // Mark answered questions
  var answered = Object.keys(ExamState.answers).filter(function(id){ return ExamState.answers[id] !== undefined && ExamState.answers[id] !== '' && ExamState.answers[id] !== null; }).length;
  var ansCount = document.getElementById('answered-count');
  if (ansCount) ansCount.textContent = answered + ' / ' + total + ' answered';
}

// ─────────────────────────────────────────────────────────────
// TIMERS
// ─────────────────────────────────────────────────────────────
function startWholeTimer() {
  updateWholeTimerDisplay();
  ExamState.wholeTimerInterval = setInterval(function () {
    ExamState.wholeTimerSecondsLeft--;
    updateWholeTimerDisplay();
    if (ExamState.wholeTimerSecondsLeft <= 0) {
      stopAllTimers();
      autoSubmitExam();
    }
  }, 1000);
}

function updateWholeTimerDisplay() {
  var el  = document.getElementById('whole-timer-display');
  var sec = ExamState.wholeTimerSecondsLeft;
  var m   = Math.floor(sec / 60);
  var s   = sec % 60;
  el.textContent = 'Time Remaining: ' + pad(m) + ':' + pad(s);
  if (sec <= 300) { el.classList.add('timer-warning'); }
}

function startPerQuestionTimer(seconds) {
  stopPerQTimer();
  ExamState.perQTimerSecondsLeft = seconds;
  show('per-q-timer-container');
  updatePerQTimerDisplay();

  ExamState.perQTimerInterval = setInterval(function () {
    ExamState.perQTimerSecondsLeft--;
    updatePerQTimerDisplay();
    if (ExamState.perQTimerSecondsLeft <= 0) {
      stopPerQTimer();
      // Lock current answer and advance
      var q = ExamState.examData.questions[ExamState.currentIndex];
      if (ExamState.answers[q.questionId] === undefined) {
        ExamState.answers[q.questionId] = null; // Mark as unanswered
      }
      goNext();
    }
  }, 1000);
}

function updatePerQTimerDisplay() {
  var el  = document.getElementById('per-q-timer-display');
  var sec = ExamState.perQTimerSecondsLeft;
  el.textContent = 'Time for this question: ' + sec + ' second' + (sec !== 1 ? 's' : '');
  if (sec <= 10) el.classList.add('timer-warning');
  else           el.classList.remove('timer-warning');
}

function stopPerQTimer() {
  clearInterval(ExamState.perQTimerInterval);
  ExamState.perQTimerInterval = null;
  hide('per-q-timer-container');
}

function stopAllTimers() {
  clearInterval(ExamState.wholeTimerInterval);
  clearInterval(ExamState.perQTimerInterval);
}

function pauseTimers() {
  clearInterval(ExamState.wholeTimerInterval);
  clearInterval(ExamState.perQTimerInterval);
}

function resumeTimers() {
  if (ExamState.examData.wholeTimer && ExamState.wholeTimerSecondsLeft > 0) startWholeTimer();
  var q = ExamState.examData.questions[ExamState.currentIndex];
  if (q && ExamState.examData.perQuestionTimer && ExamState.perQTimerSecondsLeft > 0) {
    ExamState.perQTimerInterval = setInterval(function () {
      ExamState.perQTimerSecondsLeft--;
      updatePerQTimerDisplay();
      if (ExamState.perQTimerSecondsLeft <= 0) {
        stopPerQTimer();
        goNext();
      }
    }, 1000);
  }
}

function pad(n) { return n < 10 ? '0' + n : String(n); }

// ─────────────────────────────────────────────────────────────
// SUBMISSION
// ─────────────────────────────────────────────────────────────
function confirmSubmit() {
  document.getElementById('submit-modal').classList.remove('hidden');
  document.getElementById('confirm-submit-btn').onclick = function () {
    document.getElementById('submit-modal').classList.add('hidden');
    submitExam();
  };
  document.getElementById('cancel-submit-btn').onclick = function () {
    document.getElementById('submit-modal').classList.add('hidden');
  };
}

function submitExam() {
  if (ExamState.examSubmitted) return;
  ExamState.examSubmitted = true;
  stopAllTimers();

  show('status-section');
  hide('exam-section');
  setStatus('Submitting your exam…');

  submitToServer(function (shortCode, score, total, percentage) {
    clearProgress();
    showSubmitSuccess(shortCode, score, total, percentage);
  });
}

function submitToServer(callback) {
  var body = {
    action:         'submitExam',
    examId:         ExamState.examId,
    firstName:      ExamState.firstName,
    lastName:       ExamState.lastName,
    answers:        ExamState.answers,
    startTime:      ExamState.startTime,
    violationFlag:  ExamState.violationFlag,
    violationLog:   ExamState.violationLog
  };

  api(body)
    .then(function (data) {
      if (!data.success) {
        showError('Submission failed: ' + (data.error || 'Unknown error. Please contact your instructor.'));
        return;
      }
      if (callback) callback(data.shortCode, data.rawScore, data.totalPoints, data.percentage);
    })
    .catch(function () {
      showError('Could not connect to the server. Please contact your instructor immediately.');
    });
}

function showSubmitSuccess(shortCode, score, total, pct) {
  hide('status-section');
  var success = document.getElementById('submit-success');
  document.getElementById('success-short-code').textContent = shortCode || 'N/A';
  document.getElementById('score-link').href = window.SCORE_PAGE_URL || '../score.html';
  var data      = ExamState.examData || {};
  var closeInfo = data.closeDateTime || '';
  var tz        = data.timezone || 'Asia/Manila';
  var tzLabel   = '';
  try {
    // Show timezone abbreviation/offset for clarity
    var tzDate  = new Date();
    tzLabel     = ' (' + tzDate.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'short' }).split(', ')[1].split(' ').pop() + ')';
  } catch(_) {}
  document.getElementById('score-avail-info').textContent = closeInfo
    ? 'Scores will be available after the exam closes on ' + closeInfo + tzLabel + '.'
    : 'Scores will be available after the instructor closes the exam.';
  success.classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────
// LOCAL STORAGE PROGRESS
// ─────────────────────────────────────────────────────────────
function progressKey() {
  return 'exam_' + ExamState.examId + '_' + ExamState.firstName + '_' + ExamState.lastName;
}

function saveProgress() {
  try {
    localStorage.setItem(progressKey(), JSON.stringify({
      answers:       ExamState.answers,
      currentIndex:  ExamState.currentIndex
    }));
  } catch(_) {}
}

function restoreProgress() {
  try {
    var saved = localStorage.getItem(progressKey());
    if (saved) {
      var parsed = JSON.parse(saved);
      ExamState.answers      = parsed.answers || {};
      ExamState.currentIndex = parsed.currentIndex || 0;
    }
  } catch(_) {}
}

function clearProgress() {
  try { localStorage.removeItem(progressKey()); } catch(_) {}
}

// ─────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────
function show(id) {
  var el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hide(id) {
  var el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function setStatus(msg) {
  var el = document.getElementById('status-message');
  if (el) el.textContent = msg;
  show('status-section');
}

function showError(msg) {
  hide('entry-section');
  hide('exam-section');
  hide('status-section');
  var err = document.getElementById('error-section');
  err.textContent = msg;
  err.classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────
function api(body) {
  var url = window.APPS_SCRIPT_URL;
  if (!url) return Promise.reject(new Error('Apps Script URL not configured.'));
  // text/plain avoids the CORS preflight that Apps Script cannot handle
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}
