// instructor.js — Full instructor dashboard logic: auth, tabs, exam creation, gradebook.

// ─────────────────────────────────────────────────────────────
// CONFIG — paste your Apps Script Web App URL here after deployment
// ─────────────────────────────────────────────────────────────
window.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyr_308Y5fyZJcbKkeDHiLCgSyEus6sOStlqO0Gk_y7KjKgwfxYj3Od3IKYr8dBqOiATQ/exec';
window.SCORE_PAGE_URL  = window.location.origin + window.location.pathname.replace('index.html','') + 'score.html';

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
var App = {
  password:       null,
  subjects:       [],
  currentExamId:  null,
  parsedQuestions: [],
  referenceText:  ''
};

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  showPasswordModal();
});

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
function showPasswordModal() {
  document.getElementById('password-modal').classList.remove('hidden');
  document.getElementById('password-input').focus();

  document.getElementById('password-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = document.getElementById('password-input').value;
    if (!pw) return;
    verifyPassword(pw);
  });
}

function verifyPassword(pw) {
  setPasswordError('');
  document.getElementById('password-btn').textContent = 'Verifying…';
  document.getElementById('password-btn').disabled = true;

  api({ action: 'verifyPassword', password: pw })
    .then(function (data) {
      if (data.success) {
        App.password = pw;
        sessionStorage.setItem('exam_gen_session', 'valid');
        document.getElementById('password-modal').classList.add('hidden');
        initDashboard();
      } else {
        setPasswordError(data.error || 'Invalid password. Please try again.');
      }
    })
    .catch(function () {
      setPasswordError('Could not connect to the server. Please check your Apps Script URL.');
    })
    .finally(function () {
      document.getElementById('password-btn').textContent = 'Login';
      document.getElementById('password-btn').disabled = false;
    });
}

function setPasswordError(msg) {
  document.getElementById('password-error').textContent = msg;
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD INIT
// ─────────────────────────────────────────────────────────────
function initDashboard() {
  document.getElementById('dashboard').classList.remove('hidden');
  setupTabs();
  loadSubjects();
  loadExamsTab();
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function(p){ p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + target).classList.add('active');

      if (target === 'exams')     loadExamsTab();
      if (target === 'gradebook') initGradebookTab();
    });
  });
  // Activate first tab
  document.querySelector('.tab-btn[data-tab="create"]').click();
}

// ─────────────────────────────────────────────────────────────
// TAB 1: CREATE EXAM — STEP 1: SUBJECT
// ─────────────────────────────────────────────────────────────
function loadSubjects() {
  api({ action: 'getSubjects', password: App.password })
    .then(function (data) {
      if (!data.success) return;
      App.subjects = data.subjects || [];
      populateSubjectSelects();
    });
}

function populateSubjectSelects() {
  var selects = document.querySelectorAll('.subject-select');
  selects.forEach(function (sel) {
    sel.innerHTML = '<option value="">-- Select Subject --</option>';
    App.subjects.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value       = s['Subject ID'];
      opt.textContent = s['Subject Name'] + ' (' + s['Subject Code'] + ')';
      sel.appendChild(opt);
    });
  });
}

// New subject form toggle
document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('new-subject-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      document.getElementById('new-subject-form').classList.toggle('hidden');
    });
  }

  var saveSubjectBtn = document.getElementById('save-subject-btn');
  if (saveSubjectBtn) {
    saveSubjectBtn.addEventListener('click', function () {
      var name  = document.getElementById('new-subject-name').value.trim();
      var code  = document.getElementById('new-subject-code').value.trim();
      var notes = document.getElementById('new-subject-notes').value.trim();
      if (!name || !code) { alert('Subject name and code are required.'); return; }

      setButtonLoading('save-subject-btn', true);
      api({ action: 'createSubject', password: App.password, name, code, notes })
        .then(function (data) {
          if (!data.success) { alert('Error: ' + data.error); return; }
          showToast('Subject created successfully!');
          loadSubjects();
          document.getElementById('new-subject-form').classList.add('hidden');
          document.getElementById('new-subject-name').value = '';
          document.getElementById('new-subject-code').value = '';
        })
        .catch(function () { alert('Could not create subject. Please try again.'); })
        .finally(function () { setButtonLoading('save-subject-btn', false); });
    });
  }
});

// ─────────────────────────────────────────────────────────────
// TAB 1: CREATE EXAM — STEP 3-4: FILE UPLOAD
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  var dropzone = document.getElementById('file-dropzone');
  if (!dropzone) return;

  dropzone.addEventListener('dragover',  function(e){ e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', function(){  dropzone.classList.remove('drag-over'); });
  dropzone.addEventListener('drop',      function(e){ e.preventDefault(); dropzone.classList.remove('drag-over'); handleFileUpload(e.dataTransfer.files[0]); });
  dropzone.addEventListener('click',     function(){  document.getElementById('file-input').click(); });

  document.getElementById('file-input').addEventListener('change', function(e){ handleFileUpload(e.target.files[0]); });

  document.getElementById('parse-file-btn').addEventListener('click', function () {
    var mode = document.querySelector('input[name="upload-mode"]:checked').value;
    var file = App.selectedFile;
    var url  = document.getElementById('google-url-input').value.trim();

    if (!file && !url) { alert('Please upload a file or paste a Google Docs/Slides URL.'); return; }

    if (file) {
      readFileAsBase64(file, function (base64, mimeType) {
        doParseFile({ mode, fileData: base64, mimeType });
      });
    } else {
      doParseFile({ mode, url });
    }
  });
});

function handleFileUpload(file) {
  if (!file) return;
  App.selectedFile = file;
  document.getElementById('file-name-display').textContent = file.name + ' (' + formatFileSize(file.size) + ')';
  document.getElementById('file-name-display').classList.remove('hidden');
}

function readFileAsBase64(file, callback) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var base64 = e.target.result.split(',')[1];
    callback(base64, file.type);
  };
  reader.readAsDataURL(file);
}

function doParseFile(params) {
  setButtonLoading('parse-file-btn', true);
  showStep3Status('Parsing file with Gemini AI…');

  api(Object.assign({ action: 'uploadAndParseFile', password: App.password }, params))
    .then(function (data) {
      if (!data.success) { showStep3Status('Error: ' + data.error); return; }

      if (data.mode === 'questionnaire') {
        App.parsedQuestions = normalizeQuestions(data.questions);
        App.referenceText   = '';
        showStep3Status('Found ' + App.parsedQuestions.length + ' questions. Scroll down to configure and save.');
        document.getElementById('step5-section').style.display = '';
        document.getElementById('reference-only-settings').style.display = 'none';
        showQuestionnaireDecision(App.parsedQuestions);
        renderQuestionPreview(App.parsedQuestions);
      } else {
        App.referenceText   = data.text || '';
        App.parsedQuestions = [];
        showStep3Status('Reference material loaded (' + App.referenceText.length + ' characters). Configure settings and click Generate.');
        document.getElementById('step5-section').style.display = '';
        document.getElementById('questionnaire-decision').style.display = 'none';
        document.getElementById('reference-only-settings').style.display = '';
      }
    })
    .catch(function () { showStep3Status('Connection error. Please try again.'); })
    .finally(function () { setButtonLoading('parse-file-btn', false); });
}

// ─────────────────────────────────────────────────────────────
// TAB 1: GENERATE EXAM (Reference Mode)
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  var genBtn = document.getElementById('generate-exam-btn');
  if (!genBtn) return;

  genBtn.addEventListener('click', function () {
    var subjectId = document.getElementById('subject-select-create').value;
    var title     = document.getElementById('exam-title-input').value.trim();
    var qCount    = parseInt(document.getElementById('question-count').value) || 20;
    var types     = Array.from(document.querySelectorAll('input[name="qtype"]:checked')).map(function(c){ return c.value; });
    var bloomMode = document.querySelector('input[name="bloom-mode"]:checked')?.value || 'General';
    var bloomLevels = Array.from(document.querySelectorAll('input[name="bloom-level"]:checked')).map(function(c){ return c.value; });

    if (!subjectId)       { alert('Please select a subject.'); return; }
    if (!title)           { alert('Please enter an exam title.'); return; }
    if (!types.length)    { alert('Please select at least one question type.'); return; }
    if (!App.referenceText) { alert('Please upload reference material first.'); return; }

    var subjectName = '';
    var subj = App.subjects.find(function(s){ return s['Subject ID'] === subjectId; });
    if (subj) subjectName = subj['Subject Name'];

    setButtonLoading('generate-exam-btn', true);
    showStep3Status('Generating ' + qCount + ' questions with Gemini AI… This may take 30–60 seconds.');

    api({
      action: 'generateExam', password: App.password,
      referenceText: App.referenceText, examTitle: title,
      subjectName, questionCount: qCount, questionTypes: types, bloomMode, bloomLevels
    })
      .then(function (data) {
        if (!data.success) { showStep3Status('Error: ' + data.error); return; }
        App.parsedQuestions = normalizeQuestions(data.questions);
        if (data.masterDocUrl) {
          App.masterDocUrl = data.masterDocUrl;
          showStep3Status('Generated ' + App.parsedQuestions.length + ' questions. <a href="' + data.masterDocUrl + '" target="_blank">View Master Document</a>');
        } else {
          showStep3Status('Generated ' + App.parsedQuestions.length + ' questions.');
        }
        renderQuestionPreview(App.parsedQuestions);
      })
      .catch(function () { showStep3Status('Generation failed. Please try again.'); })
      .finally(function () { setButtonLoading('generate-exam-btn', false); });
  });
});

// ─────────────────────────────────────────────────────────────
// TAB 1: QUESTIONNAIRE DECISION (Keep As-Is / Remodel)
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  var keepBtn   = document.getElementById('keep-as-is-btn');
  var remodelBtn = document.getElementById('remodel-types-btn');
  var applyBtn  = document.getElementById('apply-remodel-btn');
  if (keepBtn)    keepBtn.addEventListener('click',   keepAsIs);
  if (remodelBtn) remodelBtn.addEventListener('click', showRemodelFormUI);
  if (applyBtn)   applyBtn.addEventListener('click',  applyRemodel);
});

function showQuestionnaireDecision(questions) {
  var typeCounts = {};
  questions.forEach(function (q) {
    var t = q.type || 'unknown';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  var typeLabel = {
    multiple_choice:   'Multiple Choice',
    true_false:        'True / False',
    identification:    'Identification',
    multiple_response: 'Multiple Response',
    short_answer:      'Short Answer',
    essay:             'Essay',
    enumeration:       'Enumeration',
    matching_type:     'Matching Type'
  };

  var parts = Object.keys(typeCounts).map(function (t) {
    return '<strong>' + typeCounts[t] + '</strong> ' + (typeLabel[t] || t.replace(/_/g, ' '));
  });

  document.getElementById('q-type-summary-text').innerHTML =
    'Found <strong>' + questions.length + '</strong> questions — ' + parts.join(', ') + '.';

  document.getElementById('questionnaire-decision').style.display = '';
  document.getElementById('remodel-form').style.display = 'none';

  document.getElementById('step5-section').scrollIntoView({ behavior: 'smooth' });
}

function keepAsIs() {
  document.getElementById('questionnaire-decision').style.display = 'none';
  var preview = document.getElementById('preview-section');
  if (preview && !preview.classList.contains('hidden')) {
    preview.scrollIntoView({ behavior: 'smooth' });
  }
}

function showRemodelFormUI() {
  var total     = App.parsedQuestions.length;
  var container = document.getElementById('remodel-type-inputs');
  container.innerHTML = '';

  document.getElementById('remodel-total-hint').textContent =
    'Total uploaded: ' + total + ' questions. Specify how many of each type you want (sum must not exceed ' + total + ').';

  var types = [
    { value: 'multiple_choice',   label: 'Multiple Choice' },
    { value: 'true_false',        label: 'True / False' },
    { value: 'identification',    label: 'Identification' },
    { value: 'multiple_response', label: 'Multiple Response' },
    { value: 'short_answer',      label: 'Short Answer' },
    { value: 'essay',             label: 'Essay' },
    { value: 'enumeration',       label: 'Enumeration' },
    { value: 'matching_type',     label: 'Matching Type' }
  ];

  types.forEach(function (type) {
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;min-width:110px;';
    wrapper.innerHTML =
      '<label style="font-size:0.78rem;font-weight:600;color:#4a5568;">' + type.label + '</label>' +
      '<input type="number" class="remodel-count-input" min="0" value="0"' +
      ' data-type="' + type.value + '"' +
      ' style="width:65px;padding:0.3rem 0.4rem;border:1px solid #cbd5e0;border-radius:6px;font-size:0.9rem;">';
    container.appendChild(wrapper);
  });

  container.querySelectorAll('.remodel-count-input').forEach(function (inp) {
    inp.addEventListener('input', updateRemodelWarning);
  });

  document.getElementById('remodel-form').style.display = '';
}

function updateRemodelWarning() {
  var total = App.parsedQuestions.length;
  var sum   = 0;
  document.querySelectorAll('.remodel-count-input').forEach(function (inp) {
    sum += parseInt(inp.value) || 0;
  });
  var warning = document.getElementById('remodel-warning');
  if (sum > 0 && sum > total) {
    warning.style.display = '';
    warning.textContent = 'Warning: total (' + sum + ') exceeds uploaded count (' + total + '). Please reduce.';
  } else {
    warning.style.display = 'none';
    warning.textContent   = '';
  }
}

function applyRemodel() {
  var total        = App.parsedQuestions.length;
  var distribution = {};
  var sum          = 0;

  document.querySelectorAll('.remodel-count-input').forEach(function (inp) {
    var count = parseInt(inp.value) || 0;
    if (count > 0) { distribution[inp.dataset.type] = count; sum += count; }
  });

  if (sum === 0)   { alert('Please specify at least one question type and count.'); return; }
  if (sum > total) { alert('Total (' + sum + ') exceeds uploaded count (' + total + '). Please reduce.'); return; }

  setButtonLoading('apply-remodel-btn', true);
  showStep3Status('Remodeling ' + sum + ' questions with Gemini AI… This may take 30–60 seconds.');

  api({ action: 'remodelQuestions', password: App.password,
        questions: App.parsedQuestions, distribution: distribution })
    .then(function (data) {
      if (!data.success) { showStep3Status('Error: ' + data.error); return; }
      App.parsedQuestions = normalizeQuestions(data.questions);
      showStep3Status('Remodeled to ' + App.parsedQuestions.length + ' questions. Review below.');
      document.getElementById('questionnaire-decision').style.display = 'none';
      renderQuestionPreview(App.parsedQuestions);
    })
    .catch(function () { showStep3Status('Remodel failed. Please try again.'); })
    .finally(function () { setButtonLoading('apply-remodel-btn', false); });
}

// ─────────────────────────────────────────────────────────────
// TAB 1: QUESTION PREVIEW
// ─────────────────────────────────────────────────────────────
function renderQuestionPreview(questions) {
  var container = document.getElementById('question-preview-list');
  var section   = document.getElementById('preview-section');
  container.innerHTML = '';
  section.classList.remove('hidden');

  questions.forEach(function (q, idx) {
    container.appendChild(buildQuestionCard(q, idx));
  });

  document.getElementById('save-draft-btn').onclick = function () { submitExamForm('Draft'); };
  document.getElementById('save-activate-btn').onclick = function () { submitExamForm('Active'); };
}

function buildQuestionCard(q, idx) {
  var card = document.createElement('div');
  card.className = 'q-preview-card';
  card.dataset.idx = idx;

  card.innerHTML = [
    '<div class="q-preview-header">',
    '  <span class="q-num">Q' + (idx + 1) + '</span>',
    '  <span class="q-type-badge">' + q.type.replace('_',' ') + '</span>',
    '  <span class="q-bloom">' + (q.bloomLevel || '') + '</span>',
    '  <button class="btn btn-icon delete-q-btn" title="Delete question">🗑</button>',
    '  <span class="drag-handle" title="Drag to reorder">⠿</span>',
    '</div>',
    '<div class="q-preview-text">',
    '  <label class="form-label">Question</label>',
    '  <textarea class="q-text-edit" data-field="text" rows="2">' + escHtml(q.text) + '</textarea>',
    '</div>',
    q.options && q.options.length ? [
      '<div class="q-preview-options">',
      '<label class="form-label">Options</label>',
      q.options.map(function(opt, oi){
        return '<input class="q-option-edit" data-field="option" data-optidx="' + oi + '" value="' + escHtml(opt) + '">';
      }).join(''),
      '</div>'
    ].join('') : '',
    '<div class="q-preview-answer">',
    '  <label class="form-label">Answer Key</label>',
    '  <input class="q-answer-edit" data-field="answerKey" value="' + escHtml(JSON.stringify(q.answerKey)) + '">',
    '</div>',
  ].join('');

  // Delete button
  card.querySelector('.delete-q-btn').addEventListener('click', function () {
    App.parsedQuestions.splice(idx, 1);
    renderQuestionPreview(App.parsedQuestions);
  });

  // Live edit syncing
  card.querySelectorAll('[data-field]').forEach(function (el) {
    el.addEventListener('input', function () {
      var field = el.dataset.field;
      if (field === 'text')      App.parsedQuestions[idx].text = el.value;
      if (field === 'answerKey') {
        try { App.parsedQuestions[idx].answerKey = JSON.parse(el.value); }
        catch(_) { App.parsedQuestions[idx].answerKey = el.value; }
      }
      if (field === 'option') App.parsedQuestions[idx].options[parseInt(el.dataset.optidx)] = el.value;
    });
  });

  return card;
}

document.addEventListener('DOMContentLoaded', function () {
  var addBtn = document.getElementById('add-question-btn');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      App.parsedQuestions.push({ text: '', type: 'multiple_choice', options: ['A. ','B. ','C. ','D. '], answerKey: '', bloomLevel: '', points: 1 });
      renderQuestionPreview(App.parsedQuestions);
      // Scroll to bottom
      document.getElementById('question-preview-list').lastElementChild.scrollIntoView({ behavior: 'smooth' });
    });
  }
});

// ─────────────────────────────────────────────────────────────
// TAB 1: SAVE / ACTIVATE EXAM
// ─────────────────────────────────────────────────────────────
function submitExamForm(status) {
  var subjectId = document.getElementById('subject-select-create').value;
  var title     = document.getElementById('exam-title-input').value.trim();
  if (!subjectId)                    { alert('Please select a subject.'); return; }
  if (!title)                        { alert('Please enter an exam title.'); return; }
  if (!App.parsedQuestions.length)   { alert('There are no questions to save.'); return; }

  var body = {
    action:              status === 'Active' ? 'saveExam' : 'saveExam',
    password:            App.password,
    subjectId,
    title,
    examType:            getSelectedExamType(),
    timezone:            document.getElementById('exam-timezone') ? document.getElementById('exam-timezone').value : 'Asia/Manila',
    openDateTime:        document.getElementById('open-datetime').value,
    closeDateTime:       document.getElementById('close-datetime').value,
    wholeTimer:          document.getElementById('whole-timer-toggle').checked ? document.getElementById('whole-timer-mins').value : '',
    perQuestionTimer:    document.getElementById('perq-timer-toggle').checked ? document.getElementById('perq-timer-secs').value : '',
    allowBackNav:        document.getElementById('back-nav-toggle').checked,
    antiCheat:           getAntiCheatSettings(),
    shuffleQuestions:    document.getElementById('shuffle-q-toggle').checked,
    shuffleAnswers:      document.getElementById('shuffle-a-toggle').checked,
    bloomMode:           document.querySelector('input[name="bloom-mode"]:checked')?.value || 'General',
    notes:               document.getElementById('exam-notes').value,
    questions:           App.parsedQuestions,
    status:              'Draft',
    masterDocLink:       App.masterDocUrl || ''
  };

  setButtonLoading(status === 'Active' ? 'save-activate-btn' : 'save-draft-btn', true);

  api(body)
    .then(function (data) {
      if (!data.success) { alert('Error saving exam: ' + data.error); return; }

      App.currentExamId = data.examId;

      if (status === 'Active') {
        return api({ action: 'activateExam', password: App.password, examId: data.examId })
          .then(function (actData) {
            if (!actData.success) { alert('Exam saved but could not activate: ' + actData.error); return; }
            showToast('Exam activated! Link: ' + actData.examLink);
            showExamLinkBanner(actData.examLink);
          });
      } else {
        showToast('Exam saved as draft!');
      }

      loadExamsTab();
    })
    .catch(function () { alert('Could not save exam. Please try again.'); })
    .finally(function () {
      setButtonLoading('save-draft-btn', false);
      setButtonLoading('save-activate-btn', false);
    });
}

function getAntiCheatSettings() {
  return {
    enabled:      document.getElementById('anti-cheat-toggle').checked,
    fullscreen:   document.getElementById('ac-fullscreen') && document.getElementById('ac-fullscreen').checked,
    tabDetection: document.getElementById('ac-tab') && document.getElementById('ac-tab').checked,
    autoSubmit:   document.getElementById('ac-autosubmit') && document.getElementById('ac-autosubmit').checked
  };
}

function getSelectedExamType() {
  var types = Array.from(document.querySelectorAll('input[name="qtype"]:checked')).map(function(c){ return c.value; });
  return types.length === 1 ? types[0] : 'Mixed';
}

function showExamLinkBanner(link) {
  var banner = document.getElementById('exam-link-banner');
  document.getElementById('exam-link-display').value = link;
  banner.classList.remove('hidden');
  banner.scrollIntoView({ behavior: 'smooth' });
}

// ─────────────────────────────────────────────────────────────
// TAB 2: MY EXAMS
// ─────────────────────────────────────────────────────────────
function loadExamsTab() {
  var container = document.getElementById('exams-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Loading exams…</div>';

  var subjectFilter = document.getElementById('filter-subject')?.value || '';
  var statusFilter  = document.getElementById('filter-status')?.value  || 'All';

  api({ action: 'getExams', password: App.password, subjectId: subjectFilter, status: statusFilter })
    .then(function (data) {
      if (!data.success) { container.innerHTML = '<p class="error">Could not load exams.</p>'; return; }
      renderExamCards(data.exams || []);
    })
    .catch(function () { container.innerHTML = '<p class="error">Connection error.</p>'; });
}

function renderExamCards(exams) {
  var container = document.getElementById('exams-list');
  if (!exams.length) { container.innerHTML = '<p class="empty-state">No exams found.</p>'; return; }

  container.innerHTML = '';
  exams.forEach(function (exam) {
    var card = document.createElement('div');
    card.className = 'exam-card';
    card.innerHTML = [
      '<div class="exam-card-header">',
      '  <span class="exam-card-title">' + escHtml(exam['Exam Title']) + '</span>',
      '  <span class="status-badge status-' + exam['Status'].toLowerCase() + '">' + exam['Status'] + '</span>',
      '</div>',
      '<div class="exam-card-meta">',
      '  <span>📅 Open: '  + (exam['Open DateTime']  || 'Not set') + '</span>',
      '  <span>📅 Close: ' + (exam['Close DateTime'] || 'Not set') + '</span>',
      '  <span>📝 ' + exam['Question Count'] + ' questions</span>',
      '  <span>👥 ' + (exam.submissionCount || 0) + ' submissions</span>',
      exam.violationCount ? '  <span class="violation-badge">⚠️ ' + exam.violationCount + ' violations</span>' : '',
      '</div>',
      '<div class="exam-card-actions">',
      '  <button class="btn btn-sm" onclick="viewExamDetails(\'' + exam['Exam ID'] + '\')">View Details</button>',
      exam['Status'] === 'Draft' ? '  <button class="btn btn-sm btn-success" onclick="activateExam(\'' + exam['Exam ID'] + '\')">Activate</button>' : '',
      exam['Status'] === 'Active' ? '  <button class="btn btn-sm btn-danger" onclick="closeExamAction(\'' + exam['Exam ID'] + '\')">Close Exam</button>' : '',
      '  <button class="btn btn-sm" onclick="copyExamLink(\'' + escHtml(exam['Exam Link']) + '\')">📋 Copy Link</button>',
      exam['Master Doc Link'] ? '  <a class="btn btn-sm" href="' + escHtml(exam['Master Doc Link']) + '" target="_blank">📄 Master Doc</a>' : '',
      '  <button class="btn btn-sm btn-danger" onclick="deleteExamAction(\'' + exam['Exam ID'] + '\')">🗑 Delete</button>',
      '</div>',
    ].join('\n');
    container.appendChild(card);
  });
}

function activateExam(examId) {
  if (!confirm('Activate this exam? Students will be able to access it.')) return;
  api({ action: 'activateExam', password: App.password, examId })
    .then(function (data) {
      if (!data.success) { alert('Error: ' + data.error); return; }
      showToast('Exam activated! Link: ' + data.examLink);
      loadExamsTab();
    });
}

function closeExamAction(examId) {
  if (!confirm('Close this exam? Students will no longer be able to access it.')) return;
  api({ action: 'closeExam', password: App.password, examId })
    .then(function (data) {
      if (!data.success) { alert('Error: ' + data.error); return; }
      showToast('Exam closed.');
      loadExamsTab();
    });
}

function deleteExamAction(examId) {
  if (!confirm('Delete this exam and ALL its student data? This cannot be undone.')) return;
  api({ action: 'deleteExam', password: App.password, examId })
    .then(function (data) {
      if (!data.success) { alert('Error: ' + data.error); return; }
      showToast('Exam deleted.');
      loadExamsTab();
    });
}

function copyExamLink(link) {
  navigator.clipboard.writeText(link).then(function () { showToast('Link copied to clipboard!'); });
}

function viewExamDetails(examId) {
  api({ action: 'getExamDetails', password: App.password, examId })
    .then(function (data) {
      if (!data.success) { alert('Error: ' + data.error); return; }
      showExamDetailsModal(data.exam, data.questions);
    });
}

function showExamDetailsModal(exam, questions) {
  var modal = document.getElementById('exam-detail-modal');
  document.getElementById('exam-detail-title').textContent = exam['Exam Title'];
  document.getElementById('exam-detail-link').href        = exam['Exam Link'];
  document.getElementById('exam-detail-link').textContent = exam['Exam Link'];
  document.getElementById('exam-detail-questions').textContent = questions.length + ' questions';
  document.getElementById('exam-detail-status').textContent   = exam['Status'];
  modal.classList.remove('hidden');
  document.getElementById('close-detail-modal').onclick = function () { modal.classList.add('hidden'); };
}

// ─────────────────────────────────────────────────────────────
// TAB 3: GRADEBOOK
// ─────────────────────────────────────────────────────────────
function initGradebookTab() {
  var sel = document.getElementById('gradebook-subject-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Select Subject --</option>';
  App.subjects.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value       = s['Subject ID'];
    opt.textContent = s['Subject Name'] + ' (' + s['Subject Code'] + ')';
    sel.appendChild(opt);
  });
  sel.onchange = function () { loadGradebook(sel.value); };
}

function loadGradebook(subjectId) {
  if (!subjectId) return;
  document.getElementById('gradebook-content').innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Loading gradebook…</div>';

  api({ action: 'getGradebook', password: App.password, subjectId })
    .then(function (data) {
      if (!data.success) { document.getElementById('gradebook-content').innerHTML = '<p class="error">Could not load gradebook.</p>'; return; }
      renderGradebook(data.grouped, data.summary);
    });
}

function renderGradebook(grouped, summary) {
  var container = document.getElementById('gradebook-content');
  container.innerHTML = '';

  Object.keys(grouped).forEach(function (examId) {
    var group   = grouped[examId];
    var exam    = group.exam;
    var students = group.students;
    var stats    = summary[examId] || {};

    var section = document.createElement('div');
    section.className = 'gradebook-section';

    var header = document.createElement('div');
    header.className = 'gradebook-exam-header';
    header.innerHTML = [
      '<strong>' + escHtml(exam['Exam Title']) + '</strong>',
      '<span class="status-badge status-' + exam['Status'].toLowerCase() + '">' + exam['Status'] + '</span>',
      '<span>Avg: ' + (stats.average || 0) + '% | High: ' + (stats.highest || 0) + '% | Low: ' + (stats.lowest || 0) + '%</span>',
      '<button class="btn btn-sm" onclick="exportGradebook(\'' + examId + '\')">📥 Export CSV</button>'
    ].join(' ');
    section.appendChild(header);

    if (!students.length) {
      section.innerHTML += '<p class="empty-state">No submissions yet.</p>';
    } else {
      var table = document.createElement('table');
      table.className = 'gradebook-table';
      table.innerHTML = [
        '<thead><tr>',
        '<th>Name</th><th>Short Code</th><th>Score</th><th>Total</th><th>%</th><th>Date Taken</th><th>Status</th><th>Actions</th>',
        '</tr></thead>'
      ].join('');
      var tbody = document.createElement('tbody');
      students.forEach(function (s) {
        var row = document.createElement('tr');
        if (s.violationFlag && s.violationFlag !== 'NONE') row.classList.add('flagged-row');
        row.innerHTML = [
          '<td>' + escHtml(s.firstName) + ' ' + escHtml(s.lastName) + '</td>',
          '<td>' + escHtml(s.shortCode) + '</td>',
          '<td>' + s.score + '</td>',
          '<td>' + s.totalPoints + '</td>',
          '<td>' + Number(s.percentage).toFixed(2) + '%</td>',
          '<td>' + escHtml(s.dateTaken) + '</td>',
          '<td>' + (s.violationFlag !== 'NONE' ? '⚠️ ' + s.violationFlag : '✅ Clean') + (s.hasUngraded ? ' 📝 Needs Grading' : '') + '</td>',
          '<td><button class="btn btn-sm" onclick="viewStudentAnswers(\'' + s.studentId + '\')">View Answers</button></td>'
        ].join('');
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      section.appendChild(table);
    }

    container.appendChild(section);
  });

  if (!Object.keys(grouped).length) {
    container.innerHTML = '<p class="empty-state">No exams found for this subject.</p>';
  }
}

function viewStudentAnswers(studentId) {
  api({ action: 'getStudentAnswers', password: App.password, studentId })
    .then(function (data) {
      if (!data.success) { alert('Error: ' + data.error); return; }
      showAnswerModal(data.student);
    });
}

function showAnswerModal(student) {
  var modal = document.getElementById('answer-modal');
  document.getElementById('answer-modal-name').textContent = student.firstName + ' ' + student.lastName + ' — Short Code: ' + student.shortCode;
  document.getElementById('answer-modal-score').textContent = student.score + ' / ' + student.totalPoints + ' (' + Number(student.percentage).toFixed(2) + '%)';

  var list = document.getElementById('answer-list');
  list.innerHTML = '';
  (student.answers || []).forEach(function (a, idx) {
    var item = document.createElement('div');
    item.className = 'answer-item' + (a.pointsEarned === a.totalPoints ? ' correct' : ' incorrect');
    item.innerHTML = [
      '<div class="answer-q-text"><strong>Q' + (idx+1) + ':</strong> ' + escHtml(a.questionText) + '</div>',
      '<div>Student answered: <em>' + escHtml(JSON.stringify(a.submitted)) + '</em></div>',
      a.needsGrading ? '' : '<div>Correct answer: <em>' + escHtml(JSON.stringify(a.answerKey)) + '</em></div>',
      '<div>Points: ' + a.pointsEarned + ' / ' + a.totalPoints + '</div>',
      a.needsGrading ? [
        '<div class="manual-grade">',
        '  <label>Manual Grade (out of ' + a.totalPoints + '): </label>',
        '  <input type="number" class="manual-pts-input" min="0" max="' + a.totalPoints + '" value="0" data-sid="' + student.studentId + '" data-qid="' + a.questionId + '">',
        '  <button class="btn btn-sm" onclick="saveManualGrade(this)">Save Grade</button>',
        '</div>'
      ].join('') : ''
    ].join('');
    list.appendChild(item);
  });

  modal.classList.remove('hidden');
  document.getElementById('close-answer-modal').onclick = function () { modal.classList.add('hidden'); };
}

function saveManualGrade(btn) {
  var row  = btn.closest('.manual-grade');
  var inp  = row.querySelector('.manual-pts-input');
  var sid  = inp.dataset.sid;
  var qid  = inp.dataset.qid;
  var pts  = parseFloat(inp.value) || 0;

  api({ action: 'updateManualGrade', password: App.password, studentId: sid, questionId: qid, pointsEarned: pts })
    .then(function (data) {
      if (!data.success) { alert('Error: ' + data.error); return; }
      showToast('Grade saved! New score: ' + data.newScore + ' (' + data.percentage + '%)');
      btn.textContent = '✅ Saved';
      btn.disabled = true;
    });
}

function exportGradebook(examId) {
  api({ action: 'exportGradebook', password: App.password, examId })
    .then(function (data) {
      if (!data.success) { alert('Export failed: ' + data.error); return; }
      var blob = new Blob([data.csv], { type: 'text/csv' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = 'gradebook_' + examId + '.csv'; a.click();
      URL.revokeObjectURL(url);
    });
}

// ─────────────────────────────────────────────────────────────
// TAB 4: SETTINGS
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  var testEmailBtn = document.getElementById('test-email-btn');
  if (testEmailBtn) {
    testEmailBtn.addEventListener('click', function () {
      api({ action: 'verifyPassword', password: App.password })
        .then(function (data) {
          if (data.success) showToast('Connection OK! Apps Script is responding.');
          else showToast('Error: ' + data.error);
        })
        .catch(function () { showToast('Connection failed. Check your Apps Script URL.'); });
    });
  }
});

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function api(body) {
  var url = window.APPS_SCRIPT_URL;
  if (!url || url === 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE') {
    return Promise.reject(new Error('Apps Script URL not configured. Open js/instructor.js and set APPS_SCRIPT_URL.'));
  }
  // text/plain avoids the CORS preflight that Apps Script cannot handle
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  }).then(function (r) { return r.json(); });
}

function showToast(msg) {
  var toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(function () { toast.classList.add('hidden'); }, 4000);
}

function showStep3Status(html) {
  var el = document.getElementById('parse-status');
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function setButtonLoading(id, loading) {
  var btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) btn.dataset.originalText = btn.textContent;
  btn.textContent = loading ? 'Please wait…' : (btn.dataset.originalText || btn.textContent);
}

function normalizeQuestions(questions) {
  return (questions || []).map(function (q, idx) {
    return {
      questionNumber: idx + 1,
      text:           q.text || '',
      type:           q.type || 'multiple_choice',
      options:        q.options || [],
      answerKey:      q.answerKey !== undefined ? q.answerKey : '',
      bloomLevel:     q.bloomLevel || '',
      points:         Number(q.points) || 1
    };
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', function () {
  // Timer toggles
  var wholeToggle = document.getElementById('whole-timer-toggle');
  var perqToggle  = document.getElementById('perq-timer-toggle');
  if (wholeToggle) wholeToggle.addEventListener('change', function () {
    document.getElementById('whole-timer-mins').closest('.timer-sub').classList.toggle('hidden', !this.checked);
  });
  if (perqToggle) perqToggle.addEventListener('change', function () {
    document.getElementById('perq-timer-secs').closest('.timer-sub').classList.toggle('hidden', !this.checked);
    // Per-question timer requires no back navigation
    var backToggle = document.getElementById('back-nav-toggle');
    if (backToggle) {
      if (this.checked) {
        backToggle.checked  = false;
        backToggle.disabled = true;
        backToggle.closest('.toggle-wrapper').title = 'Disabled — back navigation is not allowed when per-question timer is active.';
      } else {
        backToggle.disabled = false;
        backToggle.closest('.toggle-wrapper').title = '';
      }
    }
  });

  // Anti-cheat toggle
  var acToggle = document.getElementById('anti-cheat-toggle');
  if (acToggle) acToggle.addEventListener('change', function () {
    document.getElementById('anti-cheat-options').classList.toggle('hidden', !this.checked);
  });

  // Bloom's mode toggle
  document.querySelectorAll('input[name="bloom-mode"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      var show = this.value !== 'General';
      document.getElementById('bloom-levels-section').classList.toggle('hidden', !show);
    });
  });

  // Exam link copy button
  var copyLinkBtn = document.getElementById('copy-link-btn');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', function () {
      var inp = document.getElementById('exam-link-display');
      inp.select();
      navigator.clipboard.writeText(inp.value).then(function () { showToast('Exam link copied!'); });
    });
  }

  // Exam filter controls
  var filterSubject = document.getElementById('filter-subject');
  var filterStatus  = document.getElementById('filter-status');
  if (filterSubject) filterSubject.addEventListener('change', loadExamsTab);
  if (filterStatus)  filterStatus.addEventListener('change',  loadExamsTab);
});
