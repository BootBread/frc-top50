// Character pop-ups: a round portrait in the bottom-right corner, a name pill on top of it and a speech
// box reaching left along the bottom of the screen. Lines queue up and play one at a time. The game never
// pauses and the player keeps full control. Each player's game plays the same lines because they are
// triggered by events every game sees (objectives done, the level starting or finishing).
export function createPopups(chars, tune) {
  const root = document.createElement("div");
  root.id = "talk";
  root.innerHTML = `<div class="box"><div class="txt"></div><div class="skip"></div></div><div class="face"><canvas width="128" height="128"></canvas><div class="name"></div></div>`;
  document.body.appendChild(root);
  const elTxt = root.querySelector(".txt"), elName = root.querySelector(".name"), cv = root.querySelector("canvas"), elSkip = root.querySelector(".skip");
  const queue = [];
  let cur = null, shown = 0, t = 0, hold = 0, ac = null, blipAt = 0;

  function blip(freq) {
    try {
      ac = ac || new AudioContext();
      if (ac.state === "suspended") ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), now = ac.currentTime;
      o.type = "square"; o.frequency.value = freq * (0.92 + Math.random() * 0.16);
      g.gain.setValueAtTime(0.035, now); g.gain.exponentialRampToValueAtTime(0.0005, now + 0.06);
      o.connect(g).connect(ac.destination); o.start(now); o.stop(now + 0.07);
    } catch {}
  }
  function next() {
    cur = queue.shift() || null;
    shown = 0; t = 0; hold = 0; blipAt = 0;
    if (!cur) { root.classList.remove("on"); document.body.classList.remove("talking"); return; }
    const c = chars[cur.id];
    elName.textContent = c.name; elName.style.background = c.color;
    drawFace(cv, c);
    elTxt.textContent = "";
    root.classList.add("on"); document.body.classList.add("talking");
  }
  return {
    // say("dot", "text") queues one line; say([["dot", "a"], ["walt", "b"]]) queues several
    say(id, text) {
      if (Array.isArray(id)) { for (const [w, s] of id) this.say(w, s); return; }
      if (chars[id] && text) queue.push({ id, text });
    },
    // Skip: finish typing the line, or move on to the next one. Returns false when nothing is showing.
    skip() {
      if (!cur) return false;
      if (shown < cur.text.length) { shown = cur.text.length; elTxt.textContent = cur.text; } else next();
      return true;
    },
    clear() { queue.length = 0; if (cur) next(); },
    setSkipLabel(html) { elSkip.innerHTML = html; },
    get showing() { return !!cur; },
    update(dt) {
      if (!cur) { if (queue.length) next(); return; }
      t += dt;
      if (shown < cur.text.length) {
        const n = Math.min(cur.text.length, Math.floor(t * tune.charsPerSecond));
        if (n > shown) {
          shown = n; elTxt.textContent = cur.text.slice(0, n);
          if (n - blipAt >= 4 && cur.text[n - 1] !== " ") { blipAt = n; blip(chars[cur.id].blip); }
        }
        return;
      }
      hold += dt;
      if (hold > Math.max(tune.minHold, cur.text.length * tune.holdPerChar)) next();
    },
  };
}

// A simple drawn face per character, from a handful of options (see data/characters.js).
export function drawFace(cv, c) {
  const g = cv.getContext("2d"), f = c.face, S = cv.width / 128;
  g.setTransform(S, 0, 0, S, 0, 0);
  g.clearRect(0, 0, 128, 128);
  g.save();
  g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.clip();
  g.fillStyle = f.bg || "#33404d"; g.fillRect(0, 0, 128, 128);
  const ell = (x, y, rx, ry, col, a0 = 0, a1 = Math.PI * 2) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, a0, a1); g.fill(); };
  ell(64, 138, 50, 38, f.shirt || "#5b7fa6");                                  // shoulders
  g.fillStyle = f.skin; g.fillRect(55, 86, 18, 18);                            // neck
  if (f.hair === "long") ell(64, 74, 38, 42, f.hairColor);
  if (f.hair === "bun") ell(64, 24, 15, 13, f.hairColor);
  ell(36, 66, 6, 8, f.skin); ell(92, 66, 6, 8, f.skin);                       // ears
  ell(64, 62, 29, 34, f.skin);                                                 // head
  if (f.beard) ell(64, 80, 25, 18, f.hairColor, 0, Math.PI);
  if (["short", "long", "bun", "slick"].includes(f.hair)) {
    g.fillStyle = f.hairColor; g.beginPath();
    g.ellipse(64, f.hair === "slick" ? 50 : 52, 31, f.hair === "slick" ? 24 : 27, 0, Math.PI, Math.PI * 2);
    g.fill();
  }
  if (f.hair === "grey-sides") { ell(37, 56, 6, 12, f.hairColor); ell(91, 56, 6, 12, f.hairColor); }
  // eyes, glasses, mouth
  g.fillStyle = "#1d232b";
  if (f.glasses === "shades") {
    g.beginPath(); g.roundRect(41, 54, 20, 12, 4); g.roundRect(67, 54, 20, 12, 4); g.fill();
    g.fillRect(60, 57, 8, 3);
  } else {
    ell(53, 61, 3.2, 3.6, "#1d232b"); ell(75, 61, 3.2, 3.6, "#1d232b");
    if (f.glasses === "round") { g.strokeStyle = "#2b2f36"; g.lineWidth = 2.4; g.beginPath(); g.arc(53, 61, 8.5, 0, Math.PI * 2); g.moveTo(83.5, 61); g.arc(75, 61, 8.5, 0, Math.PI * 2); g.moveTo(61.5, 61); g.lineTo(66.5, 61); g.stroke(); }
  }
  if (f.moustache) ell(64, 77, 12, 4.5, f.hairColor);
  g.strokeStyle = "#5a2e24"; g.lineWidth = 2.6; g.beginPath();
  if (f.mouth === "flat") { g.moveTo(56, 82); g.lineTo(72, 82); } else g.arc(64, 74, 10, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  ell(46, 72, 5, 3, "rgba(230,110,110,.35)"); ell(82, 72, 5, 3, "rgba(230,110,110,.35)");   // cheeks
  // hats
  const hc = f.hatColor || "#c94a3a";
  if (f.hat === "cap") { ell(64, 40, 31, 20, hc, Math.PI, Math.PI * 2); g.fillStyle = hc; g.fillRect(33, 38, 62, 5); ell(82, 42, 22, 5, hc); }
  if (f.hat === "hardhat") { ell(64, 42, 33, 26, hc, Math.PI, Math.PI * 2); ell(64, 42, 40, 6, hc); g.fillStyle = "rgba(0,0,0,.15)"; g.fillRect(61, 17, 6, 25); }
  if (f.hat === "ranger" || f.hat === "cowboy") {
    ell(64, 38, 48, f.hat === "cowboy" ? 9 : 7, hc);
    g.fillStyle = hc; g.beginPath(); g.moveTo(42, 38); g.lineTo(47, 14); g.lineTo(f.hat === "cowboy" ? 64 : 81, f.hat === "cowboy" ? 20 : 14); if (f.hat === "cowboy") g.lineTo(81, 14); g.lineTo(86, 38); g.fill();
    g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(44, 31, 40, 5);
  }
  g.restore();
}
