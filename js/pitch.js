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
    var ac = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) ac.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ audio: ac }).then(function (s) {
      stream = s;
      var AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      rate = ctx.sampleRate;
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      buf = new Float32Array(analyser.fftSize);
      source.connect(analyser);
      active = true;
    });
  }

  function stop() {
    active = false;
    try { if (source) source.disconnect(); } catch (e) {}
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (ctx) ctx.close(); } catch (e) {}
    ctx = analyser = source = stream = buf = null;
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

  window.Pitch = {
    isSupported: isSupported,
    listInputs: listInputs,
    start: start,
    stop: stop,
    read: read,
    isActive: function () { return active; },
    setFloor: function (f) { floor = Math.max(0.001, f); }
  };
})();
