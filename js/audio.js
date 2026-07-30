// ===================================================================
// audio.js — Web Audio 合成引擎（掛在 window.GameAudio）
//  - 排程旋律背景音（可關）
//  - 打擊音效、判定回饋
//  - 以 AudioContext.suspend/resume 做暫停（凍結時間軸）
// ===================================================================
(function () {
  "use strict";

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // 破音波形曲線（k 越大越髒）
  function makeCurve(k) {
    var n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return c;
  }

  function Engine() {
    this.ctx = null;
    this.master = null;
    this.melodyGain = null;
    this.audioStartTime = 0;   // songTime = ctx.currentTime - audioStartTime
    this.notes = [];
    this.scheduleIdx = 0;
    this.melodyOn = true;
    this.lookahead = 0.35;     // 秒，提前排程
    this.tone = "clean";       // 吉他音色：clean | low | high
    // 音箱模擬（IR 卷積）
    this.cabMode = "synth";    // synth（內建合成音箱）| off（乾聲）| custom（使用者載入）
    this.synthMakeup = 4.5;    // 內建合成音箱卷積後補償音量（約與乾聲中頻等響；聽感可再調）
    this.customMakeup = 2.5;   // 自訂 IR 補償音量（實錄 IR 通常較熱，保守值；可依聽感調）
    this.cabIR = null;         // 內建合成音箱脈衝響應
    this.customIR = null;      // 使用者載入的 IR
  }
  Engine.prototype.setTone = function (t) { this.tone = t || "clean"; };
  Engine.prototype.setCab = function (mode) { this.cabMode = mode || "synth"; };
  // 目前生效的脈衝響應（off→null 乾聲；custom 有載入→自訂；否則內建合成）
  Engine.prototype._activeIR = function () {
    if (this.cabMode === "off") return null;
    if (this.cabMode === "custom" && this.customIR) return this.customIR;
    return this.cabIR;
  };
  // 載入使用者自己的音箱 IR（.wav 等）→ decodeAudioData → 切到 custom 模式
  Engine.prototype.loadIR = function (arrayBuffer) {
    this.ensure();
    var self = this;
    return new Promise(function (res, rej) {
      self.ctx.decodeAudioData(arrayBuffer.slice(0), function (buf) {
        self.customIR = buf; self.cabMode = "custom"; res(buf);
      }, function (e) { rej(e || new Error("IR 解碼失敗")); });
    });
  };
  // 用 OfflineAudioContext 把一組吉他喇叭箱 EQ 烘成脈衝響應（單位脈衝→多段濾波→錄下）
  Engine.prototype._buildCabIR = function () {
    try {
      var ctx = this.ctx, sr = ctx.sampleRate;
      var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return;
      var len = Math.max(256, Math.floor(sr * 0.045));   // ~45ms 短脈衝＝緊實箱體
      var off = new OAC(1, len, sr);
      var imp = off.createBuffer(1, len, sr);
      imp.getChannelData(0)[0] = 1;                        // 單位脈衝
      var src = off.createBufferSource(); src.buffer = imp;
      function bq(type, freq, Q, gain) {
        var f = off.createBiquadFilter(); f.type = type; f.frequency.value = freq;
        if (Q != null) f.Q.value = Q; if (gain != null) f.gain.value = gain; return f;
      }
      var chain = [
        bq("highpass", 85, 0.7),        // 收掉超低頻
        bq("peaking", 110, 1.1, 4),     // 箱體低頻共振
        bq("peaking", 400, 1.0, -3),    // 中低微凹（去悶）
        bq("peaking", 1200, 0.8, 2),    // 中頻厚度
        bq("peaking", 2600, 1.4, 5),    // presence 咬勁
        bq("notch", 7000, 1.2),         // 去 fizz 尖刺
        bq("lowpass", 5000, 0.7),       // 喇叭高頻滾降(第一級)
        bq("lowpass", 4600, 0.5)        // 第二級→更陡（真喇叭 >5kHz 幾乎不出聲）
      ];
      var node = src;
      for (var i = 0; i < chain.length; i++) { node.connect(chain[i]); node = chain[i]; }
      node.connect(off.destination);
      src.start(0);
      var self = this;
      off.startRendering().then(function (buf) {
        var d = buf.getChannelData(0), N = d.length;     // 尾端加窗，避免截斷雜聲
        for (var j = 0; j < N; j++) { var w = 1 - j / N; d[j] *= w * w; }
        self.cabIR = buf;
      }).catch(function () {});
    } catch (e) {}
  };
  // 把一個吉他樂音的輸出經音箱卷積後送到 out（off 或 IR 未就緒→直送乾聲）
  Engine.prototype._voiceOut = function (g, out) {
    var ib = this._activeIR();
    if (ib) {
      var useCustom = (this.cabMode === "custom" && this.customIR);
      var conv = this.ctx.createConvolver(); conv.normalize = true; conv.buffer = ib;
      var mk = this.ctx.createGain(); mk.gain.value = useCustom ? this.customMakeup : this.synthMakeup;
      g.connect(conv); conv.connect(mk); mk.connect(out);
    } else {
      g.connect(out);
    }
  };

  Engine.prototype.ensure = function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.melodyGain = this.ctx.createGain();
    this.melodyGain.gain.value = 1.05;   // 旋律導引/彈奏聲整體放大(再加大)
    this.melodyGain.connect(this.master);
    this.drumGain = this.ctx.createGain();      // 鼓組匯流
    this.drumGain.gain.value = 0.5;   // 鼓聲調小（原 0.9 太大聲，且吉他已放大）
    this.drumGain.connect(this.master);
    this.backGain = this.ctx.createGain();      // 伴奏(bass/和弦)匯流
    this.backGain.gain.value = 0.45;
    this.backGain.connect(this.master);
    // 白噪音緩衝（小鼓 / hi-hat / 鈸用）
    var n = this.ctx.sampleRate * 1.0, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), ch = buf.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // 吉他音色：破音曲線（clean 不破）
    this._curveLow = makeCurve(5);
    this._curveHigh = makeCurve(42);
    // 內建合成音箱脈衝響應（非同步烘出，倒數期間即就緒）
    this._buildCabIR();
    // 載入真實鼓樣本（CC0 808 kit）；載入前/失敗時 kick/snare/hat 自動退回合成
    this._loadDrums();
  };

  // 載入 assets/drums/*.wav → decodeAudioData 存進 this.drumBuf；失敗靜默(退回合成)
  Engine.prototype._loadDrums = function () {
    if (!this.ctx || this._drumsInit) return;
    this._drumsInit = true; this.drumBuf = {};
    var self = this, list = ["kick", "snare", "hat", "openhat", "crash"];   // MuldjordKit 真原音鼓(CC-BY)
    var ver = "";   // 跟著 audio.js 的 ?v= 帶版本→改鼓檔自動破快取(不會卡舊聲音)
    try { var sc = document.querySelector('script[src*="audio.js"]'); var m = sc && sc.src.match(/\?v=[^&]+/); if (m) ver = m[0]; } catch (e) {}
    list.forEach(function (k) {
      fetch("assets/drums/" + k + ".mp3" + ver, { cache: "default" })
        .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (ab) { if (ab) self.ctx.decodeAudioData(ab, function (b) { self.drumBuf[k] = b; }, function () {}); })
        .catch(function () {});
    });
  };
  // 播放一個鼓樣本；成功回 true(給 kick/snare/hat 判斷要不要退回合成)
  //   opts（選用，目前沒有聲部在用；保留給日後需要修樣本時用）：
  //     opts.fade  = 幾秒內收乾淨（樣本殘響尾巴太長時可裁）
  //     opts.notch = {f,q,gain} 用 peaking 濾波挖掉鼓身共振
  Engine.prototype._playSample = function (buf, at, gain, rate, opts) {
    if (!buf || !this.ctx) return false;
    var ctx = this.ctx;
    var src = ctx.createBufferSource(); src.buffer = buf;
    if (rate) src.playbackRate.value = rate;
    var node = src;
    if (opts && opts.notch) {
      var pk = ctx.createBiquadFilter();
      pk.type = "peaking";
      pk.frequency.value = opts.notch.f;
      pk.Q.value = opts.notch.q || 4;
      pk.gain.value = (opts.notch.gain != null) ? opts.notch.gain : -12;
      node.connect(pk); node = pk;
    }
    var g = ctx.createGain();
    if (opts && opts.fade) {
      g.gain.setValueAtTime(gain, at);
      g.gain.setValueAtTime(gain, at + opts.fade * 0.4);              // 前 40% 維持原音頭
      g.gain.exponentialRampToValueAtTime(0.0001, at + opts.fade);    // 之後收掉
    } else {
      g.gain.value = gain;
    }
    node.connect(g); g.connect(this.drumGain);
    src.start(at);
    if (opts && opts.fade) src.stop(at + opts.fade + 0.02);
    return true;
  };

  // 一段白噪音（供打擊）
  Engine.prototype._noise = function (at, dur, dest, peak, hp, lp) {
    var ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = this.noiseBuf;
    var node = src;
    if (hp) { var hpf = ctx.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = hp; node.connect(hpf); node = hpf; }
    if (lp) { var lpf = ctx.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = lp; node.connect(lpf); node = lpf; }
    node.connect(g); g.connect(dest || this.drumGain);
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.start(at); src.stop(at + dur + 0.02);
  };

  // ---- 鼓組（更接近真鼓：有打擊瞬態＋鼓身＋衰減） ----
Engine.prototype.kick = function (at, gain) {
    if (!this.ctx) return; var ctx = this.ctx, dg = this.drumGain, gn = gain || 1;
    if (this.drumBuf && this.drumBuf.kick) {                         // 真鼓樣本(已裁短)＋敲擊瞬態→有 punch、不像汽笛
      this._playSample(this.drumBuf.kick, at, gn * 1.0);
      this._noise(at, 0.010, dg, gn * 0.38, 3200);                  // beater click(高頻敲擊感)
      return;
    }
    var o = ctx.createOscillator(), g = ctx.createGain();          // 低頻鼓身（快速下滑＝punch）
    o.type = "sine"; o.frequency.setValueAtTime(175, at);
    o.frequency.exponentialRampToValueAtTime(46, at + 0.08);
    g.gain.setValueAtTime(gn * 1.0, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
    o.connect(g); g.connect(dg); o.start(at); o.stop(at + 0.36);
    this._noise(at, 0.012, dg, gn * 0.4, 3200);                    // beater 敲擊瞬態
  };
  Engine.prototype.snare = function (at, gain) {
    if (!this.ctx) return; var ctx = this.ctx, dg = this.drumGain, gn = gain || 1, frs = [185, 295], pks = [0.24, 0.15];
    if (this._playSample(this.drumBuf && this.drumBuf.snare, at, gn * 0.85)) return;   // 真鼓樣本優先
    for (var i = 0; i < 2; i++) {                                  // 兩個鼓身音（有音高感）
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(frs[i], at); o.frequency.exponentialRampToValueAtTime(frs[i] * 0.7, at + 0.08);
      g.gain.setValueAtTime(gn * pks[i], at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      o.connect(g); g.connect(dg); o.start(at); o.stop(at + 0.13);
    }
    this._noise(at, 0.17, dg, gn * 0.55, 1500);                    // 響弦沙沙
    this._noise(at, 0.05, dg, gn * 0.32, 3600);                    // 敲擊 crack
  };
  Engine.prototype.hat = function (at, gain, open) {
    if (!this.ctx) return; var d = open ? 0.34 : 0.035, gn = gain || 1;
    var buf = this.drumBuf && (open ? this.drumBuf.openhat : this.drumBuf.hat);
    if (this._playSample(buf, at, gn * (open ? 0.5 : 0.55))) return;   // 真鼓樣本優先
    this._noise(at, d, this.drumGain, gn * 0.2, 9000);             // 高頻嘶聲
    this._noise(at, d * 0.6, this.drumGain, gn * 0.12, 6500, 12000); // 金屬帶通感
  };
  Engine.prototype.crash = function (at, gain) {
    if (!this.ctx) return; var gn = gain || 1;
    if (this._playSample(this.drumBuf && this.drumBuf.crash, at, gn * 0.85)) return;   // 真 crash 鈸樣本
    this._noise(at, 1.0, this.drumGain, gn * 0.28, 4000);
    this._noise(at, 0.5, this.drumGain, gn * 0.16, 8000);
  };

  // ---- 伴奏（★ 目前未使用：「曲風」只出鼓組音色，game.js 的 scheduleGroove 不再呼叫這兩個。
  //      保留是為了日後若要加回貝斯／和弦鋪底，只需在 scheduleGroove 重新呼叫即可。）----
  Engine.prototype.bassNote = function (midi, at, dur, gain) {
    if (!this.ctx) return; var ctx = this.ctx, osc = ctx.createOscillator(), sub = ctx.createOscillator(), g = ctx.createGain();
    var f = midiToFreq(midi);
    osc.type = "sawtooth"; sub.type = "sine"; osc.frequency.value = f; sub.frequency.value = f / 2;
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
    osc.connect(lp); sub.connect(lp); lp.connect(g); g.connect(this.backGain);
    var pk = (gain || 1) * 0.5, e = at + Math.max(0.1, dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(pk, at + 0.01);
    g.gain.setValueAtTime(pk, e - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, e + 0.03);
    osc.start(at); sub.start(at); osc.stop(e + 0.05); sub.stop(e + 0.05);
  };
  // 和弦鋪底。⚠️ 舊版是 **三角波 ＋ 整個小節維持同一音量**，
  //   三角波只有奇次諧波 → E3(165Hz) 的三次諧波正好落在 **495Hz**，
  //   加上音量不衰減，就變成一整個小節不斷的中頻單音＝「汽笛聲」。
  //   改法（實測 495Hz 降 24dB、和弦基音幾乎不變）：
  //     ① 波形改 **sine**（完全沒有 495Hz 那個諧波）
  //     ② 包絡改成 **會衰減**（不再恆定），聽起來是鋪底而不是持續音
  Engine.prototype.chordPad = function (midis, at, dur, gain) {
    if (!this.ctx) return; var self = this, e = at + Math.max(0.2, dur);
    midis.forEach(function (m) {
      var ctx = self.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = midiToFreq(m);
      osc.connect(g); g.connect(self.backGain);
      var pk = (gain || 1) * 0.14;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(pk, at + 0.04);
      g.gain.exponentialRampToValueAtTime(pk * 0.35, at + (e - at) * 0.55);   // 中段先掉一半以上
      g.gain.exponentialRampToValueAtTime(0.0001, e + 0.05);
      osc.start(at); osc.stop(e + 0.08);
    });
  };

  // 播放一個吉他樂音，依 this.tone 走 clean / 破音 / 音箱模擬；bendSemi>0 滑音
  Engine.prototype._voice = function (midi, at, dur, dest, peak, bendSemi) {
    var ctx = this.ctx, tone = this.tone || "clean", out = dest || this.master;
    var f = midiToFreq(midi);
    var g = ctx.createGain();                    // ADSR 包絡
    var voices = [], a, d, s, rel, pk = peak;

    if (tone === "clean") {                      // 溫暖清音：三角＋八度正弦，柔性高頻滾降
      var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o1.type = "triangle"; o2.type = "sine";
      o1.frequency.setValueAtTime(f, at); o2.frequency.setValueAtTime(f * 2, at);
      g2.gain.value = 0.22; o2.connect(g2);
      var lp0 = ctx.createBiquadFilter(); lp0.type = "lowpass"; lp0.frequency.value = 5200; lp0.Q.value = 0.6;
      o1.connect(lp0); g2.connect(lp0); lp0.connect(g);
      voices = [{ o: o1, b: f }, { o: o2, b: f * 2 }];
      a = 0.006; d = 0.08; s = 0.5; rel = 0.14;
    } else {                                     // low / high gain：鋸齒→破音→音箱模擬(EQ)
      var high = (tone === "high");
      var s1 = ctx.createOscillator(), s2 = ctx.createOscillator();
      s1.type = "sawtooth"; s2.type = "sawtooth";
      s1.frequency.setValueAtTime(f, at); s2.frequency.setValueAtTime(f, at); s2.detune.value = high ? 11 : 7;
      var drive = ctx.createGain(); drive.gain.value = high ? 5.5 : 2.4;
      var ws = ctx.createWaveShaper(); ws.curve = high ? this._curveHigh : this._curveLow; ws.oversample = "4x";
      var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = high ? 120 : 90;   // 收緊低頻
      var mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 780; mid.Q.value = 0.8; mid.gain.value = high ? 5 : 3;
      var cab = ctx.createBiquadFilter(); cab.type = "lowpass"; cab.frequency.value = high ? 3600 : 4300; cab.Q.value = 0.7;  // 喇叭箱高頻滾降
      s1.connect(drive); s2.connect(drive); drive.connect(ws); ws.connect(hp); hp.connect(mid); mid.connect(cab); cab.connect(g);
      voices = [{ o: s1, b: f }, { o: s2, b: f }];
      a = 0.004; d = 0.05; s = high ? 0.82 : 0.66; rel = high ? 0.22 : 0.16; pk = peak * (high ? 0.55 : 0.72);
    }

    if (bendSemi && bendSemi > 0) {              // 推弦滑音
      var bStart = at + Math.min(0.07, dur * 0.2), bEnd = at + Math.min(dur * 0.55, Math.max(0.12, dur - 0.03));
      if (bEnd <= bStart) bEnd = bStart + 0.06;
      var ratio = Math.pow(2, bendSemi / 12);
      voices.forEach(function (v) {
        v.o.frequency.setValueAtTime(v.b, bStart);
        v.o.frequency.linearRampToValueAtTime(v.b * ratio, bEnd);
      });
    }

    this._voiceOut(g, out);                      // 經音箱 IR 卷積（cab off 時直送乾聲）
    var end = Math.max(at + a + d + 0.04, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(pk, at + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, pk * s), at + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, pk * s), Math.max(at + a + d, end - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    var stopAt = end + rel + 0.03;
    voices.forEach(function (v) { v.o.start(at); v.o.stop(stopAt); });
  };

  // 開始播放：設定時間原點與旋律清單
  Engine.prototype.start = function (notes, leadIn, melodyOn) {
    this.ensure();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.notes = notes.slice();
    this.scheduleIdx = 0;
    this.melodyOn = melodyOn;
    this.audioStartTime = this.ctx.currentTime + leadIn;
  };

  Engine.prototype.getSongTime = function () {
    if (!this.ctx) return 0;
    return this.ctx.currentTime - this.audioStartTime;
  };

  // 每一幀呼叫：排程即將到來的旋律音
  Engine.prototype.update = function () {
    if (!this.ctx || !this.melodyOn) return;
    var horizon = this.getSongTime() + this.lookahead;
    while (this.scheduleIdx < this.notes.length && this.notes[this.scheduleIdx].time <= horizon) {
      var n = this.notes[this.scheduleIdx];
      var at = this.audioStartTime + n.time;
      if (at >= this.ctx.currentTime - 0.05) {
        this._voice(n.midi, Math.max(at, this.ctx.currentTime + 0.001), Math.min(n.dur, 1.2), this.melodyGain, 0.46, (n.bend || 0) / 2);
      }
      this.scheduleIdx++;
    }
  };

  // 打中時的音高回饋（melody 關閉時用；讓玩家自己彈出旋律）；bendSemi 為推弦半音數
  Engine.prototype.playNote = function (midi, dur, bendSemi) {
    if (!this.ctx) return;
    var at = this.ctx.currentTime + 0.001;
    this._voice(midi, at, Math.min(dur || 0.25, 0.6), this.master, 0.5, bendSemi || 0);
  };

  // 短促的打擊音效
  Engine.prototype.click = function (good) {
    if (!this.ctx) return;
    var ctx = this.ctx, at = ctx.currentTime + 0.001;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(good ? 1400 : 300, at);
    osc.frequency.exponentialRampToValueAtTime(good ? 900 : 180, at + 0.05);
    g.gain.setValueAtTime(0.18, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    osc.connect(g); g.connect(this.master);
    osc.start(at); osc.stop(at + 0.1);
  };

  // 倒數嗶聲
  Engine.prototype.beep = function (high) {
    if (!this.ctx) return;
    var ctx = this.ctx, at = ctx.currentTime + 0.001;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = high ? 880 : 550;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    osc.connect(g); g.connect(this.master);
    osc.start(at); osc.stop(at + 0.22);
  };

  // 取得音訊時鐘(校正用共同時間基準)
  Engine.prototype.now = function () { this.ensure(); return this.ctx.currentTime; };

  // 在指定 ctx 時間播一個節拍器 tick(校正用)
  Engine.prototype.metroTick = function (at) {
    this.ensure();
    var ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1800, at);
    osc.frequency.exponentialRampToValueAtTime(1150, at + 0.03);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.32, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    osc.connect(g); g.connect(this.master);
    osc.start(at); osc.stop(at + 0.12);
  };

  // songTime → ctx 絕對時間（供排程節拍器/鼓）
  Engine.prototype.songTimeToCtx = function (t) { return this.audioStartTime + t; };

  // 節拍器：在指定 ctx 時間播一下（accent=小節第一拍，較高較響）
  Engine.prototype.metronomeAt = function (at, accent) {
    if (!this.ctx) return;
    var ctx = this.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = "square";
    var f = accent ? 2000 : 1400;
    osc.frequency.setValueAtTime(f, at);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, at + 0.03);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(accent ? 0.3 : 0.16, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(g); g.connect(this.master);
    osc.start(at); osc.stop(at + 0.09);
  };

  Engine.prototype.pause = function () {
    if (this.ctx && this.ctx.state === "running") return this.ctx.suspend();
  };
  Engine.prototype.resume = function () {
    if (this.ctx && this.ctx.state === "suspended") return this.ctx.resume();
  };
  Engine.prototype.setMelodyOn = function (on) {
    this.melodyOn = on;
    if (this.melodyGain) this.melodyGain.gain.value = on ? 1.05 : 0.0;
  };

  window.GameAudio = new Engine();
})();
