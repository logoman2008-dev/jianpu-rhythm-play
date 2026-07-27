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
  function ampCurve(drive) {                                  // 破音 waveshaper 曲線(drive 越大越硬)
    var n = 8192, c = new Float32Array(n), k = 8 + drive * drive * 280;
    for (var i = 0; i < n; i++) { var x = (i / (n - 1)) * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return c;
  }
  function clipCurve(limit) {                                 // 硬切天花板：任何輸入夾在 ±limit(絕對上限)
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = (i / (n - 1)) * 2 - 1; c[i] = Math.max(-limit, Math.min(limit, x)); }
    return c;
  }
  function buildAmp() {
    if (!ctx || !source) return;
    var pre = ctx.createGain(); pre.gain.value = 1 + ampDrive * 9;      // 前級增益
    var shaper = ctx.createWaveShaper(); shaper.oversample = "4x"; shaper.curve = ampCurve(ampDrive);
    var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90;    // 去低頻糊
    var mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1500; mid.Q.value = 0.7; mid.gain.value = 4;  // 中頻突出
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5000;   // 音箱高頻滾降(cab sim)
    var post = ctx.createGain(); post.gain.value = ampLevel;
    source.connect(pre); pre.connect(shaper); shaper.connect(hp); hp.connect(mid); mid.connect(lp); lp.connect(post);
    // 可調 delay 效果器（wet/dry 並聯 ＋ feedback 回授）
    var dry = ctx.createGain(); dry.gain.value = 1;
    var dl = ctx.createDelay(2.0); dl.delayTime.value = delayTime;
    var fb = ctx.createGain(); fb.gain.value = delayOn ? delayFb : 0;
    var wet = ctx.createGain(); wet.gain.value = delayOn ? delayMix : 0;
    var mixSum = ctx.createGain();
    post.connect(dry); dry.connect(mixSum);
    post.connect(dl); dl.connect(wet); wet.connect(mixSum);
    dl.connect(fb); fb.connect(dl);                                   // 回授
    // 限幅器 Limiter：壓縮器平滑限幅 + 硬切天花板，輸出峰值絕不超過 -3dB（保護耳朵＋防爆音）
    var lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    var ceil = ctx.createWaveShaper(); ceil.curve = clipCurve(Math.pow(10, -3 / 20));   // 絕對上限 -3dB(≈0.708)
    mixSum.connect(lim); lim.connect(ceil);
    ampNodes = { pre: pre, shaper: shaper, post: post, dl: dl, fb: fb, wet: wet, out: ceil }; ampConnected = false;
    if (ampOn) connectAmp(true);
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
    if (ampNodes) { ampNodes.pre.gain.value = 1 + ampDrive * 9; ampNodes.shaper.curve = ampCurve(ampDrive); }
  }
  function setAmpLevel(v) {
    ampLevel = Math.max(0, Math.min(1, v));
    if (ampNodes) ampNodes.post.gain.value = ampLevel;
  }
  function setDelayOn(on) { delayOn = !!on; if (ampNodes) { ampNodes.fb.gain.value = delayOn ? delayFb : 0; ampNodes.wet.gain.value = delayOn ? delayMix : 0; } }
  function setDelayTime(ms) { delayTime = Math.max(0, Math.min(2, (ms || 0) / 1000)); if (ampNodes) ampNodes.dl.delayTime.value = delayTime; }
  function setDelayFb(v) { delayFb = Math.max(0, Math.min(0.95, v)); if (ampNodes && delayOn) ampNodes.fb.gain.value = delayFb; }
  function setDelayMix(v) { delayMix = Math.max(0, Math.min(1, v)); if (ampNodes && delayOn) ampNodes.wet.gain.value = delayMix; }
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
    setDelayOn: setDelayOn,
    setDelayTime: setDelayTime,
    setDelayFb: setDelayFb,
    setDelayMix: setDelayMix,
    setBuffer: setBuffer,
    getLatencyMs: getLatencyMs
  };
})();
