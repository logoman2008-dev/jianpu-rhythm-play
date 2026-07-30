// ===================================================================
// pitch.js — 麥克風即時音高偵測（掛在 window.Pitch）
// 用自相關法(autocorrelation)偵測單音基頻，供「吉他收音」輸入模式使用。
// 需要安全內容(https 或 localhost)才能取用麥克風；file:// 不支援。
// ===================================================================
(function () {
  "use strict";

  var ctx = null, analyser = null, source = null, stream = null;
  var buf = null, active = false;
  var rate = 44100;
  var floor = 0.004;   // 偵測噪音底線(可由遊戲靈敏度設定調整)
  var lastDevice = "";
  // ---- 虛擬音箱（把收音經模擬音色即時輸出當監聽）----
  var ampOn = false, ampDrive = 0.5, ampLevel = 0.6, bufferFrames = 0;   // bufferFrames=0→瀏覽器預設延遲；否則換算 latencyHint
  var ampNodes = null, ampConnected = false;
  var delayOn = false, delayTime = 0.28, delayFb = 0.3, delayMix = 0.35;   // 可調 delay 效果器
  // ---- Noise Gate（雜訊閘）----
  //   Web Audio 沒有現成的 gate node → 用 AnalyserNode 量 RMS ＋ GainNode 開關，
  //   每 8ms 更新一次，用 setTargetAtTime 平滑過渡（不會有喀噪聲）。
  var gateOn = false, gateThresh = 0.012, gateTimer = null, gateAnalyser = null, gateBuf = null;
  var gateOpen = false, gateHoldUntil = 0;
  var GATE_ATTACK = 0.003, GATE_RELEASE = 0.045, GATE_HOLD_MS = 60;   // 開很快、關留一點尾巴
  // ---- 綠推 Overdrive（中頻推進型破音踏板：三顆旋鈕 Overdrive / Tone / Level）----
  var odOn = false, odDrive = 0.5, odTone = 0.5, odLevel = 0.6;
  // ---- 英倫疊音 音色控制（英式 tone stack ＋ Presence）----
  var toneBass = 0.5, toneMid = 0.5, toneTreble = 0.6, tonePresence = 0.5;
  function clipCurve(limit) {                                 // 硬切天花板：任何輸入夾在 ±limit(絕對上限)
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = (i / (n - 1)) * 2 - 1; c[i] = Math.max(-limit, Math.min(limit, x)); }
    return c;
  }
  // 真空管式「不對稱」軟削波：正半波比負半波先壓縮，這是英式高增益那種帶奇偶次諧波的髒感來源
  function tubeCurve(k, asym) {
    var n = 8192, c = new Float32Array(n);
    asym = asym || 0;
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      var kk = k * (x >= 0 ? (1 + asym) : (1 - asym * 0.6));
      c[i] = Math.tanh(kk * x) / Math.tanh(kk);
    }
    return c;
  }
  // 破音踏板的二極體對稱軟削波（比電子管更「圓」、壓縮感更強）
  function diodeCurve(k) {
    var n = 8192, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1, a = Math.abs(x) * k;
      var y = (1 - Math.exp(-a)) / (1 - Math.exp(-k));
      c[i] = (x < 0 ? -y : y);
    }
    return c;
  }
  // 用 OfflineAudioContext 烘一顆「英式 4x12 直立箱」風格的音箱脈衝響應
  var cabIR = null;
  function buildCabIR() {
    try {
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC || !ctx) return;
      var sr = ctx.sampleRate, len = Math.max(256, Math.floor(sr * 0.050));
      var off = new OAC(1, len, sr);
      var imp = off.createBuffer(1, len, sr); imp.getChannelData(0)[0] = 1;
      var src = off.createBufferSource(); src.buffer = imp;
      function bq(type, f, Q, g) {
        var b = off.createBiquadFilter(); b.type = type; b.frequency.value = f;
        if (Q != null) b.Q.value = Q; if (g != null) b.gain.value = g; return b;
      }
      // 英式 4x12 的特徵：~100Hz 箱體共振、400Hz 微凹、1.6k~2.5k 明顯的「吼」、>5kHz 掉很快
      var chain = [
        bq("highpass", 80, 0.7),
        bq("peaking", 105, 1.2, 4.5),      // 箱體低頻共振
        bq("peaking", 400, 1.0, -4),       // 中低凹（去紙箱感）
        bq("peaking", 1000, 0.9, 1.5),
        bq("peaking", 2000, 1.6, 5.5),     // 英式喇叭的咬勁
        bq("notch", 6500, 1.0),            // 去刺
        bq("lowpass", 5200, 0.7),
        bq("lowpass", 4800, 0.6)           // 兩級→陡降（真喇叭 >5kHz 幾乎不出聲）
      ];
      var node = src;
      for (var i = 0; i < chain.length; i++) { node.connect(chain[i]); node = chain[i]; }
      node.connect(off.destination);
      src.start(0);
      off.startRendering().then(function (b) {
        var d = b.getChannelData(0), N = d.length;
        for (var j = 0; j < N; j++) { var w = 1 - j / N; d[j] *= w * w; }   // 尾端加窗避免截斷雜聲
        cabIR = b;
        if (ampNodes && ampNodes.cab) { ampNodes.cab.buffer = cabIR; }
      }).catch(function () {});
    } catch (e) {}
  }
  // ===================================================================
  // 效果器鏈（順序照真實 rig 接法）：
  //   麥克風 → Noise Gate → 綠推 Overdrive（可 bypass）→ 英倫疊音前級 → tone stack
  //          → Presence → 功率級 → 4x12 音箱 IR → Delay → Limiter → 輸出
  // ===================================================================
  function buildAmp() {
    if (!ctx || !source) return;

    // ── ① Noise Gate：GainNode 當閘門，開關由 gateTick() 依 RMS 控制 ──
    var gate = ctx.createGain(); gate.gain.value = gateOn ? 0 : 1;
    gateAnalyser = ctx.createAnalyser(); gateAnalyser.fftSize = 1024;
    gateBuf = new Float32Array(gateAnalyser.fftSize);
    source.connect(gateAnalyser);          // 量測用（不影響訊號）
    source.connect(gate);

    // ── ② 綠推 Overdrive：高通「先切低頻再削波」是它的靈魂，所以低音不會糊、中頻突出 ──
    var odIn = ctx.createGain(); odIn.gain.value = 1;
    var odHp = ctx.createBiquadFilter(); odHp.type = "highpass"; odHp.frequency.value = 720; odHp.Q.value = 0.707;
    var odGain = ctx.createGain(); odGain.gain.value = 1 + odDrive * 24;
    var odClip = ctx.createWaveShaper(); odClip.oversample = "4x"; odClip.curve = diodeCurve(2 + odDrive * 10);
    var odMid = ctx.createBiquadFilter(); odMid.type = "peaking"; odMid.frequency.value = 720; odMid.Q.value = 0.9; odMid.gain.value = 4;
    var odLp = ctx.createBiquadFilter(); odLp.type = "lowpass"; odLp.frequency.value = odToneHz(odTone);
    var odWet = ctx.createGain(); odWet.gain.value = odLevel;
    var odDry = ctx.createGain(); odDry.gain.value = 0.35;        // 這類踏板的 op-amp 有乾聲並聯，保留低頻厚度
    var odSum = ctx.createGain(); odSum.gain.value = 1;
    gate.connect(odIn);
    odIn.connect(odHp); odHp.connect(odGain); odGain.connect(odClip); odClip.connect(odMid); odMid.connect(odLp);
    odLp.connect(odWet); odWet.connect(odSum);
    odIn.connect(odDry); odDry.connect(odSum);
    // bypass 用：odBypass 直通、odSum 走踏板
    var odBypass = ctx.createGain(); odBypass.gain.value = odOn ? 0 : 1;
    var odOut = ctx.createGain(); odOut.gain.value = 1;
    gate.connect(odBypass); odBypass.connect(odOut);
    odSum.connect(odOut);
    odSum.gain.value = odOn ? 1 : 0;

    // ── ③ 英倫疊音前級：輸入耦合高通 → 兩段串接電子管級 ──
    var inHp = ctx.createBiquadFilter(); inHp.type = "highpass"; inHp.frequency.value = 82; inHp.Q.value = 0.7;
    var v1 = ctx.createGain(); v1.gain.value = 2.2 + ampDrive * 6;
    var v1s = ctx.createWaveShaper(); v1s.oversample = "4x"; v1s.curve = tubeCurve(1.6 + ampDrive * 2.2, 0.18);
    var bright = ctx.createBiquadFilter(); bright.type = "highshelf"; bright.frequency.value = 2200; bright.gain.value = 3;  // bright cap
    var v2 = ctx.createGain(); v2.gain.value = 1.3 + ampDrive * 7;
    var v2s = ctx.createWaveShaper(); v2s.oversample = "4x"; v2s.curve = tubeCurve(2.2 + ampDrive * 5.5, 0.26);
    odOut.connect(inHp); inHp.connect(v1); v1.connect(v1s); v1s.connect(bright); bright.connect(v2); v2.connect(v2s);

    // ── ④ 英式 tone stack：低音棚架 / 中頻（凹點在 ~650Hz）/ 高音棚架 ──
    var bass = ctx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 160;
    var midf = ctx.createBiquadFilter(); midf.type = "peaking"; midf.frequency.value = 650; midf.Q.value = 0.8;
    var treb = ctx.createBiquadFilter(); treb.type = "highshelf"; treb.frequency.value = 3000;
    var pres = ctx.createBiquadFilter(); pres.type = "peaking"; pres.frequency.value = 4500; pres.Q.value = 0.9;
    applyToneStack(bass, midf, treb, pres);
    v2s.connect(bass); bass.connect(midf); midf.connect(treb); treb.connect(pres);

    // ── ⑤ 功率級：輕微壓縮(sag) ＋ 軟削波 ──
    var sag = ctx.createDynamicsCompressor();
    sag.threshold.value = -18; sag.knee.value = 12; sag.ratio.value = 3;
    sag.attack.value = 0.006; sag.release.value = 0.12;
    var pwr = ctx.createWaveShaper(); pwr.oversample = "2x"; pwr.curve = tubeCurve(1.5, 0.1);
    pres.connect(sag); sag.connect(pwr);

    // ── ⑥ 4x12 音箱 IR（沒烘好就先用兩級低通頂著）──
    var cab = ctx.createConvolver(); cab.normalize = true;
    var cabMk = ctx.createGain(); cabMk.gain.value = 3.2;      // 卷積後補償音量
    var post = ctx.createGain(); post.gain.value = ampLevel;
    if (cabIR) { cab.buffer = cabIR; pwr.connect(cab); cab.connect(cabMk); cabMk.connect(post); }
    else {
      var lpA = ctx.createBiquadFilter(); lpA.type = "lowpass"; lpA.frequency.value = 5200;
      var lpB = ctx.createBiquadFilter(); lpB.type = "lowpass"; lpB.frequency.value = 4800;
      pwr.connect(lpA); lpA.connect(lpB); lpB.connect(post);
      buildCabIR();                                            // 非同步烘好後由 setter 換上
    }

    // ── ⑦ Delay（wet/dry 並聯 ＋ feedback）──
    var dry = ctx.createGain(); dry.gain.value = 1;
    var dl = ctx.createDelay(2.0); dl.delayTime.value = delayTime;
    var fb = ctx.createGain(); fb.gain.value = delayOn ? delayFb : 0;
    var wet = ctx.createGain(); wet.gain.value = delayOn ? delayMix : 0;
    var mixSum = ctx.createGain();
    post.connect(dry); dry.connect(mixSum);
    post.connect(dl); dl.connect(wet); wet.connect(mixSum);
    dl.connect(fb); fb.connect(dl);

    // ── ⑧ Limiter：壓縮限幅 ＋ 硬切天花板，輸出峰值絕不超過 -3dB（防爆音・護耳）──
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    var ceil = ctx.createWaveShaper(); ceil.curve = clipCurve(Math.pow(10, -3 / 20));
    mixSum.connect(lim); lim.connect(ceil);

    ampNodes = {
      gate: gate,
      odSum: odSum, odBypass: odBypass, odGain: odGain, odClip: odClip, odLp: odLp, odWet: odWet,
      v1: v1, v1s: v1s, v2: v2, v2s: v2s,
      bass: bass, midf: midf, treb: treb, pres: pres,
      cab: cab, post: post, dl: dl, fb: fb, wet: wet, out: ceil
    };
    ampConnected = false;
    startGateLoop();
    if (ampOn) connectAmp(true);
  }
  // Overdrive 的 Tone 旋鈕 → 出力低通截止頻率（左轉悶、右轉亮）
  function odToneHz(v) { return 1600 * Math.pow(4.5, Math.max(0, Math.min(1, v))); }   // 1.6k ~ 7.2k
  // 英式 tone stack：把 0~1 的旋鈕值換成各段 dB
  function applyToneStack(bass, midf, treb, pres) {
    bass.gain.value = -10 + toneBass * 20;                 // -10 ~ +10 dB @160Hz
    midf.gain.value = -9 + toneMid * 15;                   // -9 ~ +6 dB @650Hz（左轉＝經典 mid scoop）
    treb.gain.value = -8 + toneTreble * 18;                // -8 ~ +10 dB @3kHz
    pres.gain.value = -4 + tonePresence * 12;              // -4 ~ +8 dB @4.5kHz
  }

  // ---- Noise Gate 控制迴圈 ----
  function gateRms() {
    if (!gateAnalyser || !gateBuf) return 0;
    gateAnalyser.getFloatTimeDomainData(gateBuf);
    var sum = 0;
    for (var i = 0; i < gateBuf.length; i++) sum += gateBuf[i] * gateBuf[i];
    return Math.sqrt(sum / gateBuf.length);
  }
  function gateTick() {
    if (!ctx || !ampNodes || !ampNodes.gate) return;
    var g = ampNodes.gate.gain, now = ctx.currentTime;
    if (!gateOn) { g.setTargetAtTime(1, now, 0.005); gateOpen = true; return; }
    var rms = gateRms();
    if (rms > gateThresh) { gateOpen = true; gateHoldUntil = Date.now() + GATE_HOLD_MS; }
    else if (gateOpen && Date.now() > gateHoldUntil) { gateOpen = false; }
    g.setTargetAtTime(gateOpen ? 1 : 0, now, gateOpen ? GATE_ATTACK : GATE_RELEASE);
  }
  function startGateLoop() {
    if (gateTimer) clearInterval(gateTimer);
    gateTimer = setInterval(gateTick, 8);
  }
  function stopGateLoop() { if (gateTimer) { clearInterval(gateTimer); gateTimer = null; } }
  // 自動偵測底噪：量 ms 毫秒內的最大 RMS，門檻設在它上面約 +8dB
  function autoDetectGate(ms) {
    ms = ms || 1200;
    return new Promise(function (res) {
      if (!active || !gateAnalyser) { res(null); return; }
      var peak = 0, t0 = Date.now();
      var iv = setInterval(function () {
        var r = gateRms(); if (r > peak) peak = r;
        if (Date.now() - t0 >= ms) {
          clearInterval(iv);
          var th = Math.max(0.002, Math.min(0.25, peak * 2.5));   // +8dB 安全邊際
          gateThresh = th;
          res({ noise: peak, threshold: th });
        }
      }, 10);
    });
  }

  function connectAmp(on) {
    if (!ampNodes || !ctx) return;
    if (on && !ampConnected) { ampNodes.out.connect(ctx.destination); ampConnected = true; }
    else if (!on && ampConnected) { try { ampNodes.out.disconnect(ctx.destination); } catch (e) {} ampConnected = false; }
  }

  function isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  }

  // 列出可用的音訊輸入裝置（麥克風／錄音介面／混音器）；標籤需授權後才有
  function listInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function (ds) {
      return ds.filter(function (d) { return d.kind === "audioinput"; })
               .map(function (d) { return { id: d.deviceId, label: d.label || "" }; });
    }).catch(function () { return []; });
  }

  function start(deviceId) {
    if (active) return Promise.resolve();
    lastDevice = deviceId || "";
    var ac = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) ac.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ audio: ac }).then(function (s) {
      stream = s;
      var AC = window.AudioContext || window.webkitAudioContext;
      try { ctx = bufferFrames ? new AC({ latencyHint: bufferFrames / 48000 }) : new AC(); }
      catch (e) { ctx = new AC(); }                            // 不支援該延遲→退回預設
      rate = ctx.sampleRate;
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      buf = new Float32Array(analyser.fftSize);
      source.connect(analyser);
      buildAmp();                                              // 建虛擬音箱鏈(ampOn 時直接輸出)
      if (ctx.state === "suspended") { try { ctx.resume(); } catch (e2) {} }
      active = true;
    });
  }

  function stop() {
    active = false; ampNodes = null; ampConnected = false;
    stopGateLoop(); gateAnalyser = null; gateBuf = null;
    try { if (source) source.disconnect(); } catch (e) {}
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    ctx = analyser = source = stream = buf = null;
  }

  // 重新啟動（換取樣率／換裝置時用）：關掉再以現有設定重開
  function restart() {
    var d = lastDevice, wasActive = active;
    stop();
    if (!wasActive) return Promise.resolve();
    return start(d);
  }

  // 自相關基頻偵測。回傳頻率(Hz)或 -1（太安靜/無法判定）
  function autoCorrelate(b, sampleRate) {
    var SIZE = b.length;
    var rms = 0;
    for (var i = 0; i < SIZE; i++) { rms += b[i] * b[i]; }
    rms = Math.sqrt(rms / SIZE);
    if (rms < floor) return { freq: -1, rms: rms };

    var r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (var i = 0; i < SIZE / 2; i++) { if (Math.abs(b[i]) < thres) { r1 = i; break; } }
    for (var j = 1; j < SIZE / 2; j++) { if (Math.abs(b[SIZE - j]) < thres) { r2 = SIZE - j; break; } }
    var slice = b.subarray(r1, r2);
    var n = slice.length;
    if (n < 128) return { freq: -1, rms: rms };

    var c = new Float32Array(n);
    for (var i2 = 0; i2 < n; i2++) {
      var sum = 0;
      for (var j2 = 0; j2 < n - i2; j2++) sum += slice[j2] * slice[j2 + i2];
      c[i2] = sum;
    }
    var d = 0;
    while (d < n - 1 && c[d] > c[d + 1]) d++;
    var maxval = -1, maxpos = -1;
    for (var i3 = d; i3 < n; i3++) { if (c[i3] > maxval) { maxval = c[i3]; maxpos = i3; } }
    if (maxpos <= 0) return { freq: -1, rms: rms };

    var T0 = maxpos;
    var x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
    var a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
    if (a) T0 = T0 - bb / (2 * a);
    return { freq: sampleRate / T0, rms: rms };
  }

  function freqToMidi(f) {
    return Math.round(69 + 12 * Math.log2(f / 440));
  }

  // 讀取當前音高。回傳 { midi|null, pc|null, freq, rms }
  function read() {
    if (!active || !analyser) return { midi: null, pc: null, freq: 0, rms: 0 };
    analyser.getFloatTimeDomainData(buf);
    var r = autoCorrelate(buf, rate);
    if (r.freq <= 0) return { midi: null, pc: null, freq: 0, rms: r.rms };
    var midi = freqToMidi(r.freq);
    // 吉他合理音域約 E2(40) ~ E6(88)，超出視為泛音/雜訊誤判
    if (midi < 38 || midi > 90) return { midi: null, pc: null, freq: r.freq, rms: r.rms };
    return { midi: midi, pc: ((midi % 12) + 12) % 12, freq: r.freq, rms: r.rms };
  }

  // ---- 虛擬音箱對外控制 ----
  function setAmp(on) {
    ampOn = !!on;
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    connectAmp(ampOn);
  }
  function setAmpDrive(v) {
    ampDrive = Math.max(0, Math.min(1, v));
    if (!ampNodes) return;
    ampNodes.v1.gain.value = 2.2 + ampDrive * 6;
    ampNodes.v1s.curve = tubeCurve(1.6 + ampDrive * 2.2, 0.18);
    ampNodes.v2.gain.value = 1.3 + ampDrive * 7;
    ampNodes.v2s.curve = tubeCurve(2.2 + ampDrive * 5.5, 0.26);
  }
  function setAmpLevel(v) {
    ampLevel = Math.max(0, Math.min(1, v));
    if (ampNodes) ampNodes.post.gain.value = ampLevel;
  }
  function setDelayOn(on) { delayOn = !!on; if (ampNodes) { ampNodes.fb.gain.value = delayOn ? delayFb : 0; ampNodes.wet.gain.value = delayOn ? delayMix : 0; } }
  function setDelayTime(ms) { delayTime = Math.max(0, Math.min(2, (ms || 0) / 1000)); if (ampNodes) ampNodes.dl.delayTime.value = delayTime; }
  function setDelayFb(v) { delayFb = Math.max(0, Math.min(0.95, v)); if (ampNodes && delayOn) ampNodes.fb.gain.value = delayFb; }
  function setDelayMix(v) { delayMix = Math.max(0, Math.min(1, v)); if (ampNodes && delayOn) ampNodes.wet.gain.value = delayMix; }
  // ---- Noise Gate 對外控制 ----
  function setGateOn(on) {
    gateOn = !!on;
    if (ampNodes && ampNodes.gate && ctx) {
      if (!gateOn) ampNodes.gate.gain.setTargetAtTime(1, ctx.currentTime, 0.005);
      else { gateOpen = false; gateHoldUntil = 0; }
    }
  }
  function setGateThreshold(v) { gateThresh = Math.max(0.001, Math.min(0.3, v)); }
  function getGateThreshold() { return gateThresh; }
  function isGateOpen() { return !gateOn || gateOpen; }
  function getInputRms() { return gateRms(); }

  // ---- 綠推 Overdrive 對外控制 ----
  function setOdOn(on) {
    odOn = !!on;
    if (ampNodes && ctx) {
      var t = ctx.currentTime;
      ampNodes.odSum.gain.setTargetAtTime(odOn ? 1 : 0, t, 0.01);      // 踏板路徑
      ampNodes.odBypass.gain.setTargetAtTime(odOn ? 0 : 1, t, 0.01);   // 直通路徑
    }
  }
  function setOdDrive(v) {
    odDrive = Math.max(0, Math.min(1, v));
    if (ampNodes) { ampNodes.odGain.gain.value = 1 + odDrive * 24; ampNodes.odClip.curve = diodeCurve(2 + odDrive * 10); }
  }
  function setOdTone(v) { odTone = Math.max(0, Math.min(1, v)); if (ampNodes) ampNodes.odLp.frequency.value = odToneHz(odTone); }
  function setOdLevel(v) { odLevel = Math.max(0, Math.min(1, v)); if (ampNodes) ampNodes.odWet.gain.value = odLevel; }

  // ---- 英倫疊音 tone stack 對外控制 ----
  function setTone(which, v) {
    v = Math.max(0, Math.min(1, v));
    if (which === "bass") toneBass = v;
    else if (which === "mid") toneMid = v;
    else if (which === "treble") toneTreble = v;
    else if (which === "presence") tonePresence = v;
    if (ampNodes) applyToneStack(ampNodes.bass, ampNodes.midf, ampNodes.treb, ampNodes.pres);
  }

  function setBuffer(frames) { bufferFrames = parseInt(frames, 10) || 0; }   // 下次 start/restart 生效
  function getLatencyMs() {   // 實際 I/O 延遲(毫秒)：baseLatency + outputLatency
    if (!ctx) return 0;
    var b = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    return Math.round(b * 1000);
  }

  window.Pitch = {
    isSupported: isSupported,
    listInputs: listInputs,
    start: start,
    stop: stop,
    restart: restart,
    read: read,
    isActive: function () { return active; },
    setFloor: function (f) { floor = Math.max(0.001, f); },
    setAmp: setAmp,
    setAmpDrive: setAmpDrive,
    setAmpLevel: setAmpLevel,
    isAmpOn: function () { return ampOn; },
    setGateOn: setGateOn,
    setGateThreshold: setGateThreshold,
    getGateThreshold: getGateThreshold,
    isGateOpen: isGateOpen,
    getInputRms: getInputRms,
    autoDetectGate: autoDetectGate,
    setOdOn: setOdOn,
    setOdDrive: setOdDrive,
    setOdTone: setOdTone,
    setOdLevel: setOdLevel,
    setTone: setTone,
    setDelayOn: setDelayOn,
    setDelayTime: setDelayTime,
    setDelayFb: setDelayFb,
    setDelayMix: setDelayMix,
    setBuffer: setBuffer,
    getLatencyMs: getLatencyMs
  };
})();
