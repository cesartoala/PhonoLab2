// PhonoLab — App Logic
// Browser-only, Web Speech API, localStorage

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  view: "home",            // home | lesson | results | teacher
  lessonId: null,
  wordIndex: 0,
  attempts: [],            // { lesson, word, spoken, score, timestamp }
  isRecording: false,
  isPlaying: false,
  currentScore: null,
  recognition: null,
  synth: window.speechSynthesis,
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const views = {
  home:    document.getElementById("view-home"),
  lesson:  document.getElementById("view-lesson"),
  results: document.getElementById("view-results"),
  teacher: document.getElementById("view-teacher"),
};

// ─── Router ───────────────────────────────────────────────────────────────────

function showView(name) {
  state.view = name;
  Object.values(views).forEach(v => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
  window.scrollTo(0, 0);
}

// ─── localStorage ────────────────────────────────────────────────────────────

function loadAttempts() {
  try {
    return JSON.parse(localStorage.getItem("phonolab_attempts") || "[]");
  } catch { return []; }
}

function saveAttempt(attempt) {
  const all = loadAttempts();
  all.push(attempt);
  localStorage.setItem("phonolab_attempts", JSON.stringify(all));
}

function clearAttempts() {
  localStorage.removeItem("phonolab_attempts");
}

// ─── Home View ────────────────────────────────────────────────────────────────

function renderHome() {
  const grid = document.getElementById("lesson-grid");
  const attempts = loadAttempts();

  grid.innerHTML = LESSONS.map(lesson => {
    const lessonAttempts = attempts.filter(a => a.lesson === lesson.id);
    const done = lessonAttempts.length;
    const avg = done
      ? Math.round(lessonAttempts.reduce((s, a) => s + a.score, 0) / done)
      : null;
    const wordsCompleted = new Set(lessonAttempts.map(a => a.word)).size;
    const complete = wordsCompleted >= lesson.words.length;

    return `
      <button class="lesson-card ${complete ? 'complete' : ''}" onclick="startLesson('${lesson.id}')">
        <span class="lesson-level">Level ${lesson.level}</span>
        <span class="lesson-phoneme">${lesson.phoneme}</span>
        <span class="lesson-title">${lesson.title}</span>
        <span class="lesson-desc">${lesson.description}</span>
        ${avg !== null
          ? `<span class="lesson-stat">${complete ? '✓ ' : ''}Avg score: ${avg}</span>`
          : `<span class="lesson-stat">Not started</span>`}
      </button>`;
  }).join("");

  showView("home");
}

// ─── Lesson View ──────────────────────────────────────────────────────────────

function startLesson(lessonId) {
  state.lessonId = lessonId;
  state.wordIndex = 0;
  state.attempts = [];
  state.currentScore = null;
  renderWord();
  showView("lesson");
}

function currentLesson() {
  return LESSONS.find(l => l.id === state.lessonId);
}

function currentWord() {
  const lesson = currentLesson();
  return lesson ? lesson.words[state.wordIndex] : null;
}

function renderWord() {
  const lesson = currentLesson();
  const wordObj = currentWord();
  if (!lesson || !wordObj) return;

  const total = lesson.words.length;
  const idx = state.wordIndex;

  document.getElementById("lesson-title-bar").textContent = lesson.title;
  document.getElementById("progress-text").textContent = `Word ${idx + 1} of ${total}`;
  document.getElementById("progress-fill").style.width = `${((idx) / total) * 100}%`;
  document.getElementById("target-word").textContent = wordObj.word;
  document.getElementById("target-translation").textContent = wordObj.translation;
  document.getElementById("phoneme-hint").textContent = lesson.phoneme;
  document.getElementById("word-hint").textContent = wordObj.hint;

  // Reset visualizer
  stopViz();

  // Reset feedback area
  document.getElementById("feedback-area").classList.add("hidden");
  document.getElementById("spoken-text").textContent = "";
  document.getElementById("score-display").textContent = "";
  document.getElementById("btn-next").classList.add("hidden");
  document.getElementById("btn-retry").classList.add("hidden");

  setRecordBtn("idle");
}

// ─── Speech Synthesis (model pronunciation) ──────────────────────────────────

function speakWord() {
  if (state.isPlaying) return;
  const wordObj = currentWord();
  if (!wordObj) return;

  const utter = new SpeechSynthesisUtterance(wordObj.word);
  utter.lang = "es-ES";
  utter.rate = 0.8;
  utter.pitch = 1;

  // Try to find a Spanish voice
  const voices = state.synth.getVoices();
  const spanishVoice = voices.find(v => v.lang.startsWith("es"));
  if (spanishVoice) utter.voice = spanishVoice;

  state.isPlaying = true;
  const btn = document.getElementById("btn-listen");
  btn.textContent = "🔊 Playing…";
  btn.disabled = true;

  // Start visualizer
  stopViz();
  const vizHandles = vizSpeech();

  utter.onend = () => {
    state.isPlaying = false;
    btn.textContent = "🔊 Hear it";
    btn.disabled = false;
    try { vizHandles.osc.stop(); } catch(e) {}
    stopViz();
  };

  state.synth.speak(utter);
}

// ─── Speech Recognition ───────────────────────────────────────────────────────

function setRecordBtn(mode) {
  const btn = document.getElementById("btn-record");
  if (mode === "idle") {
    btn.textContent = "🎤 Record";
    btn.classList.remove("recording");
    btn.disabled = false;
  } else if (mode === "recording") {
    btn.textContent = "⏹ Stop";
    btn.classList.add("recording");
    btn.disabled = false;
  } else if (mode === "processing") {
    btn.textContent = "⏳ Listening…";
    btn.classList.remove("recording");
    btn.disabled = true;
  }
}

function startRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError("Your browser doesn't support speech recognition. Try Chrome.");
    return;
  }

  if (state.isRecording && state.recognition) {
    state.recognition.stop();
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "es-ES";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  state.recognition = recognition;
  state.isRecording = true;

  setRecordBtn("recording");

  // Start mic visualizer
  stopViz();
  vizMic();

  recognition.onresult = (event) => {
    const spoken = event.results[0][0].transcript.toLowerCase().trim();
    handleResult(spoken);
  };

  recognition.onerror = (event) => {
    state.isRecording = false;
    setRecordBtn("idle");
    if (event.error === "no-speech") {
      showFeedback("", 0, "No speech detected. Try again.");
    } else if (event.error === "not-allowed") {
      showError("Microphone access was denied. Please allow it in your browser settings.");
    }
  };

  recognition.onend = () => {
    state.isRecording = false;
    stopViz();
    if (state.currentScore === null) {
      setRecordBtn("idle");
    }
  };

  recognition.start();
}

function handleResult(spoken) {
  const wordObj = currentWord();
  const target = wordObj.word.toLowerCase();

  // Scoring: simple inclusion check (MVP)
  const score = spoken.includes(target) ? 100 : 40;

  state.currentScore = score;
  setRecordBtn("processing");

  const attempt = {
    lesson: state.lessonId,
    word: wordObj.word,
    spoken: spoken,
    score: score,
    timestamp: new Date().toISOString(),
  };
  state.attempts.push(attempt);
  saveAttempt(attempt);

  showFeedback(spoken, score);
}

function showFeedback(spoken, score, message) {
  const area = document.getElementById("feedback-area");
  area.classList.remove("hidden");

  document.getElementById("spoken-text").textContent = spoken
    ? `You said: "${spoken}"`
    : (message || "");

  const scoreEl = document.getElementById("score-display");
  if (score === 100) {
    scoreEl.textContent = "✓ Great!";
    scoreEl.className = "score-display score-great";
  } else if (score >= 40 && spoken) {
    scoreEl.textContent = `Score: ${score} — Keep practicing!`;
    scoreEl.className = "score-display score-ok";
  } else {
    scoreEl.textContent = message || "";
    scoreEl.className = "score-display";
  }

  document.getElementById("btn-retry").classList.remove("hidden");

  const lesson = currentLesson();
  const isLast = state.wordIndex >= lesson.words.length - 1;
  const nextBtn = document.getElementById("btn-next");
  nextBtn.classList.remove("hidden");
  nextBtn.textContent = isLast ? "Finish Lesson →" : "Next Word →";

  setRecordBtn("idle");
}

function retryWord() {
  state.currentScore = null;
  document.getElementById("feedback-area").classList.add("hidden");
  document.getElementById("btn-next").classList.add("hidden");
  document.getElementById("btn-retry").classList.add("hidden");
  setRecordBtn("idle");
}

function nextWord() {
  const lesson = currentLesson();
  if (state.wordIndex >= lesson.words.length - 1) {
    showResults();
  } else {
    state.wordIndex++;
    state.currentScore = null;
    renderWord();
  }
}

// ─── Results View ─────────────────────────────────────────────────────────────

function showResults() {
  const lesson = currentLesson();
  const attempts = state.attempts;

  // Per-word summary (last attempt per word)
  const wordSummary = lesson.words.map(w => {
    const wordAttempts = attempts.filter(a => a.word === w.word);
    const last = wordAttempts[wordAttempts.length - 1];
    return { word: w.word, translation: w.translation, score: last ? last.score : 0, tries: wordAttempts.length };
  });

  const avg = Math.round(wordSummary.reduce((s, w) => s + w.score, 0) / wordSummary.length);

  document.getElementById("results-lesson-title").textContent = lesson.title;
  document.getElementById("results-avg").textContent = `Average Score: ${avg}`;

  document.getElementById("results-list").innerHTML = wordSummary.map(w => `
    <div class="result-row ${w.score === 100 ? 'result-great' : 'result-ok'}">
      <span class="result-word">${w.word}</span>
      <span class="result-translation">${w.translation}</span>
      <span class="result-score">${w.score === 100 ? "✓" : w.score}</span>
      <span class="result-tries">${w.tries} try${w.tries !== 1 ? "s" : ""}</span>
    </div>`).join("");

  showView("results");
}

// ─── Teacher View ─────────────────────────────────────────────────────────────

function renderTeacher() {
  const attempts = loadAttempts();

  if (attempts.length === 0) {
    document.getElementById("teacher-summary").innerHTML =
      `<p class="empty-state">No practice data yet. Students need to complete lessons first.</p>`;
    document.getElementById("teacher-detail").innerHTML = "";
    showView("teacher");
    return;
  }

  // Summary stats
  const total = attempts.length;
  const avg = Math.round(attempts.reduce((s, a) => s + a.score, 0) / total);
  const perfect = attempts.filter(a => a.score === 100).length;
  const pct = Math.round((perfect / total) * 100);

  // Per-lesson breakdown
  const byLesson = {};
  attempts.forEach(a => {
    if (!byLesson[a.lesson]) byLesson[a.lesson] = [];
    byLesson[a.lesson].push(a);
  });

  document.getElementById("teacher-summary").innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><span class="stat-num">${total}</span><span class="stat-label">Total Attempts</span></div>
      <div class="stat-box"><span class="stat-num">${avg}</span><span class="stat-label">Average Score</span></div>
      <div class="stat-box"><span class="stat-num">${pct}%</span><span class="stat-label">Perfect Scores</span></div>
    </div>`;

  document.getElementById("teacher-detail").innerHTML = LESSONS.map(lesson => {
    const la = byLesson[lesson.id];
    if (!la) return "";
    const lavg = Math.round(la.reduce((s, a) => s + a.score, 0) / la.length);
    const words = [...new Set(la.map(a => a.word))];

    return `
      <div class="teacher-lesson-block">
        <h3>${lesson.title} <span class="tl-phoneme">${lesson.phoneme}</span></h3>
        <p>${la.length} attempts · Avg ${lavg} · Words practiced: ${words.join(", ")}</p>
        <div class="attempt-log">
          ${la.slice(-10).reverse().map(a => `
            <div class="attempt-row">
              <span class="at-word">${a.word}</span>
              <span class="at-spoken">"${a.spoken}"</span>
              <span class="at-score ${a.score === 100 ? 'score-great' : 'score-ok'}">${a.score}</span>
              <span class="at-time">${new Date(a.timestamp).toLocaleTimeString()}</span>
            </div>`).join("")}
        </div>
      </div>`;
  }).join("");

  showView("teacher");
}

function exportCSV() {
  const attempts = loadAttempts();
  if (!attempts.length) return;

  const header = "lesson,word,spoken,score,timestamp";
  const rows = attempts.map(a =>
    `${a.lesson},${a.word},"${a.spoken}",${a.score},${a.timestamp}`
  );
  const csv = [header, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phonolearn_data_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function confirmClear() {
  if (confirm("Clear all practice data? This cannot be undone.")) {
    clearAttempts();
    renderTeacher();
  }
}

// ─── Error ────────────────────────────────────────────────────────────────────

function showError(msg) {
  const el = document.getElementById("error-banner");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

// Load voices async
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

renderHome();

// ─── Visualizer ───────────────────────────────────────────────────────────────

function getAudioCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return state.audioCtx;
}

function stopViz() {
  if (state.vizAnimId) {
    cancelAnimationFrame(state.vizAnimId);
    state.vizAnimId = null;
  }
  if (state.micStream) {
    state.micStream.getTracks().forEach(t => t.stop());
    state.micStream = null;
  }
  state.analyser = null;
  // Clear canvas to idle state
  drawIdleCanvas();
}

function drawIdleCanvas() {
  const canvas = document.getElementById("waveform-canvas");
  if (!canvas) return;
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = 120 * window.devicePixelRatio;
  const ctx = canvas.getContext("2d");
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  const W = canvas.offsetWidth, H = 120;
  ctx.clearRect(0, 0, W, H);
  // Draw a flat baseline
  ctx.strokeStyle = "rgba(240,165,0,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
}

function startVizFromAnalyser(analyser, label) {
  state.analyser = analyser;
  const canvas = document.getElementById("waveform-canvas");
  const labelEl = document.getElementById("visualizer-label");
  if (labelEl) labelEl.textContent = label;

  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = 120 * window.devicePixelRatio;
  const ctx = canvas.getContext("2d");

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    state.vizAnimId = requestAnimationFrame(draw);

    const W = canvas.offsetWidth;
    const H = 120;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    analyser.getByteTimeDomainData(dataArray);

    // Background
    ctx.fillStyle = "#1a2744";
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H / 4) * i);
      ctx.lineTo(W, (H / 4) * i);
      ctx.stroke();
    }

    // Waveform — gold gradient
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0,   "#f0a500");
    gradient.addColorStop(0.5, "#e74c3c");
    gradient.addColorStop(1,   "#f0a500");

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = gradient;
    ctx.shadowColor = "#f0a500";
    ctx.shadowBlur = 8;
    ctx.beginPath();

    const sliceWidth = W / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * H) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  draw();
}

// Hook: visualize speech synthesis output
function vizSpeech() {
  const ctx = getAudioCtx();
  // Speech synthesis goes to system audio — we can only fake-animate it
  // using an oscillator as a proxy since browsers don't expose synth output
  const osc = ctx.createOscillator();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const gain = ctx.createGain();
  gain.gain.value = 0; // silent — just for animation feed
  osc.connect(gain);
  gain.connect(analyser);
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.3);
  osc.start();
  startVizFromAnalyser(analyser, "🔊 Model pronunciation");
  return { osc, analyser };
}

// Hook: visualize mic input
async function vizMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.micStream = stream;
    const ctx = getAudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    startVizFromAnalyser(analyser, "🎤 Your voice");
  } catch (e) {
    // Mic denied — visualizer stays idle
  }
}
