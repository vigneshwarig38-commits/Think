// ---------------- Settings ----------------
const GAME_TIME = 60;    // seconds per game
const ROUND_TIME = 6;    // seconds allowed per pose
const HOLD_TIME = 0.6;   // seconds the pose must be held

// Finger pattern: [thumb, index, middle, ring, pinky], 1 = extended
const POSES = {
  "FIST":       [0, 0, 0, 0, 0],
  "ONE":        [0, 1, 0, 0, 0],
  "PEACE":      [0, 1, 1, 0, 0],
  "THREE":      [0, 1, 1, 1, 0],
  "FOUR":       [0, 1, 1, 1, 1],
  "FIVE":       [1, 1, 1, 1, 1],
  "THUMBS UP":  [1, 0, 0, 0, 0],
  "ROCK ON":    [0, 1, 0, 0, 1],
  "CALL ME":    [1, 0, 0, 0, 1],
  "I LOVE YOU": [1, 1, 0, 0, 1],
};
const POSE_NAMES = Object.keys(POSES);
const PATTERN_TO_NAME = {};
POSE_NAMES.forEach(name => (PATTERN_TO_NAME[POSES[name].join("")] = name));

// ---------------- Page elements ----------------
const $ = id => document.getElementById(id);
const video = $("video");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

// ---------------- Game state ----------------
let playing = false;
let score = 0, streak = 0;
let best = Number(localStorage.getItem("poseBest") || 0);
let target = null;
let gameStart = 0, targetStart = 0, holdStart = null;
let history = [];            // last few finger patterns (for stable detection)
let detected = null;         // name of the pose currently seen
let messageTimer = null;

$("best").textContent = best;

// ---------------- Hand analysis ----------------
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function fingerPattern(lm) {
  const wrist = lm[0];
  // thumb: tip is farther from the pinky base than the thumb joint
  const thumb = dist(lm[4], lm[17]) > dist(lm[3], lm[17]) * 1.1 ? 1 : 0;
  const result = [thumb];
  // [tip, pip] for index, middle, ring, pinky
  [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip]) => {
    result.push(dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.05 ? 1 : 0);
  });
  return result.join("");
}

// most common value in an array
function majority(arr) {
  const counts = {};
  arr.forEach(v => (counts[v] = (counts[v] || 0) + 1));
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}

// ---------------- MediaPipe setup ----------------
const hands = new Hands({
  locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.6,
});
hands.onResults(onResults);

function onResults(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.multiHandLandmarks && results.multiHandLandmarks.length) {
    const lm = results.multiHandLandmarks[0];
    drawConnectors(ctx, lm, HAND_CONNECTIONS, { color: "#00dcff", lineWidth: 3 });
    drawLandmarks(ctx, lm, { color: "#ff4d6d", radius: 3 });

    history.push(fingerPattern(lm));
    if (history.length > 6) history.shift();
    const stable = majority(history);
    detected = PATTERN_TO_NAME[stable] || null;
    $("you").textContent = "You: " + (detected || "Unknown sign");
  } else {
    history = [];
    detected = null;
    $("you").textContent = "You: No hand";
  }

  if (playing) checkMatch();
}

// start the camera
const camera = new Camera(video, {
  onFrame: async () => { await hands.send({ image: video }); },
  width: 640,
  height: 480,
});

// ---------------- Game logic ----------------
function newTarget() {
  const choices = POSE_NAMES.filter(n => n !== target);
  target = choices[Math.floor(Math.random() * choices.length)];
  targetStart = performance.now();
  holdStart = null;
  history = [];
  showTarget();
}

function showTarget() {
  $("targetName").textContent = target;
  const box = $("fingers");
  box.innerHTML = "";
  POSES[target].forEach((up, i) => {
    const d = document.createElement("div");
    d.className = (up ? "up" : "down") + (i === 0 ? " thumb" : "");
    box.appendChild(d);
  });
}

function checkMatch() {
  const now = performance.now();
  if (detected === target) {
    if (holdStart === null) holdStart = now;
    if ((now - holdStart) / 1000 >= HOLD_TIME) {
      const roundLeft = Math.max(ROUND_TIME - (now - targetStart) / 1000, 0);
      const gained = 10 + Math.floor(roundLeft * 2) + streak * 2;
      score += gained;
      streak++;
      showMessage(`+${gained} ${streak >= 3 ? "PERFECT!" : "Nice!"}`, "#50dc78");
      updateHud();
      newTarget();
    }
  } else {
    holdStart = null;
  }
}

// runs every 100 ms: timers and progress bars
function tick() {
  if (!playing) return;
  const now = performance.now();
  const remaining = GAME_TIME - (now - gameStart) / 1000;
  const roundLeft = ROUND_TIME - (now - targetStart) / 1000;

  if (remaining <= 0) return endGame();

  if (roundLeft <= 0) {
    streak = 0;
    showMessage("Too slow!", "#ff5a5a");
    newTarget();
  }

  $("time").textContent = Math.ceil(remaining);
  $("roundBar").style.width = Math.max(roundLeft / ROUND_TIME, 0) * 100 + "%";
  $("holdBar").style.width =
    holdStart ? Math.min((now - holdStart) / 1000 / HOLD_TIME, 1) * 100 + "%" : "0%";
  updateHud();
}

function updateHud() {
  $("score").textContent = score;
  $("streak").textContent = streak;
}

function showMessage(text, color) {
  const m = $("message");
  m.textContent = text;
  m.style.color = color;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => (m.textContent = ""), 900);
}

function startGame() {
  score = 0;
  streak = 0;
  target = null;
  updateHud();
  $("overlay").classList.add("hidden");
  gameStart = performance.now();
  playing = true;
  newTarget();
}

function endGame() {
  playing = false;
  let text = `Score: ${score}`;
  if (score > best) {
    best = score;
    localStorage.setItem("poseBest", best);
    text += "<br />🏆 NEW HIGH SCORE!";
  } else {
    text += `<br />High score: ${best}`;
  }
  $("best").textContent = best;
  $("time").textContent = 0;
  $("overlayTitle").textContent = "Time's up!";
  $("overlayText").innerHTML = text;
  $("startBtn").textContent = "Play Again";
  $("overlay").classList.remove("hidden");
}

// ---------------- Buttons ----------------
let cameraStarted = false;
$("startBtn").addEventListener("click", async () => {
  if (!cameraStarted) {
    $("startBtn").disabled = true;
    $("startBtn").textContent = "Starting camera...";
    try {
      await camera.start();
      cameraStarted = true;
    } catch (e) {
      $("overlayText").textContent = "Could not open the camera. Please allow camera access and reload.";
      $("startBtn").textContent = "Try Again";
      $("startBtn").disabled = false;
      return;
    }
    $("startBtn").disabled = false;
  }
  startGame();
});

setInterval(tick, 100);