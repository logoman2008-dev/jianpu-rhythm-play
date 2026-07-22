// ===================================================================
// game.js — 簡譜音遊主程式
// 顯示模式：簡譜下落(直向) / 六線譜(橫向)
// 輸入模式：鍵盤 1–7 / 吉他收音(麥克風即時測音高)
// ===================================================================
(function () {
  "use strict";

  var T = window.Theory, GP = window.GPLoader, A = window.GameAudio, P = window.Pitch;

  // ---- 設定 ----
  var LANES = 7;
  var LANE_KEYS = ["1", "2", "3", "4", "5", "6", "7"];
  var LANE_COLORS = ["#ff5d6c", "#ff9f43", "#ffd93d", "#5ec26a", "#3fc7bb", "#5b8def", "#b06bff"];
  var LANE_NAMES = ["Do", "Re", "Mi", "Fa", "Sol", "La", "Si"];
  var NEUTRAL_NOTE = "#dfe3ea";   // 單音(無技巧)用的中性色

  // 指板樣式（木色 / 鑲嵌 inlay 型式 / 弦與品絲色 / 音符點顏色）
  var FRETBOARD_STYLES = {
    rosewood: { label: "玫瑰木·圓點", wood: ["#5b3b25", "#38230f"], inlay: "dot",
      inlayColor: "rgba(243,238,222,0.55)", fretwire: "rgba(205,210,218,0.5)", nut: "#e9e1cd",
      string: "rgba(238,232,215,0.22)", noteBg: "#dfe3ea", noteFg: "#161616" },
    ebony: { label: "黑檀·圓點", wood: ["#34343c", "#141416"], inlay: "dot",
      inlayColor: "rgba(232,234,240,0.6)", fretwire: "rgba(200,205,215,0.6)", nut: "#d8d4c8",
      string: "rgba(215,218,228,0.25)", noteBg: "#dfe3ea", noteFg: "#161616" },
    maple: { label: "楓木·黑點", wood: ["#e2c286", "#c99f56"], inlay: "dot",
      inlayColor: "rgba(30,22,10,0.6)", fretwire: "rgba(110,95,70,0.75)", nut: "#4a3418",
      string: "rgba(70,52,28,0.32)", noteBg: "#2f2a20", noteFg: "#f2ede0" },
    block: { label: "黑檀·方塊", wood: ["#34343c", "#141416"], inlay: "block",
      inlayColor: "rgba(238,236,228,0.9)", fretwire: "rgba(200,205,215,0.6)", nut: "#d8d4c8",
      string: "rgba(215,218,228,0.25)", noteBg: "#dfe3ea", noteFg: "#161616" },
    shark: { label: "黑檀·鯊魚鰭", wood: ["#241f2c", "#100e18"], inlay: "shark",
      inlayColor: "rgba(226,230,240,0.9)", fretwire: "rgba(200,205,215,0.6)", nut: "#d8d4c8",
      string: "rgba(215,218,228,0.25)", noteBg: "#dfe3ea", noteFg: "#161616" },
    vine: { label: "生命樹·藤蔓", wood: ["#3a2416", "#201004"], inlay: "vine",
      inlayColor: "rgba(210,228,196,0.85)", fretwire: "rgba(210,190,120,0.55)", nut: "#e0c878",
      string: "rgba(235,225,200,0.24)", noteBg: "#dfe3ea", noteFg: "#161616" }
  };
  var INLAY_SINGLE = [3, 5, 7, 9, 15, 17, 19, 21];
  var INLAY_DOUBLE = [12, 24];
  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  // 以「目標像素速度(px/s)」定義下落速度，與螢幕大小無關，鎖在人眼舒適追視範圍；
  // lead = 最短預視秒數(小螢幕保底反應時間)。實際 travel = max(lead, 距離 / vel)。
  var DIFFICULTY = {
    easy:   { vel: 260, lead: 1.6, label: "簡單" },
    normal: { vel: 360, lead: 1.2, label: "普通" },
    hard:   { vel: 500, lead: 0.9, label: "困難" }
  };
  var W_PERFECT = 0.100, W_GREAT = 0.200, W_GOOD = 0.290, W_MISS = 0.350;   // Perfect ±100ms，Great/Good/Miss 維持寬鬆好命中；收音模式 windows() perfect 再 +30ms、其餘 +50ms slack
  var JUDGE_OFFSET = 0.010;   // 各種判定全域延遲(秒)：命中甜蜜點往後 10ms（鍵盤＋收音都套用）；由「判定延遲微調」滑桿即時調整
  var OFFSET_KEY = "jianpu_judge_offset";   // 判定延遲微調滑桿的記憶值(ms)
  var MIC_PITCH_TOL = 1;   // 收音判定容許音準偏移(半音)：彈略走音/偵測誤差 ±1 半音內仍算命中
  var SCORE = { perfect: 1000, great: 650, good: 300 };
  var ACC = { perfect: 1, great: 0.65, good: 0.3, miss: 0 };
  var STORE_KEY = "jianpu_mic_settings";
  // 付費驗證已改到後端（Supabase）：見 js/auth.js。自己上傳的譜一律免費、不再有密碼閘門。

  // ---- 狀態 ----
  var state = "idle";            // idle | ready | playing | paused | result
  var displayMode = "tab";       // tab（六線譜/公路透視） | rocksmith（直向公路）
  var inputMode = "mic";         // 只保留收音（麥克風）模式（鍵盤模式已移除）
  var score, current, stats, travel, tonicPc;
  var timeline, tabTL, items, tabInfo = { tuning: [64,59,55,50,45,40], stringCount: 6 };
  var speed = 1, melodyNotes = [], songDuration = 0;   // 倍速、縮放後旋律、實際播放長度
  var barStartsScaled = [];   // 各小節起始秒(依倍速縮放)，六線譜指板檢視用
  var beatTimes = [], beatAccents = [], beatInBar = [], beatDurs = [], beatsPerBar = [], _metroIdx = 0, _grooveIdx = 0;   // 節拍器/鼓拍點
  var genre = "none";         // 曲風(鼓＋伴奏)
  var GENRE_KEY = "jianpu_genre";
  var TONE_KEY = "jianpu_tone";   // 吉他音色
  var CAB_KEY = "jianpu_cab";     // 音箱模擬(IR)
  var bgImage = null;         // 自訂背景圖／個人照(可選)
  var lulanBg = new Image();  // 閃電嚕嚕安專屬鎖定背景（吉他室照）
  lulanBg.src = "assets/lulan-bg.jpg";
  var lulanSweat = [];        // 閃電嚕嚕安汗滴粒子
  var bgOpacity = 0.55;       // 背景照透明度
  var bigJudge = null;        // 右側大字評分動畫狀態
  var charPulse = 0;          // 吉他手命中彈跳
  var guitaristId = "slash";  // 目前選的 Q 版吉他手
  var GUITARIST_KEY = "jianpu_guitarist";
  var hypeShown = 0;          // 舞台熱度(隨連段上升、平滑過渡)：燈光/觀眾/站台
  var comboBurst = { t: 999, level: 0 };   // 每達新連段段位(每10連段)的慶祝爆發動畫
  var countBeat = 0.5;                      // 開場倒數每一拍的秒數(依曲速；4 拍倒數用)
  var stageProcedural = false;             // 這幀是否在畫程序化舞台(無背景圖時才畫升降台/觀眾)
  var laneFlash, padFlash, pad = null, popups, dpr = 1;
  var flashByString = [0, 0, 0, 0, 0, 0];   // Rocksmith 公路：命中時各弦色標閃動
  var canvas, ctx, W = 0, H = 0, judgeY = 0;
  var els = {};
  // 收音 onset 狀態
  var micCand = -1, micStable = 0, micLastPc = -1, micWasSilent = true, micDisp = { midi: null, rms: 0, t: 0 };
  var micPeak = 0, micArmed = true, micLastHit = -9;   // 峰值追隨器＋重新起音武裝＋不反應期：讓「同一個音再撥」「搥勾/連奏後」也能再次判定，不會被 Miss
  // 收音校正（可調 + 存 localStorage）
  var micGate = 0.012, micLatencyMs = 50, micTesting = false;

  function $(id) { return document.getElementById(id); }

  function init() {
    ["fileInput","dropZone","trackSelect","keySelect","difficultySelect","displaySelect","inputSelect",
     "melodyToggle","startBtn","pauseBtn","restartBtn","backBtn","songInfo","status","setupPanel","gameWrap",
     "hudScore","hudCombo","hudAcc","hudTitle","progressFill","result","resultBody","micHud","micNote","micLevel",
     "micSettings","sensRange","sensVal","latRange","latVal","micTestBtn","testNote","testLevel",
     "autoCalBtn","leaderboard","calibModal","calibDot","calibProg","calibResult","calibClose","calibCancel",
     "speedRange","speedVal","bottomSelect","fretWindowSelect","fretStyleSelect","bgInput","guitaristSelect","metronomeToggle","genreSelect","bgOpacityRange","bgOpacityVal","audioInSelect","audioInTip"
    ].forEach(function (id) { els[id] = $(id); });
    canvas = $("gameCanvas");
    ctx = canvas.getContext("2d");

    var opts = '<option value="auto">自動偵測</option>';
    T.KEY_OPTIONS.forEach(function (k) { opts += '<option value="' + k.value + '">' + k.label + '</option>'; });
    els.keySelect.innerHTML = opts;

    els.fileInput.addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]);
    });
    ["dragover", "dragenter"].forEach(function (ev) {
      els.dropZone.addEventListener(ev, function (e) { e.preventDefault(); els.dropZone.classList.add("drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      els.dropZone.addEventListener(ev, function (e) { e.preventDefault(); els.dropZone.classList.remove("drag"); });
    });
    els.dropZone.addEventListener("drop", function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    els.dropZone.addEventListener("click", function () { els.fileInput.click(); });

    // 範例曲快速載入（讓沒有 .gp 檔的訪客也能玩）
    buildSampleList();
    // 自己上傳的譜：每日免費次數提示；登入/開通狀態改變時即時更新
    updateOwnGateTip();
    if (window.JianpuAuth && window.JianpuAuth.onChange) window.JianpuAuth.onChange(updateOwnGateTip);

    // 共用密碼解鎖 UI
    // 解鎖密碼控制在「嚕嚕安教材」欄位上（buildSampleList 產生）；Email 解鎖＋購買連結在「我的曲庫」欄位。
    loadUnlockConfig();
    loadPaidFolders();          // 讀取後台的付費資料夾上鎖設定
    renderLibUnlock();

    els.trackSelect.addEventListener("change", rebuildTimeline);
    els.keySelect.addEventListener("change", rebuildTimeline);
    els.displaySelect.addEventListener("change", rebuildTimeline);
    els.inputSelect.addEventListener("change", onInputModeChange);
    els.speedRange.addEventListener("input", function () {
      speed = parseFloat(els.speedRange.value) || 1;
      updateSpeedLabel();
      if (window._score) { buildItems(); updateSongInfo(); }   // 便宜重算(不重新解析)
    });
    updateSpeedLabel();
    els.bottomSelect.addEventListener("change", updateFretControls);
    els.bgInput.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { var im = new Image(); im.onload = function () { bgImage = im; }; im.src = r.result; };
      r.readAsDataURL(f);
    });
    els.bgOpacityRange.addEventListener("input", function () {
      bgOpacity = (parseInt(els.bgOpacityRange.value, 10) || 55) / 100;
      els.bgOpacityVal.textContent = Math.round(bgOpacity * 100) + "%";
    });
    // 吉他手角色：記住上次選擇（鎖定中的角色會被 refreshGuitaristLocks 擋掉/退回）
    try { var gv = localStorage.getItem(GUITARIST_KEY); if (gv && els.guitaristSelect.querySelector('option[value="' + gv + '"]')) els.guitaristSelect.value = gv; } catch (e) {}
    guitaristId = els.guitaristSelect.value;
    els.guitaristSelect.addEventListener("change", function () {
      if (!charUnlocked(els.guitaristSelect.value)) {                 // 保險：選到鎖定角色→退回並提示
        els.guitaristSelect.value = charUnlocked(guitaristId) ? guitaristId : "slash";
        setStatus(els.guitaristSelect.value === "lulan" ? "" : "這個角色還沒解鎖喔。", true);
        return;
      }
      guitaristId = els.guitaristSelect.value;
      try { localStorage.setItem(GUITARIST_KEY, guitaristId); } catch (e) {}
    });
    refreshGuitaristLocks();                                          // 依解鎖狀態標示🔒/停用
    // 音色固定：High Gain（重破音）＋ 合成音箱（內建 IR）；選單已移除、不再由使用者切換
    A.setTone("high");
    A.setCab("synth");
    // 曲風伴奏：記住上次選擇
    try { var gv2 = localStorage.getItem(GENRE_KEY); if (gv2 && els.genreSelect.querySelector('option[value="' + gv2 + '"]')) els.genreSelect.value = gv2; } catch (e) {}
    genre = els.genreSelect.value;
    els.genreSelect.addEventListener("change", function () {
      genre = els.genreSelect.value;
      try { localStorage.setItem(GENRE_KEY, genre); } catch (e) {}
    });

    // 判定延遲：手動微調已移除，改為固定預設＋「收音校正」自動量測(見 loadMicSettings / 自動校正)

    // 收音校正：載入設定並套用
    loadMicSettings();
    onInputModeChange();                                   // 只剩收音模式→開場就顯示收音校正面板
    els.sensRange.addEventListener("input", function () { applySens(); saveMicSettings(); });
    els.latRange.addEventListener("input", function () { applyLatency(); saveMicSettings(); });
    els.micTestBtn.addEventListener("click", toggleMicTest);
    els.autoCalBtn.addEventListener("click", autoCalibrate);
    els.calibCancel.addEventListener("click", cancelCalib);
    els.calibClose.addEventListener("click", cancelCalib);

    // 觸控 / 滑鼠：點畫面底部的觸控鍵
    canvas.addEventListener("pointerdown", onPointerDown);

    els.startBtn.addEventListener("click", startGame);
    els.pauseBtn.addEventListener("click", togglePause);
    els.restartBtn.addEventListener("click", startGame);
    els.backBtn.addEventListener("click", backToSetup);
    $("resultRetry").addEventListener("click", startGame);
    $("resultBack").addEventListener("click", backToSetup);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && state === "playing") togglePause();
    });

    resize();
    requestAnimationFrame(loop);
    setStatus("請載入一個 Guitar Pro 檔（.gp / .gpx / .gp5 / .gp4 / .gp3）開始。");
  }

  function setStatus(msg, isError) {
    els.status.textContent = msg || "";
    els.status.className = "status" + (isError ? " error" : "");
  }

  // ---- 收音校正 ----
  function onInputModeChange() {
    var mic = els.inputSelect.value === "mic";
    els.micSettings.classList.toggle("hidden", !mic);
    if (mic) { refreshAudioInputs(); }   // 不再強制關閉旋律導引（使用者可自行勾選播放）
    if (!mic && micTesting) toggleMicTest();
  }
  // 目前選的音訊輸入裝置 id（空＝預設）
  function micDeviceId() { return (els.audioInSelect && els.audioInSelect.value) || ""; }
  // 列出音訊輸入裝置到下拉（授權後才有名稱）
  function refreshAudioInputs() {
    if (!P.listInputs) return;
    P.listInputs().then(function (list) {
      var sel = els.audioInSelect, prev = sel.value;
      var html = '<option value="">預設輸入裝置</option>', named = false;
      list.forEach(function (d, i) {
        var label = d.label || ("輸入裝置 " + (i + 1));
        if (d.label) named = true;
        html += '<option value="' + d.id + '">' + escapeHtml(label) + '</option>';
      });
      sel.innerHTML = html;
      if (prev && sel.querySelector('option[value="' + prev + '"]')) sel.value = prev;
      if (els.audioInTip) els.audioInTip.style.display = named ? "none" : "";
    });
  }
  function loadMicSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (typeof s.sens === "number") els.sensRange.value = s.sens;
      if (typeof s.lat === "number") els.latRange.value = s.lat;
    } catch (e) {}
    applySens(); applyLatency();
  }
  function saveMicSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ sens: +els.sensRange.value, lat: +els.latRange.value })); } catch (e) {}
  }
  function applySens() {
    var s = +els.sensRange.value;                 // 0..100
    micGate = 0.03 - (s / 100) * 0.026;           // 0.03(需大聲) → 0.004(很靈敏)
    P.setFloor(Math.min(micGate, 0.006));
    els.sensVal.textContent = s < 34 ? "低" : s < 67 ? "中" : "高";
  }
  function applyLatency() {
    micLatencyMs = +els.latRange.value;
    els.latVal.textContent = micLatencyMs + " ms";
  }
  var _testRAF = 0;
  function toggleMicTest() {
    if (micTesting) {
      micTesting = false;
      els.micTestBtn.textContent = "▶ 測試麥克風";
      if (_testRAF) cancelAnimationFrame(_testRAF);
      P.stop();
      els.testNote.textContent = "—"; els.testLevel.style.width = "0%";
      return;
    }
    if (!P.isSupported()) { setStatus("此環境無法取用麥克風（需 https 或 http://localhost）。", true); return; }
    els.micTestBtn.textContent = "● 測試中…（點此停止）";
    P.start(micDeviceId()).then(function () {
      refreshAudioInputs();            // 授權後才拿得到裝置名稱
      micTesting = true;
      var tick = function () {
        if (!micTesting) return;
        var p = P.read();
        if (p.midi != null) {
          var d = T.midiToDegree(p.midi, tonicPc != null ? tonicPc : 0);
          els.testNote.textContent = noteName(p.midi) + " · " + T.accSymbol(d.alter) + d.degree;
        } else els.testNote.textContent = "—";
        els.testLevel.style.width = Math.max(0, Math.min(100, p.rms * 700)) + "%";
        _testRAF = requestAnimationFrame(tick);
      };
      tick();
    }).catch(function (err) {
      els.micTestBtn.textContent = "▶ 測試麥克風";
      setStatus("無法取用麥克風：" + (err && err.message ? err.message : err), true);
    });
  }

  // ---- 自動延遲校正 ----
  var calib = null;
  function autoCalibrate() {
    if (micTesting) toggleMicTest();
    if (!P.isSupported()) { setStatus("需要麥克風（https 或 http://localhost）才能自動校正。", true); return; }
    A.now(); // 確保音訊時鐘存在
    if (A.ctx && A.ctx.state === "suspended") A.ctx.resume();
    els.calibResult.textContent = "";
    els.calibProg.textContent = "要求麥克風…";
    els.calibClose.classList.add("hidden");
    els.calibCancel.classList.remove("hidden");
    els.calibModal.classList.remove("hidden");
    P.start(micDeviceId()).then(startCalibRun).catch(function (err) {
      els.calibProg.textContent = "無法取用麥克風";
      els.calibResult.textContent = String(err && err.message ? err.message : err);
      els.calibClose.classList.remove("hidden");
      els.calibCancel.classList.add("hidden");
    });
  }
  function startCalibRun() {
    var interval = 0.6, count = 8, lead = 1.4, t0 = A.now() + lead, beats = [];
    for (var i = 0; i < count; i++) { beats.push(t0 + i * interval); A.metroTick(t0 + i * interval); }
    calib = { beats: beats, interval: interval, count: count, offsets: [], matched: new Array(count).fill(false),
              prevRms: 0, gate: Math.max(0.01, Math.min(micGate, 0.02)), lastPulse: -1, raf: 0 };
    calibLoop();
  }
  function calibLoop() {
    if (!calib) return;
    var now = A.now(), p = P.read();
    if (calib.prevRms < calib.gate && p.rms >= calib.gate) {   // 起音(上升緣)
      var bi = -1, bd = 1e9;
      for (var i = 0; i < calib.beats.length; i++) { var d = Math.abs(now - calib.beats[i]); if (d < bd) { bd = d; bi = i; } }
      if (bi >= 0 && bd < calib.interval * 0.6 && !calib.matched[bi]) {
        calib.matched[bi] = true; calib.offsets.push(now - calib.beats[bi]);
      }
    }
    calib.prevRms = p.rms;
    var passed = 0;
    for (var j = 0; j < calib.count; j++) if (now >= calib.beats[j]) passed = j + 1;
    if (passed !== calib.lastPulse && passed > 0) {
      calib.lastPulse = passed;
      els.calibDot.classList.add("pulse");
      setTimeout(function () { els.calibDot.classList.remove("pulse"); }, 120);
    }
    els.calibProg.textContent = (now < calib.beats[0]) ? "準備…"
      : (Math.min(passed, calib.count) + " / " + calib.count + "　已收到 " + calib.offsets.length + " 次");
    if (now > calib.beats[calib.count - 1] + calib.interval * 0.8) { finishCalib(); return; }
    calib.raf = requestAnimationFrame(calibLoop);
  }
  function finishCalib() {
    var offs = calib.offsets.slice().sort(function (a, b) { return a - b; });
    if (offs.length >= 3) {
      var med = offs[Math.floor(offs.length / 2)];
      var ms = Math.round(Math.max(0, Math.min(0.2, med)) * 1000);
      els.latRange.value = ms; applyLatency(); saveMicSettings();
      els.calibProg.textContent = "完成";
      els.calibResult.textContent = "測得延遲 ≈ " + ms + " ms，已套用（收到 " + offs.length + "/" + calib.count + " 拍）";
    } else {
      els.calibProg.textContent = "資料不足";
      els.calibResult.textContent = "只收到 " + offs.length + " 拍，未調整。請彈大聲些或把靈敏度調高再試。";
    }
    P.stop();
    els.calibClose.classList.remove("hidden");
    els.calibCancel.classList.add("hidden");
    calib = null;
  }
  function cancelCalib() {
    if (calib && calib.raf) cancelAnimationFrame(calib.raf);
    calib = null; P.stop();
    els.calibModal.classList.add("hidden");
    els.calibDot.classList.remove("pulse");
  }

  // ---- 成績存檔 / 排行 ----
  var SCORE_KEY = "jianpu_scores";
  function loadAllScores() { try { return JSON.parse(localStorage.getItem(SCORE_KEY) || "{}"); } catch (e) { return {}; } }
  function songKeyOf() { return ((timeline && timeline.title) || "?") + " ｜ " + ((timeline && timeline.trackName) || "?"); }
  function modeLabel() { return dispName() + "/" + (inputMode === "mic" ? "收音" : "鍵盤") + "/" + DIFFICULTY[els.difficultySelect.value].label + (speed !== 1 ? " " + fmtSpeed(speed) : ""); }
  function saveScoreRecord(rec) {
    var all = loadAllScores(), list = all[rec.key] || [];
    list.push(rec);
    list.sort(function (a, b) { return b.score - a.score; });
    list = list.slice(0, 20);
    all[rec.key] = list;
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(all)); } catch (e) {}
    return list;
  }
  function gradeColor(g) { return { S: "#ffd93d", A: "#5ec26a", B: "#3fc7bb", C: "#5b8def", D: "#ff5d6c" }[g] || "#fff"; }
  function fmtDate(ts) { try { var d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate(); } catch (e) { return ""; } }
  function renderLeaderboard() {
    if (!timeline) { els.leaderboard.classList.add("hidden"); return; }
    var list = (loadAllScores()[songKeyOf()] || []).slice(0, 5);
    var html = '<div class="lb-head">🏆 本曲最佳成績</div>';
    if (!list.length) html += '<div class="lb-empty">還沒有紀錄，玩一場就會出現在這裡。</div>';
    else list.forEach(function (r, i) {
      html += '<div class="lb-row"><span class="lb-rank">' + (i + 1) + '</span>' +
        '<span class="lb-grade" style="color:' + gradeColor(r.grade) + '">' + r.grade + '</span>' +
        '<span class="lb-score">' + r.score.toLocaleString() + '</span>' +
        '<span class="lb-meta">' + r.acc.toFixed(1) + '%・' + escapeHtml(r.mode) + '・' + fmtDate(r.date) + '</span></div>';
    });
    els.leaderboard.innerHTML = html;
    els.leaderboard.classList.remove("hidden");
  }

  // ---- 觸控 / 滑鼠 ----
  function onPointerDown(e) {
    if (state !== "playing" || inputMode !== "keyboard" || !pad) return;
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left), y = (e.clientY - rect.top);
    if (y < pad.y0 || y > pad.y0 + pad.h) return;
    var lane = Math.floor(x / (W / LANES));
    if (lane < 0 || lane >= LANES) return;
    e.preventDefault();
    var deg = lane + 1;
    attemptHit(function (it) { return it.degSet.indexOf(deg) >= 0; }, lane);
  }

  // ---- 載入與解析 ----
  // 曲庫清單（來自 js/songs.js）：
  //   window.FREE_GROUPS   — 免費示範曲：檔案放在網站本地 songs/ 底下，任何人可玩。
  //   window.SAMPLE_GROUPS — 付費教材（嚕嚕安）：檔案放後端 Supabase 私密 bucket，
  //                          需「登入 + 已開通」才下載得到。清單標題可公開（等於課程大綱）。
  var SAMPLE_GROUPS = window.SAMPLE_GROUPS || [];
  var FREE_GROUPS   = window.FREE_GROUPS   || [];
  function countSongs(group) {
    if (group.songs) return group.songs.length;
    return (group.groups || []).reduce(function (n, g) { return n + countSongs(g); }, 0);
  }
  // 每首曲子帶一個 ctx 描述來源：
  //   {local:true}                         → 本地免費檔（songs/ 底下）
  //   {tier:'free', bucket:'free-songs'}   → 公開倉庫免費曲（管理後台上傳）
  //   {tier:'paid', bucket:'paid-songs'}   → 私密倉庫付費教材（需登入+開通）
  function renderSampleGroup(group, depth, ctx) {
    ctx = ctx || {};
    var det = document.createElement("details");
    det.className = "sample-group" + (depth > 0 ? " sub" : "");
    if (depth === 0) det.open = true;                   // 頂層預設展開，子課程收合
    var sum = document.createElement("summary");
    var isFolder  = (ctx.tier === "paid" && depth === 0 && ctx.grp != null);   // 後台付費資料夾(各自密碼)
    var isCurated = (ctx.tier === "paid" && depth === 0 && ctx.grp == null);   // 嚕嚕安教材(主密碼)
    var locked = isFolder ? (folderIsLocked(ctx.grp) && !folderUnlocked(ctx.grp))
               : isCurated ? !isUnlocked() : false;
    var lock = locked ? "🔒 " : "";
    sum.innerHTML = lock + escapeHtml(group.title) + ' <span class="sample-count">' + countSongs(group) + '</span>';
    det.appendChild(sum);
    if (isFolder && locked) {                                    // 上鎖資料夾→放各自的密碼欄
      var fw = document.createElement("div"); fw.innerHTML = folderUnlockHtml(ctx.grp); det.appendChild(fw.firstChild);
    } else if (isCurated && !_paidUnlockPlaced) {                // 嚕嚕安教材→主密碼欄(只放一次)
      var puWrap = document.createElement("div"); puWrap.innerHTML = paidUnlockHtml(); det.appendChild(puWrap.firstChild); _paidUnlockPlaced = true;
    }
    if (group.groups) {
      group.groups.forEach(function (sub) { det.appendChild(renderSampleGroup(sub, depth + 1, ctx)); });
    } else if (group.songs) {
      var inner = document.createElement("div");
      inner.className = "sample-list-inner";
      group.songs.forEach(function (song) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "btn small ghost sample-btn";
        b.textContent = song.label; b.title = song.label;
        b.addEventListener("click", function () { loadSample(song.path, song.label, ctx); });
        inner.appendChild(b);
      });
      det.appendChild(inner);
    }
    return det;
  }
  var _paidUnlockPlaced = false;   // 每次重建曲庫時只在第一個付費頂層欄位放一次解鎖控制
  function buildSampleList() {
    var box = $("sampleList"); if (!box) return;
    box.innerHTML = "";
    _paidUnlockPlaced = false;
    // 免費示範曲是本地檔，用 file:// 直接開會抓不到 → 提示（倉庫曲走網路不受此限）
    if (FREE_GROUPS.length && location.protocol === "file:") {
      var warn = document.createElement("div");
      warn.className = "lib-empty";
      warn.style.color = "#ffb454";
      warn.innerHTML = "⚠ 你是用「檔案(file://)」直接開啟的，本地免費示範曲無法載入。<br>請改用資料夾裡的「啟動遊戲.command」（會用本機伺服器開）。<br>（「我的曲庫」自己上傳的曲子不受影響。）";
      box.appendChild(warn);
    }
    FREE_GROUPS.forEach(function (group)   { box.appendChild(renderSampleGroup(group, 0, { local: true, tier: "free" })); });
    SAMPLE_GROUPS.forEach(function (group) { box.appendChild(renderSampleGroup(group, 0, { tier: "paid", bucket: "paid-songs" })); });
    wirePaidUnlock(box);
    appendDbCatalog(box);
  }
  // 從 Supabase「songs」清單表載入管理後台新增的自訂曲（免費／付費），追加到清單
  function appendDbCatalog(box) {
    var A = window.JianpuAuth;
    if (!A || !A.fetchCatalog || !box) return;
    A.fetchCatalog().then(function (rows) {
      if (!rows || !rows.length) return;
      function toSong(r) { return { label: r.title, path: r.path }; }
      var free = rows.filter(function (r) { return r.tier === "free"; });
      var paid = rows.filter(function (r) { return r.tier !== "free"; });
      if (free.length) box.appendChild(renderSampleGroup({ title: "自訂免費曲", songs: free.map(toSong) }, 0, { tier: "free", bucket: "free-songs" }));
      // 付費：依 grp 分成各自的資料夾，每個資料夾可獨立上鎖＋獨立密碼（後台設定）
      var byGrp = {};
      paid.forEach(function (r) { var g = r.grp || "自訂教材"; (byGrp[g] = byGrp[g] || []).push(r); });
      Object.keys(byGrp).forEach(function (g) {
        box.appendChild(renderSampleGroup({ title: g, songs: byGrp[g].map(toSong) }, 0, { tier: "paid", bucket: "paid-songs", grp: g }));
      });
      wirePaidUnlock(box); wireFolderUnlock(box);
    });
  }
  function encodePath(p) { return String(p).split("/").map(encodeURIComponent).join("/"); }
  function loadSample(path, label, ctx) {
    ctx = ctx || {};
    var base = String(path).split("/").pop();
    var name = label || base.replace(/\.gp\d?$/i, "");
    if (ctx.local) {   // 本地免費檔
      var url = "songs/" + encodePath(path);
      setStatus("載入範例：" + name + " …");
      fetch(url, { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
        .then(function (buf) { loadArrayBuffer(buf, base); })
        .catch(function (e) { setStatus("載入範例失敗（" + decodeURIComponent(url) + "）：" + (e && e.message ? e.message : e), true); });
      return;
    }
    loadBucketSong(path, name, base, ctx);   // 倉庫曲（免費公開或付費私密）
  }
  function loadBucketSong(path, name, base, ctx) {
    var A = window.JianpuAuth, paid = ctx.tier === "paid";
    if (!A || !A.isReady()) { setStatus("需要連線後端才能載入這首；但服務尚未設定或無法連線。", true); return; }
    if (paid) {
      if (ctx.grp != null) {                                           // 後台付費資料夾 → 各自的密碼
        if (folderIsLocked(ctx.grp) && !folderUnlocked(ctx.grp)) {
          setStatus("這個資料夾需要密碼 🔒 請在「" + ctx.grp + "」上方輸入該資料夾的解鎖密碼。", true);
          var fi = document.querySelector('.paid-unlock[data-grp] .fu-input'); if (fi) { try { fi.focus(); fi.scrollIntoView({ block: "center" }); } catch (e) {} }
          return;
        }
      } else if (!isUnlocked()) {                                      // 嚕嚕安教材 → 主解鎖密碼
        setStatus("這是付費教材 🔒 請在「嚕嚕安教材」欄位輸入解鎖密碼（購買請洽老師 LINE：paul780516）。", true);
        focusPaidUnlock();
        return;
      }
    }
    setStatus((paid ? "載入教材：" : "載入：") + name + " …");
    A.downloadSong(ctx.bucket || "paid-songs", path)
      .then(function (buf) { loadArrayBuffer(buf, base); })
      .catch(function (e) {
        var code = e && e.code;
        if (code === "NOT_ENTITLED" && paid) setStatus("教材檔讀取失敗：請確認後台已把 paid-songs 設為可讀取（見設定指南），稍後再試 🙂", true);
        else setStatus("載入失敗：" + (e && e.message ? e.message : e), true);
      });
  }

  // ---- 自己上傳的譜：已解鎖(密碼/開通) → 無限；否則用「每天自動 +DAILY_FREE 的累加式免費額度」----
  //   額度會記憶在瀏覽器：每過一天自動加 DAILY_FREE 首(可累積到 FREE_CAP)，玩一首扣 1；沒玩不會歸零。
  var DAILY_FREE = 5, FREE_CAP = 50, CREDIT_KEY = "jianpu_free_credits";
  // 自己上傳的譜「無限使用」條件：密碼解鎖 或 Email 解鎖 或 後端已開通（付費教材另需密碼，見 loadBucketSong）
  function isPaid() { return isUnlocked() || isEmailUnlocked() || (function () { var A = window.JianpuAuth; return !!(A && A.isEntitled && A.isEntitled()); })(); }
  function epochDay() { var d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); }  // 依本地時區的「天」序號
  function saveCredits(st) { try { localStorage.setItem(CREDIT_KEY, JSON.stringify(st)); } catch (e) {} }
  function readCredits() {
    var st; try { st = JSON.parse(localStorage.getItem(CREDIT_KEY) || "null"); } catch (e) { st = null; }
    var today = epochDay();
    if (!st || typeof st.bal !== "number" || typeof st.day !== "number") { st = { bal: DAILY_FREE, day: today }; saveCredits(st); }
    else if (today > st.day) { st.bal = Math.min(FREE_CAP, st.bal + (today - st.day) * DAILY_FREE); st.day = today; saveCredits(st); }  // 補發累加
    return st;
  }
  function remainFree() { return readCredits().bal; }
  function bumpUsage() { var st = readCredits(); if (st.bal > 0) { st.bal--; saveCredits(st); } }
  function ownGateBlockedMsg() { return "免費額度用完了。每天會自動 +" + DAILY_FREE + " 首（可累積到 " + FREE_CAP + " 首），或輸入解鎖密碼後無限使用。"; }
  // 可用回傳 true（未解鎖者扣一點額度），用完回傳 false
  function gateOwnUse() {
    if (isPaid()) return true;
    var st = readCredits();
    if (st.bal > 0) { st.bal--; saveCredits(st); updateOwnGateTip(); return true; }
    updateOwnGateTip();
    return false;
  }
  function updateOwnGateTip() {
    var el = document.getElementById("ownGateTip"); if (!el) return;
    if (isPaid()) el.innerHTML = "自己上傳的譜：<b style='color:#7CFC9B'>已解鎖 ✓ 無限使用</b>";
    else el.innerHTML = "自己上傳的譜：免費額度剩 <b>" + remainFree() + "</b> 首（每天自動 +" + DAILY_FREE + "、可累積到 " + FREE_CAP + "；解鎖後無限）";
  }

  // ===================================================================
  // 共用密碼解鎖（教材＋嚕嚕安角色）＋ 角色解鎖進度（S 級）
  //   - 解鎖密碼預設 lulu9453，可由「管理後台」改（存 Supabase app_config 的 SHA-256，前端只拿到 hash）。
  //   - 輸入正確密碼 → 這個瀏覽器永久解鎖：付費教材可載入、每日限次解除、嚕嚕安角色開放。
  //   - 其他吉他手角色 → 累積幾首歌拿到 S 級才逐一解鎖。
  // ===================================================================
  var DEFAULT_UNLOCK_PW = "lulu9453";
  var UNLOCK_KEY = "jianpu_unlocked_v1";          // 密碼解鎖（付費教材＋嚕嚕安角色＋自己上傳無限）
  var EMAIL_UNLOCK_KEY = "jianpu_email_unlocked"; // Email 解鎖（只讓「自己上傳的譜」無限；不開放付費教材/角色）
  var _unlockHash = null;                       // 後台設定的密碼 SHA-256(hex)；null=用預設密碼比對
  function isUnlocked() { try { return localStorage.getItem(UNLOCK_KEY) === "1"; } catch (e) { return false; } }     // = 密碼解鎖（付費教材用這個把關）
  function setUnlocked(v) { try { if (v) localStorage.setItem(UNLOCK_KEY, "1"); else localStorage.removeItem(UNLOCK_KEY); } catch (e) {} }
  function isEmailUnlocked() { try { return localStorage.getItem(EMAIL_UNLOCK_KEY) === "1"; } catch (e) { return false; } }
  function setEmailUnlocked(v) { try { if (v) localStorage.setItem(EMAIL_UNLOCK_KEY, "1"); else localStorage.removeItem(EMAIL_UNLOCK_KEY); } catch (e) {} }
  function sha256hex(str) {
    try {
      var buf = new TextEncoder().encode(str);
      return crypto.subtle.digest("SHA-256", buf).then(function (h) {
        return [].map.call(new Uint8Array(h), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
      });
    } catch (e) { return Promise.reject(e); }
  }
  function verifyUnlockPw(pw) {                  // 回傳 Promise<boolean>
    pw = (pw || "").trim();
    if (!pw) return Promise.resolve(false);
    if (_unlockHash) return sha256hex(pw).then(function (h) { return h === _unlockHash; }).catch(function () { return pw === DEFAULT_UNLOCK_PW; });
    return Promise.resolve(pw === DEFAULT_UNLOCK_PW);
  }
  // 開機時向後台拿目前設定的密碼 hash（沒設定或連不到 → 用預設密碼）
  function loadUnlockConfig() {
    var A = window.JianpuAuth;
    if (A && A.fetchConfig) A.fetchConfig("unlock_pw_hash").then(function (v) { if (v) _unlockHash = String(v).toLowerCase(); }).catch(function () {});
  }

  // ---- 角色解鎖 ----
  // LOCKED_CHARS[i] 需要 (i+1) 首不同歌曲拿到 S 級；未列的(slash/none)一開始就有；lulan＝密碼解鎖
  var LOCKED_CHARS = ["hendrix", "angus", "may", "vanhalen", "cobain", "bbking", "page", "zakk", "henson", "asato", "ichika", "yvette"];
  var SCLEAR_KEY = "jianpu_s_songs";
  function sClears() { try { var a = JSON.parse(localStorage.getItem(SCLEAR_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function sClearCount() { return sClears().length; }
  function addSClear(key) { var a = sClears(); if (a.indexOf(key) < 0) { a.push(key); try { localStorage.setItem(SCLEAR_KEY, JSON.stringify(a)); } catch (e) {} } return a.length; }
  function charNeed(id) { var i = LOCKED_CHARS.indexOf(id); return i < 0 ? 0 : (i + 1); }
  function charUnlocked(id) {
    if (id === "none" || id === "slash") return true;
    if (id === "lulan") return isUnlocked();
    var i = LOCKED_CHARS.indexOf(id);
    return i < 0 ? true : sClearCount() >= (i + 1);
  }
  function refreshGuitaristLocks() {
    var sel = els.guitaristSelect; if (!sel) return;
    [].forEach.call(sel.options, function (op) {
      if (!op.getAttribute("data-base")) op.setAttribute("data-base", op.textContent);
      var id = op.value, base = op.getAttribute("data-base");
      if (charUnlocked(id)) { op.textContent = base; op.disabled = false; }
      else {
        op.disabled = true;
        op.textContent = "🔒 " + base + (id === "lulan" ? "｜輸入解鎖密碼開放" : "｜需 " + charNeed(id) + " 首 S 級");
      }
    });
    if (sel.value && !charUnlocked(sel.value)) { sel.value = "slash"; guitaristId = "slash"; try { localStorage.setItem(GUITARIST_KEY, "slash"); } catch (e) {} }
  }
  function charName(id) { var sel = els.guitaristSelect; if (!sel) return id; var op = sel.querySelector('option[value="' + id + '"]'); return op ? (op.getAttribute("data-base") || op.textContent) : id; }

  // 密碼解鎖成功（完整）：付費教材＋嚕嚕安角色＋自己上傳無限
  function applyPasswordUnlock() {
    setUnlocked(true);
    updateOwnGateTip(); refreshGuitaristLocks(); renderLibUnlock();
    buildSampleList();                            // 重畫曲庫(付費鎖頭→已解鎖)
  }
  // Email 解鎖成功：只讓「自己上傳的譜」無限（不開放付費教材/角色）
  function applyEmailUnlock() {
    setEmailUnlocked(true);
    updateOwnGateTip(); renderLibUnlock();
  }
  // 購買解鎖的 Google 訂購表單（學生填完→老師收款→回傳解鎖密碼）
  var ORDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScwb4iexfUwKLuf5AHumcz0NpPJfcYM6W5V7fJDw5_1sxqrXQ/viewform";
  // 「嚕嚕安教材」欄位上的解鎖控制：HTML 片段
  function paidUnlockHtml() {
    if (isUnlocked())
      return '<div class="paid-unlock unlocked">🔓 <b>已解鎖</b>：自己上傳的譜無限使用，全部教材與嚕嚕安角色已開放。</div>';
    return '<div class="paid-unlock">' +
      '<div class="pu-tip">🔒 尚未解鎖：解鎖後<b>可無限使用</b>，並開放全部嚕嚕安教材與嚕嚕安角色。</div>' +
      '<div class="pu-row"><input type="password" class="pu-input" placeholder="輸入解鎖密碼" autocomplete="off" />' +
      '<button type="button" class="btn small pu-btn">解鎖</button></div>' +
      '<div class="pu-msg"></div>' +
      '</div>';
  }

  // 「我的曲庫」欄位上的解鎖：用 Email 讓自己上傳的譜無限（付費教材另需密碼，在教材欄位）＋購買連結
  function renderLibUnlock() {
    var box = document.getElementById("libUnlock"); if (!box) return;
    if (isPaid()) {   // 密碼或 Email 任一解鎖 → 自己上傳的譜已無限
      box.innerHTML = '<div class="paid-unlock unlocked">🔓 <b>已解鎖</b>：自己上傳的譜可無限使用。</div>';
      return;
    }
    box.innerHTML = '<div class="paid-unlock">' +
      '<div class="pu-tip">🔒 自己上傳的譜每天有免費次數上限。付款開通後，用你填在訂購單的 <b>Email</b> 解鎖，即可無限使用（嚕嚕安付費教材另需在下方教材欄位輸入密碼）。</div>' +
      '<div class="pu-row"><input type="email" class="lu-email" placeholder="輸入你的 Email 解鎖" autocomplete="email" />' +
      '<button type="button" class="btn small lu-btn">解鎖</button></div>' +
      '<div class="lu-msg"></div>' +
      '<a class="pu-buy" href="' + ORDER_FORM_URL + '" target="_blank" rel="noopener">🔓 還沒購買？點我購買解鎖（填訂購單）</a>' +
      '</div>';
    var inp = box.querySelector(".lu-email"), btn = box.querySelector(".lu-btn"), msg = box.querySelector(".lu-msg");
    function go() {
      var email = (inp.value || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "請輸入正確的 Email。"; msg.style.color = "#ff9a9a"; return; }
      var A = window.JianpuAuth;
      if (!A || !A.checkEmailUnlock) { msg.textContent = "後端尚未設定，暫時無法用 Email 解鎖（請洽老師 LINE：paul780516）。"; msg.style.color = "#ff9a9a"; return; }
      msg.textContent = "查詢中…"; msg.style.color = "#d7c9ac";
      A.checkEmailUnlock(email).then(function (ok) {
        if (ok === true) { try { localStorage.setItem("jianpu_unlock_email", email.toLowerCase()); } catch (e) {} applyEmailUnlock(); }
        else if (ok === false) { msg.textContent = "這個 Email 還沒開通。付款後老師會幫你開通，稍後再試 🙂"; msg.style.color = "#ffb454"; }
        else { msg.textContent = "後端尚未設定 Email 解鎖功能（請洽老師 LINE：paul780516）。"; msg.style.color = "#ff9a9a"; }
      });
    }
    btn.addEventListener("click", go);
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
  }
  // 綁定教材欄位上的解鎖輸入（buildSampleList 後呼叫）
  function wirePaidUnlock(root) {
    (root || document).querySelectorAll(".paid-unlock .pu-btn").forEach(function (btn) {
      var wrap = btn.closest(".paid-unlock");
      var inp = wrap.querySelector(".pu-input"), msg = wrap.querySelector(".pu-msg");
      function go() {
        verifyUnlockPw(inp.value).then(function (ok) {
          if (ok) { applyPasswordUnlock(); }   // 密碼→完整解鎖(教材/角色/自己上傳)
          else { msg.textContent = "密碼不對，再確認一下～（購買請洽老師 LINE：paul780516）"; msg.style.color = "#ff9a9a"; }
        });
      }
      btn.addEventListener("click", go);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    });
  }
  function focusPaidUnlock() {
    var inp = document.querySelector(".paid-unlock .pu-input");
    if (inp) { try { inp.focus(); inp.scrollIntoView({ block: "center" }); } catch (e) {} }
  }

  // ---- 付費資料夾：每個資料夾(grp)可各自上鎖＋各自密碼（後台設定，存 Supabase paid_folders）----
  var _paidFolders = {};   // {grp:{locked,pw_hash}}
  function loadPaidFolders() {
    var A = window.JianpuAuth;
    if (A && A.fetchFolders) A.fetchFolders().then(function (m) { _paidFolders = m || {}; buildSampleList(); }).catch(function () {});
  }
  function folderIsLocked(grp) { var f = _paidFolders[grp]; return !!(f && f.locked); }   // 沒設定=不上鎖(開放)
  function folderUnlocked(grp) {
    if (isUnlocked()) return true;                                                        // 主密碼=萬能鑰匙
    try { return localStorage.getItem("jianpu_folder_" + grp) === "1"; } catch (e) { return false; }
  }
  function setFolderUnlocked(grp) { try { localStorage.setItem("jianpu_folder_" + grp, "1"); } catch (e) {} }
  function verifyFolderPw(grp, pw) {
    var f = _paidFolders[grp];
    if (!f || !f.pw_hash) return Promise.resolve(false);
    return sha256hex((pw || "").trim()).then(function (h) { return h === String(f.pw_hash).toLowerCase(); }).catch(function () { return false; });
  }
  // 每個上鎖資料夾標題下方的解鎖控制
  function folderUnlockHtml(grp) {
    return '<div class="paid-unlock" data-grp="' + escapeHtml(grp) + '">' +
      '<div class="pu-tip">🔒 這個資料夾需要密碼才能玩。輸入本資料夾的解鎖密碼：</div>' +
      '<div class="pu-row"><input type="password" class="fu-input" placeholder="輸入密碼" autocomplete="off" />' +
      '<button type="button" class="btn small fu-btn">解鎖</button></div>' +
      '<div class="fu-msg"></div></div>';
  }
  function wireFolderUnlock(root) {
    (root || document).querySelectorAll(".paid-unlock[data-grp] .fu-btn").forEach(function (btn) {
      var wrap = btn.closest(".paid-unlock"), grp = wrap.getAttribute("data-grp");
      var inp = wrap.querySelector(".fu-input"), msg = wrap.querySelector(".fu-msg");
      function go() {
        verifyFolderPw(grp, inp.value).then(function (ok) {
          if (ok) { setFolderUnlocked(grp); buildSampleList(); }
          else { msg.textContent = "密碼不對，再確認一下～"; msg.style.color = "#ff9a9a"; }
        });
      }
      btn.addEventListener("click", go);
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    });
  }

  function loadFile(file) {
    if (!gateOwnUse()) { setStatus(ownGateBlockedMsg(), true); return; }
    setStatus("解析中：" + file.name + " …");
    var reader = new FileReader();
    reader.onload = function () { loadArrayBuffer(reader.result, file.name); };
    reader.onerror = function () { setStatus("讀取檔案失敗。", true); };
    reader.readAsArrayBuffer(file);
  }

  function loadArrayBuffer(arrayBuffer, name) {
    try {
      var scoreObj = GP.parseBytes(arrayBuffer);
      window._score = scoreObj;
      var tracks = GP.listTracks(scoreObj);
      var best = -1, bestCount = -1, html = "";
      tracks.forEach(function (tr) {
        var tag = tr.isPercussion ? "（打擊）" : "";
        html += '<option value="' + tr.index + '">' + escapeHtml(tr.name) + tag + '｜' + tr.noteCount + ' 音</option>';
        if (!tr.isPercussion && tr.noteCount > bestCount) { bestCount = tr.noteCount; best = tr.index; }
      });
      els.trackSelect.innerHTML = html;
      if (best >= 0) els.trackSelect.value = String(best);
      els.keySelect.value = "auto";
      rebuildTimeline();
      setStatus("已載入「" + (scoreObj.title || name || "") + "」，可調整設定後開始。");
      els.startBtn.disabled = false;
      state = "ready";
    } catch (err) {
      console.error(err);
      setStatus("解析失敗：" + (err && err.message ? err.message : err), true);
      els.startBtn.disabled = true;
    }
  }

  function rebuildTimeline() {
    if (!window._score) return;
    displayMode = els.displaySelect.value;
    var ti = parseInt(els.trackSelect.value, 10) || 0;
    timeline = GP.buildTimeline(window._score, ti);                                  // 旋律(頂音) + 中繼資料
    tabTL = GP.buildTabTimeline(window._score, ti);       // 一律建立(六線譜/Rocksmith 逐拍＋節拍器拍點皆需要)
    if (tabTL) tabInfo = { tuning: tabTL.tuning, stringCount: tabTL.stringCount };
    tonicPc = (els.keySelect.value === "auto") ? timeline.tonicPc : T.keyValueToPc(els.keySelect.value);
    speed = parseFloat(els.speedRange.value) || 1;
    buildItems();
    updateSongInfo();
    renderLeaderboard();
  }

  // 只做縮放與映射（不重新解析），供換設定與拖倍速時便宜重算
  function buildItems() {
    var inv = 1 / speed;
    melodyNotes = timeline.notes.map(function (n) { return { time: n.time * inv, dur: n.dur * inv, midi: n.midi, bend: n.bend || 0 }; });
    songDuration = timeline.durationSec * inv;
    if (usesTabData()) {
      items = tabTL.beats.map(function (beat) {
        var deadNotes = (beat.dead || []).map(function (dn) {         // 死音/悶音(X)：無音高，只算弦位供顯示
          var drow = Math.max(0, Math.min(tabTL.stringCount - 1, tabTL.stringCount - dn.string));
          return { string: dn.string, fret: dn.fret, row: drow };
        });
        var notes = beat.notes.map(function (n) {
          var d = T.midiToDegree(n.midi, tonicPc);
          var row = tabTL.tuning.indexOf(n.midi - n.fret);
          if (row < 0) row = tabTL.stringCount - n.string;
          row = Math.max(0, Math.min(tabTL.stringCount - 1, row));
          var linkRow = null, linkTime = null, linkFret = null;
          if (n.link) {
            var lr = tabTL.tuning.indexOf(n.link.midi - n.link.fret);
            if (lr < 0) lr = tabTL.stringCount - n.link.string;
            linkRow = Math.max(0, Math.min(tabTL.stringCount - 1, lr));
            linkTime = n.link.time * inv; linkFret = n.link.fret;
          }
          return { string: n.string, fret: n.fret, midi: n.midi, pc: pc(n.midi), degree: d.degree, alter: d.alter, row: row,
                   bend: n.bend || 0, hammerOrigin: n.hammerOrigin, hammerDest: n.hammerDest, slideOut: n.slideOut || 0, slideIn: n.slideIn || 0,
                   vibrato: n.vibrato || 0, palmMute: n.palmMute, harmonic: n.harmonic || 0,
                   trill: !!n.trill, letRing: !!n.letRing, staccato: !!n.staccato,
                   tap: !!(n.tapLH || beat.tap), tremolo: !!beat.tremolo, slap: !!beat.slap, pop: !!beat.pop,
                   chordNote: !!beat.chord,                                  // 屬於和弦的單音→六線譜上特別標注
                   linkRow: linkRow, linkTime: linkTime, linkFret: linkFret };
        });
        if (!notes.length) {                                         // 純死音/悶音拍：只在六線譜顯示 X，不進判定（judged 直接為 true）
          return { time: beat.time * inv, dur: beat.dur * inv, notes: [], deadNotes: deadNotes, deadOnly: true,
                   pcs: [], degSet: [], lane: -1, midi: null, bend: 0, topTech: false, bar: beat.bar,
                   nv: beat.nv, dots: beat.dots || 0, tuplet: beat.tuplet || null,
                   judged: true, hit: false, missed: false, tier: null };
        }
        var pcs = [], degs = [], top = notes[0];
        notes.forEach(function (n) {
          if (pcs.indexOf(n.pc) < 0) pcs.push(n.pc);
          if (degs.indexOf(n.degree) < 0) degs.push(n.degree);
          if (n.midi > top.midi) top = n;
        });
        return { time: beat.time * inv, dur: beat.dur * inv, notes: notes, deadNotes: deadNotes, pcs: pcs, degSet: degs,
                 lane: top.degree - 1, midi: top.midi, bend: top.bend || 0, topTech: noteHasTech(top), bar: beat.bar,
                 chord: beat.chord || "",
                 nv: beat.nv, dots: beat.dots || 0, tuplet: beat.tuplet || null,
                 judged: false, hit: false, missed: false, tier: null };
      });
      var topMidis = items.filter(function (it) { return !it.deadOnly; }).map(function (it) { return it.midi; });
      var octFn2 = T.makeOctaveOffsetFn(topMidis, tonicPc);
      items.forEach(function (it) {
        if (it.deadOnly) return;                                     // 純死音拍無音高，跳過簡譜級數計算
        var d = T.midiToDegree(it.midi, tonicPc);
        it.jianpu = { degree: d.degree, alter: d.alter, symbol: T.accSymbol(d.alter), octaveOffset: octFn2(it.midi), tech: it.topTech };
      });
    } else {
      var midis = timeline.notes.map(function (n) { return n.midi; });
      var octFn = T.makeOctaveOffsetFn(midis, tonicPc);
      items = timeline.notes.map(function (n) {
        var d = T.midiToDegree(n.midi, tonicPc);
        return { time: n.time * inv, dur: n.dur * inv, midi: n.midi, degree: d.degree, alter: d.alter,
                 octaveOffset: octFn(n.midi), lane: d.degree - 1, symbol: T.accSymbol(d.alter),
                 pc: pc(n.midi), pcs: [pc(n.midi)], degSet: [d.degree], bend: n.bend || 0,
                 judged: false, hit: false, missed: false, tier: null };
      });
    }
    barStartsScaled = (tabTL.barStarts || []).map(function (t) { return t * inv; });
    buildBeatGrid();
  }

  // 依小節起點細分出每一拍（供節拍器/鼓；自動吻合變速與拍號）
  function buildBeatGrid() {
    beatTimes = []; beatAccents = []; beatInBar = []; beatDurs = []; beatsPerBar = [];
    var spb = 60 / (timeline.tempo || 120) / speed;           // 一拍約幾秒(已含倍速)
    if (spb <= 0) return;
    var bars = barStartsScaled, end = songDuration || (bars.length ? bars[bars.length - 1] + spb * 4 : 0);
    for (var i = 0; i < bars.length; i++) {
      var start = bars[i], next = (i + 1 < bars.length) ? bars[i + 1] : end;
      var nb = Math.max(1, Math.round((next - start) / spb)), bd = (next - start) / nb;
      for (var b = 0; b < nb; b++) { beatTimes.push(start + b * bd); beatAccents.push(b === 0); beatInBar.push(b); beatDurs.push(bd); beatsPerBar.push(nb); }
    }
    if (!beatTimes.length && end > 0) {                        // 沒有小節資訊時退回等距 4/4
      for (var t = 0, k = 0; t < end; t += spb, k++) { beatTimes.push(t); beatAccents.push(k % 4 === 0); beatInBar.push(k % 4); beatDurs.push(spb); beatsPerBar.push(4); }
    }
  }

  // 各曲風鼓組 pattern：給小節內第 b 拍，回傳該拍要打的 [{f:拍內比例, v:聲部, g:音量}]
  var GROOVES = {
    rock: function (b) {
      var h = [{ f: 0, v: "hat" }, { f: 0.5, v: "hat" }];
      h.push({ f: 0, v: (b % 2 === 0) ? "kick" : "snare" });
      return h;
    },
    metal: function (b) {
      var h = [{ f: 0, v: "hat" }, { f: 0.5, v: "hat" }, { f: 0, v: "kick" }, { f: 0.5, v: "kick" }];
      if (b % 2 === 1) h.push({ f: 0, v: "snare" });
      return h;
    },
    folk: function (b) {
      var h = [{ f: 0, v: "hat", g: 0.7 }];
      h.push({ f: 0, v: (b % 2 === 0) ? "kick" : "snare", g: 0.8 });
      return h;
    },
    funk: function (b) {
      var h = [{ f: 0, v: "hat" }, { f: 0.25, v: "hat", g: 0.55 }, { f: 0.5, v: "hat" }, { f: 0.75, v: "hat", g: 0.55 }];
      if (b % 2 === 1) h.push({ f: 0, v: "snare" });                       // 2 & 4
      if (b === 0) h.push({ f: 0, v: "kick" });
      if (b === 1) h.push({ f: 0.75, v: "kick", g: 0.8 });                 // 切分
      if (b === 2) { h.push({ f: 0, v: "kick" }); h.push({ f: 0.5, v: "kick", g: 0.7 }); }
      if (b === 3) h.push({ f: 0.25, v: "kick", g: 0.75 });
      return h;
    }
  };

  // 排程第 idx 拍的鼓＋伴奏
  function scheduleGroove(idx) {
    var bt = beatTimes[idx], bd = beatDurs[idx] || 0.5, b = beatInBar[idx] || 0;
    var fn = GROOVES[genre]; if (!fn) return;
    var hits = fn(b), rootMidi = 36 + tonicPc;                              // 低音根音(約 C2)
    for (var i = 0; i < hits.length; i++) {
      var hh = hits[i], at = A.songTimeToCtx(bt + hh.f * bd), g = hh.g || 1;
      if (hh.v === "kick") { A.kick(at, g); A.bassNote(rootMidi, at, bd * 0.9, 1); }   // bass 跟大鼓
      else if (hh.v === "snare") A.snare(at, g);
      else if (hh.v === "hat") A.hat(at, g);
      else if (hh.v === "crash") A.crash(at, g);
    }
    if (b === 0) {                                                          // 小節首：和弦鋪底(主和弦)
      var barLen = bd * (beatsPerBar[idx] || 4), pad = 48 + tonicPc;
      A.chordPad([pad, pad + 4, pad + 7], A.songTimeToCtx(bt), barLen * 0.98, 1);
    }
  }

  function fmtSpeed(s) { return (Math.round(s * 100) / 100) + "×"; }
  function updateSpeedLabel() { els.speedVal.textContent = (speed === 1) ? "1×（正常）" : fmtSpeed(speed); }
  function updateSongInfo() {
    var keyName = keyDisplay(tonicPc);
    var countLabel = usesTabData() ? (items.length + " 拍（" + dispName() + "）") : (items.length + " 音（簡譜）");
    var speedTxt = (speed === 1) ? "" : ('　｜　倍速：' + fmtSpeed(speed) + '（實際 ' + fmtTime(songDuration) + '）');
    els.songInfo.innerHTML =
      '<div class="si-title">' + escapeHtml(timeline.title) +
      (timeline.artist ? ' <span class="si-artist">— ' + escapeHtml(timeline.artist) + '</span>' : '') + '</div>' +
      '<div class="si-meta">軌道：' + escapeHtml(timeline.trackName) +
      '　｜　調性：' + keyName + ' 大調（1=' + keyName + '）' +
      '　｜　速度：' + Math.round(timeline.tempo) + ' BPM' +
      '　｜　' + countLabel +
      '　｜　長度：' + fmtTime(timeline.durationSec) + speedTxt + '</div>';
  }

  function pc(midi) { return ((midi % 12) + 12) % 12; }
  // 是否帶技巧（推弦/搥勾/滑音/揉弦/悶音/泛音/點弦/顫音/震音/延音/斷奏）→ 決定是否上色
  function noteHasTech(n) {
    return !!(n && (n.bend > 0 || n.hammerOrigin || n.hammerDest || n.slideOut || n.slideIn || n.vibrato ||
                    n.palmMute || n.harmonic || n.trill || n.tremolo || n.tap || n.letRing || n.staccato));
  }
  function keyDisplay(p) { return T.tonicPcToKeyValue(p).replace("#", "♯").replace("b", "♭"); }
  function noteName(midi) { return NOTE_NAMES[pc(midi)] + (Math.floor(midi / 12) - 1); }
  function windows() {
    var slack = inputMode === "mic" ? 0.05 : 0;
    return { perfect: W_PERFECT + slack * 0.6, great: W_GREAT + slack, good: W_GOOD + slack };
  }

  // ---- 遊戲流程 ----
  function startGame() {
    if (!items || !items.length) { setStatus("這個軌道／模式沒有可玩的音符，換一軌試試。", true); return; }
    if (micTesting) toggleMicTest();
    inputMode = els.inputSelect.value;
    displayMode = els.displaySelect.value;

    if (inputMode === "mic") {
      if (!P.isSupported()) {
        setStatus("此環境無法取用麥克風（需 https 或 http://localhost）。請改用鍵盤，或用本機伺服器開啟頁面。", true);
        return;
      }
      setStatus("正在要求麥克風權限…");
      P.start(micDeviceId()).then(function () { beginGame(); }).catch(function (err) {
        setStatus("無法取用麥克風：" + (err && err.message ? err.message : err), true);
      });
    } else {
      P.stop();
      beginGame();
    }
  }

  function beginGame() {
    items.forEach(function (n) {
      n.hit = false; n.missed = false; n.tier = null;
      n.judged = !!n.deadOnly;                       // 純死音拍永遠 judged(只顯示不判定)，其餘重置為未判定
    });
    score = 0; current = { combo: 0, maxCombo: 0 };
    comboBurst = { t: 999, level: 0 }; hypeShown = 0;
    stats = { perfect: 0, great: 0, good: 0, miss: 0 };
    popups = [];
    laneFlash = new Array(LANES).fill(0);
    padFlash = new Array(LANES).fill(0);
    micCand = -1; micStable = 0; micLastPc = -1; micWasSilent = true; micDisp = { midi: null, rms: 0, t: 0 };
    micPeak = 0; micArmed = true; micLastHit = -9;
    _metroIdx = 0; _grooveIdx = 0;

    els.setupPanel.classList.add("hidden");
    els.gameWrap.classList.remove("hidden");
    els.result.classList.add("hidden");
    els.micHud.classList.toggle("hidden", inputMode !== "mic");
    updateFretControls();
    resize();
    layoutPad();

    var melodyOn = els.melodyToggle.checked;         // 依勾選播放旋律導引（收音時建議戴耳機避免回授）
    // 依曲速決定倒數每拍秒數；開場先顯示「準備」，再倒數 4 拍(4-3-2-1)
    var bp = (beatTimes && beatTimes.length >= 2) ? (beatTimes[1] - beatTimes[0]) : 0.5;
    countBeat = Math.min(1.1, Math.max(0.34, bp || 0.5));
    var countIn = 4 * countBeat;
    var leadIn = Math.max(travel + 0.3, countIn + 1.3);   // 前置留「準備」時間，再接 4 拍倒數
    A.start(melodyNotes, leadIn, melodyOn);         // 已依倍速縮放
    A.setMelodyOn(melodyOn);

    var modeTxt = dispName() + "／" + (inputMode === "mic" ? "收音" : "鍵盤");
    els.hudTitle.textContent = timeline.title + "（1=" + keyDisplay(tonicPc) + "・" + modeTxt + "）";
    els.pauseBtn.textContent = "⏸ 暫停";
    state = "playing";
    _lastBeep = 99;
  }

  function backToSetup() {
    state = "ready";
    A.pause();
    P.stop();
    els.gameWrap.classList.add("hidden");
    els.result.classList.add("hidden");
    els.setupPanel.classList.remove("hidden");
    setStatus("已載入「" + (timeline ? timeline.title : "") + "」，可調整設定後開始。");
    renderLeaderboard();
  }

  function togglePause() {
    if (state === "playing") { state = "paused"; A.pause(); els.pauseBtn.textContent = "▶ 繼續"; }
    else if (state === "paused") { state = "playing"; A.resume(); els.pauseBtn.textContent = "⏸ 暫停"; }
  }

  // ---- 輸入 ----
  function onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === "Space") {
      if (state === "playing" || state === "paused") { e.preventDefault(); togglePause(); }
      return;
    }
    if (e.code === "Escape") { if (state === "playing" || state === "paused") backToSetup(); return; }
    if (state !== "playing") return;
    var lane = LANE_KEYS.indexOf(e.key);
    if (lane < 0) { var m = e.code.match(/^(?:Digit|Numpad)([1-7])$/); if (m) lane = parseInt(m[1], 10) - 1; }
    if (lane < 0) return;
    e.preventDefault();
    var deg = lane + 1;
    attemptHit(function (it) { return it.degSet.indexOf(deg) >= 0; }, lane);
  }

  // 泛用命中：找最接近、在窗內、且符合 matchFn 的未判定項目
  function attemptHit(matchFn, flashLane) {
    if (flashLane != null) {
      padFlash[flashLane] = 1;
      if (displayMode === "jianpu") laneFlash[flashLane] = 1;
    }
    var win = windows();
    var songTime = A.getSongTime() - (inputMode === "mic" ? micLatencyMs / 1000 : 0) - JUDGE_OFFSET;
    var best = null, bestDelta = 1e9;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.judged || !matchFn(it)) continue;
      var d = Math.abs(it.time - songTime);
      if (d < bestDelta) { bestDelta = d; best = it; }
    }
    if (best && bestDelta <= win.good) { judge(best, bestDelta, win); return true; }
    if (inputMode !== "mic") A.click(false);   // 收音時不發空擊「喀」音效（彈真吉他只聽自己的聲音）
    return false;
  }

  // 連段倍數：每 10 連段升 1 級，最高 ×5（貼近 Trombone Champ 的倍數感）
  function comboMult(c) { return Math.min(5, 1 + Math.floor(c / 10)); }

  function judge(n, delta, win) {
    var tier = delta <= win.perfect ? "perfect" : delta <= win.great ? "great" : "good";
    n.judged = true; n.hit = true; n.tier = tier;
    stats[tier]++;
    var prevMult = comboMult(current.combo);
    current.combo++;
    if (current.combo > current.maxCombo) current.maxCombo = current.combo;
    if (comboMult(current.combo) > prevMult) {           // 升上新連段段位(每10連段)→觸發慶祝爆發動畫
      comboBurst = { t: 0, level: comboMult(current.combo) };
      if (inputMode !== "mic") A.crash(A.now());          // 一記鈸聲慶祝(收音時不疊合成音)
    }
    score += Math.round(SCORE[tier] * comboMult(current.combo));
    laneFlash[n.lane] = 1;
    if (displayMode === "rocksmith" && n.notes) n.notes.forEach(function (nn) { flashByString[5 - nn.row] = 1; });
    if (inputMode !== "mic") A.click(true);   // 收音時不發命中「喀」音效（彈真吉他只聽自己的聲音）
    if (inputMode !== "mic" && !els.melodyToggle.checked) A.playNote(n.midi, n.dur || 0.25, (n.bend || 0) / 2);   // 收音時不播回饋音（彈真吉他不需疊合成音）
    popups.push({ lane: n.lane, tier: tier, t: 0 });
    bigJudge = { tier: tier, t: 0, combo: current.combo }; charPulse = 1;   // 右側大字動畫 + 吉他手彈跳
  }

  // ---- 迴圈 ----
  var _lastBeep = 99;
  function loop() {
    if (state === "playing") {
      A.update();
      var songTime = A.getSongTime();

      // 收音輸入
      if (inputMode === "mic" && P.isActive()) micTick(songTime);

      // 倒數嗶聲
      if (songTime < 0) {
        var countIn = 4 * countBeat;
        if (songTime >= -countIn) {                                  // 進入 4 拍倒數才逐拍嗶
          var c = Math.min(4, Math.ceil(-songTime / countBeat));
          if (c !== _lastBeep) { A.beep(false); _lastBeep = c; }
        }
      } else if (_lastBeep !== 0) { A.beep(true); _lastBeep = 0; }

      // 節拍器（依拍點排程，稍微提前排程以求準時）；選了曲風伴奏時自動內含節拍器click，與伴奏結合成一體
      var metroOn = true;   // 節拍器固定開啟（開關選項已移除）
      if (metroOn) {
        while (_metroIdx < beatTimes.length && beatTimes[_metroIdx] <= songTime + 0.12) {
          var bt = beatTimes[_metroIdx];
          if (bt >= songTime - 0.05) A.metronomeAt(A.songTimeToCtx(bt), beatAccents[_metroIdx]);
          _metroIdx++;
        }
      } else {
        while (_metroIdx < beatTimes.length && beatTimes[_metroIdx] <= songTime + 0.12) _metroIdx++;   // 關閉時仍推進索引
      }

      // 曲風鼓組＋伴奏（依拍點提前排程）
      if (genre !== "none") {
        while (_grooveIdx < beatTimes.length && beatTimes[_grooveIdx] <= songTime + 0.25) {
          if (beatTimes[_grooveIdx] >= songTime - 0.05) scheduleGroove(_grooveIdx);
          _grooveIdx++;
        }
      } else {
        while (_grooveIdx < beatTimes.length && beatTimes[_grooveIdx] <= songTime + 0.25) _grooveIdx++;
      }

      // 漏接判定
      for (var i = 0; i < items.length; i++) {
        var n = items[i];
        if (!n.judged && (songTime - JUDGE_OFFSET) - n.time > W_MISS) {
          n.judged = true; n.missed = true; n.tier = "miss";
          stats.miss++; current.combo = 0;
          popups.push({ lane: n.lane, tier: "miss", t: 0 });
          bigJudge = { tier: "miss", t: 0, combo: 0 };
        }
      }

      if (songTime > songDuration + 1.2) {
        var pending = false;
        for (var j = 0; j < items.length; j++) if (!items[j].judged) { pending = true; break; }
        if (!pending) endGame();
      }
    }
    render();
    requestAnimationFrame(loop);
  }

  function micTick(songTime) {
    var p = P.read();
    micDisp = { midi: p.midi, rms: p.rms, t: 0 };
    updateMicHud(p);
    var rms = p.rms || 0;
    micPeak = Math.max(rms, micPeak * 0.92);                        // 峰值追隨器(快升慢降)：偵測「重新撥弦」造成的能量起伏
    if (p.midi != null && rms > micGate) {
      if (p.pc === micCand) micStable++; else { micCand = p.pc; micStable = 1; }
      var pitchChanged = (p.pc !== micLastPc);
      // 觸發新命中：音高穩定 ≥2 幀，且(換了音高 或 剛從靜音/能量低谷重新起音)，並過了 70ms 不反應期(避免一次撥弦被拆成兩下)
      if (micStable >= 2 && (pitchChanged || micArmed) && (songTime - micLastHit) > 0.07) {
        micLastPc = p.pc; micWasSilent = false; micArmed = false; micLastHit = songTime;
        var detectedPc = p.pc;
        attemptHit(function (it) {                                  // 容許音準 ±MIC_PITCH_TOL 半音偏移(circular)
          return it.pcs.some(function (pc) { var dd = Math.abs(pc - detectedPc); return Math.min(dd, 12 - dd) <= MIC_PITCH_TOL; });
        }, T.midiToDegree(p.midi, tonicPc).degree - 1);
      }
      // 能量相對峰值明顯回落 → 重新武裝：同一個音再撥一次、或搥勾/連奏後的音，才不會漏判被 Miss
      if (rms < micPeak * 0.6) micArmed = true;
    } else {
      micCand = -1; micStable = 0; micWasSilent = true; micArmed = true; micLastPc = -1; micPeak *= 0.5;
    }
  }

  function updateMicHud(p) {
    if (p && p.midi != null) {
      var d = T.midiToDegree(p.midi, tonicPc);
      els.micNote.textContent = noteName(p.midi) + " · " + T.accSymbol(d.alter) + d.degree;
    } else {
      els.micNote.textContent = "—";
    }
    var lvl = Math.max(0, Math.min(100, (p ? p.rms : 0) * 700));
    els.micLevel.style.width = lvl + "%";
  }

  function endGame() {
    state = "result";
    A.pause();
    P.stop();
    var total = stats.perfect + stats.great + stats.good + stats.miss;
    var accSum = stats.perfect * ACC.perfect + stats.great * ACC.great + stats.good * ACC.good;
    var acc = total ? (accSum / total * 100) : 0;
    var grade = acc >= 95 ? "S" : acc >= 88 ? "A" : acc >= 78 ? "B" : acc >= 65 ? "C" : "D";
    var gc = gradeColor(grade);
    // 存檔 + 判斷是否破紀錄
    var prevList = loadAllScores()[songKeyOf()] || [];
    var prevBest = prevList.length ? prevList[0].score : 0;
    var rec = { key: songKeyOf(), song: timeline.title, track: timeline.trackName, mode: modeLabel(),
                score: score, acc: acc, grade: grade, combo: current.maxCombo, date: Date.now() };
    var list = saveScoreRecord(rec);
    var isNew = score > prevBest;
    var rank = list.indexOf(rec) + 1;
    // S 級 → 記錄該曲，達門檻就解鎖新角色並提示
    var unlockMsg = "";
    if (grade === "S") {
      var before = sClearCount();
      var after = addSClear(songKeyOf());
      if (after > before) {
        refreshGuitaristLocks();
        if (after >= 1 && after <= LOCKED_CHARS.length) {
          var newId = LOCKED_CHARS[after - 1];
          unlockMsg = '<div class="new-record" style="color:#ffd93d">🎉 累積 ' + after + ' 首 S 級，解鎖新角色：' + escapeHtml(charName(newId)) + '！</div>';
        }
        var nextNeed = after + 1;
        if (!unlockMsg && nextNeed <= LOCKED_CHARS.length)
          unlockMsg = '<div class="racc">已 ' + after + ' 首 S 級 · 再 1 首解鎖「' + escapeHtml(charName(LOCKED_CHARS[nextNeed - 1])) + '」</div>';
      }
    }
    els.resultBody.innerHTML =
      '<div class="grade" style="color:' + gc + '">' + grade + '</div>' +
      (isNew ? '<div class="new-record">🎉 新紀錄！</div>' : '') +
      unlockMsg +
      '<div class="rscore">' + score.toLocaleString() + ' 分</div>' +
      '<div class="racc">準確率 ' + acc.toFixed(2) + '%　｜　最大連段 ' + current.maxCombo + '</div>' +
      (!isNew && prevBest ? '<div class="racc">本曲最佳 ' + prevBest.toLocaleString() + '　｜　本次排名第 ' + rank + '</div>' : '') +
      '<div class="rjudge">' +
        chip("Perfect", stats.perfect, "#ffd93d") + chip("Great", stats.great, "#5ec26a") +
        chip("Good", stats.good, "#5b8def") + chip("Miss", stats.miss, "#ff5d6c") + '</div>';
    els.result.classList.remove("hidden");
  }
  function chip(name, n, color) { return '<div class="chip"><span style="color:' + color + '">' + name + '</span><b>' + n + '</b></div>'; }

  // HUD 指板相關下拉的顯示切換（只在六線譜顯示；範圍/樣式只在指板檢視顯示）
  function updateFretControls() {
    var tab = (displayMode === "tab");
    els.bottomSelect.style.display = tab ? "" : "none";
    var showFret = tab && els.bottomSelect.value === "fretboard";
    els.fretWindowSelect.style.display = showFret ? "" : "none";
    els.fretStyleSelect.style.display = showFret ? "" : "none";
  }

  // ---- 繪圖 ----
  function resize() {
    dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    judgeY = H - 96;
    layoutPad();
    travel = computeTravel();   // 依實際畫面尺寸換算，鎖定舒適的像素速度
  }

  // 下落所需秒數：距離 / 目標速度，但不短於最短預視秒數
  function computeTravel() {
    var f = DIFFICULTY[els.difficultySelect.value] || DIFFICULTY.normal;
    var dist;
    if (displayMode === "tab") { var hitX = 54 + (W - 54) * 0.18; dist = W - hitX; }
    else dist = judgeY;
    if (!dist || dist <= 0) return f.lead;
    return Math.max(f.lead, dist / f.vel);
  }

  // 底部觸控鍵盤幾何（不依賴繪製，開場即可用於觸控命中判定）
  function layoutPad() {
    if (displayMode === "rocksmith") pad = null;                 // 公路模式：鍵盤/收音，無觸控琴格
    else pad = (displayMode === "tab") ? { y0: H - 64, h: 56 } : { y0: judgeY + 8, h: 74 };
  }
  function laneX(l) { return l * (W / LANES); }
  function laneW() { return W / LANES; }
  function usesTabData() { return displayMode === "tab" || displayMode === "rocksmith"; }  // 六線譜與 Rocksmith 皆用弦/格資料
  function dispName() { return displayMode === "tab" ? "六線譜" : displayMode === "rocksmith" ? "搖滾史密斯" : "簡譜"; }

  // 舞台背景（或自訂背景圖）
  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1b1030"); g.addColorStop(0.55, "#120a1e"); g.addColorStop(1, "#0a0710");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var st = (state === "playing") ? A.getSongTime() : 0;
    // 選閃電嚕嚕安 → 綁定他的專屬照片(滿版背景，優先於上傳圖與程序舞台)
    var lockBg = (guitaristId === "lulan" && lulanBg.complete && lulanBg.naturalWidth) ? lulanBg : null;
    var bg = lockBg || bgImage;
    stageProcedural = !bg;                         // 無背景圖時才畫程序化舞台(升降台/觀眾)
    if (bg) {
      var alpha = lockBg ? 1.0 : bgOpacity;
      var ir = bg.width / bg.height, cr = W / H, dw, dh;
      if (ir > cr) { dh = H; dw = H * ir; } else { dw = W; dh = W / ir; }
      ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(bg, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.restore();
    } else {
      var hy = hypeShown;
      // 基本兩盞聚光燈（越嗨越亮）
      drawSpotlight(W * 0.28 + Math.sin(st * 0.7) * 45, "255,150,70", 1 + hy * 0.6);
      drawSpotlight(W * 0.72 + Math.sin(st * 0.9 + 1) * 45, "90,150,255", 1 + hy * 0.6);
      // 連段越高→加開更多彩色聚光燈、掃動更大
      var extra = Math.round(hy * 4);              // 0..4 盞
      var cols = ["255,80,120", "120,255,150", "255,220,80", "180,120,255"];
      for (var i = 0; i < extra; i++) {
        var bx = W * (0.12 + 0.76 * ((i + 0.5) / 4)) + Math.sin(st * (1.1 + i * 0.35) + i) * 80;
        drawSpotlight(bx, cols[i % cols.length], 0.55 + hy * 0.9);
      }
      // 閃電嚕嚕安→舞台後方擺各種重訓設備(深色剪影)，人物照常站在舞台上
      if (guitaristId === "lulan") drawGymBackdrop(st, hy);
      // 舞台地板(較明顯)：漸層地面＋前緣亮線，讓「舞台」更清楚
      var fY = H * 0.82;
      var fg = ctx.createLinearGradient(0, fY, 0, H);
      fg.addColorStop(0, "rgba(255,255,255," + (0.05 + hy * 0.05) + ")"); fg.addColorStop(1, "rgba(255,255,255,0.01)");
      ctx.fillStyle = fg; ctx.fillRect(0, fY, W, H - fY);
      ctx.fillStyle = "rgba(150,180,255," + (0.15 + hy * 0.25) + ")"; ctx.fillRect(0, fY, W, 2);   // 舞台前緣線
    }
    ctx.fillStyle = "rgba(8,8,14,0.42)"; ctx.fillRect(0, 0, W, H);   // scrim 提升可讀性
    var v = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.78);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    // 台下觀眾改到 drawGuitarist 之後畫(前景)，才會在舞台前面/下面，不被舞台蓋住
  }
  function drawSpotlight(topX, rgb, k) {
    k = (k == null) ? 1 : k;
    var grad = ctx.createLinearGradient(topX, 0, W / 2, H);
    grad.addColorStop(0, "rgba(" + rgb + "," + (0.18 * k) + ")"); grad.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(topX, -10); ctx.lineTo(topX - 170, H); ctx.lineTo(topX + 170, H); ctx.closePath(); ctx.fill();
  }

  // 重訓設備背景牆（閃電嚕嚕安專屬）：深藍鋼鐵剪影＋微弱邊光，擺在舞台後方
  function drawGymBackdrop(st, hy) {
    var baseY = H * 0.80;                                   // 設備底線(貼近舞台地板)
    var u = Math.min(W, H) * 0.11;                          // 尺寸單位
    var fill = "rgba(14,16,26,0.94)", edge = "rgba(120,150,255," + (0.22 + hy * 0.25) + ")";
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    function bar(x, y, w, h, r) { ctx.fillStyle = fill; roundRect(x, y, w, h, r || 3); ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 1.5; roundRect(x, y, w, h, r || 3); ctx.stroke(); }
    function plate(cx, cy, rw, rh) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2); ctx.stroke(); }

    // 深蹲架（左側）：兩根立柱＋橫桿＋掛著的槓片
    (function () {
      var x = W * 0.06, w = u * 1.7, top = baseY - u * 2.6;
      bar(x, top, u * 0.16, u * 2.6, 4); bar(x + w, top, u * 0.16, u * 2.6, 4);      // 立柱
      bar(x - u * 0.1, top + u * 0.2, w + u * 0.36, u * 0.16, 4);                     // 頂橫桿
      var by = top + u * 1.0;                                                          // 架上槓鈴
      bar(x - u * 0.5, by, w + u * 1.16, u * 0.12, 6);
      plate(x + u * 0.05, by + u * 0.06, u * 0.12, u * 0.5); plate(x - u * 0.15, by + u * 0.06, u * 0.1, u * 0.42);
      plate(x + w + u * 0.11, by + u * 0.06, u * 0.12, u * 0.5); plate(x + w + u * 0.31, by + u * 0.06, u * 0.1, u * 0.42);
    })();

    // 啞鈴架（中偏右）：斜台上兩層小啞鈴
    (function () {
      var x = W * 0.62, w = u * 2.2, top = baseY - u * 1.0;
      bar(x, top, w, u * 0.14, 4); bar(x, top + u * 0.5, w, u * 0.14, 4);             // 兩層架板
      bar(x - u * 0.05, top - u * 0.05, u * 0.1, u * 1.1, 3); bar(x + w - u * 0.05, top - u * 0.05, u * 0.1, u * 1.1, 3);
      for (var i = 0; i < 4; i++) {                                                    // 一排小啞鈴(球端)
        var dx = x + u * 0.35 + i * u * 0.5;
        plate(dx - u * 0.14, top - u * 0.02, u * 0.12, u * 0.16); plate(dx + u * 0.14, top - u * 0.02, u * 0.12, u * 0.16);
        bar(dx - u * 0.12, top - u * 0.06, u * 0.24, u * 0.08, 3);
        plate(dx - u * 0.13, top + u * 0.48, u * 0.11, u * 0.14); plate(dx + u * 0.13, top + u * 0.48, u * 0.11, u * 0.14);
      }
    })();

    // 臥推長凳（右下角）：座墊＋斜腳
    (function () {
      var x = W * 0.86, w = u * 1.4, y = baseY - u * 0.35;
      bar(x, y, w, u * 0.2, 5);
      ctx.strokeStyle = edge; ctx.lineWidth = Math.max(2, u * 0.08); ctx.fillStyle = fill;
      ctx.beginPath(); ctx.moveTo(x + u * 0.15, y + u * 0.2); ctx.lineTo(x, baseY + u * 0.15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + w - u * 0.15, y + u * 0.2); ctx.lineTo(x + w, baseY + u * 0.15); ctx.stroke();
    })();

    // 壺鈴兩顆（左下）
    (function () {
      var kx = W * 0.30, ky = baseY - u * 0.1;
      for (var i = 0; i < 2; i++) {
        var x = kx + i * u * 0.7, r = u * (0.28 - i * 0.05);
        ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, ky, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = Math.max(2, u * 0.06);
        ctx.beginPath(); ctx.arc(x, ky - r * 0.9, r * 0.55, Math.PI, 0); ctx.stroke();      // 提把
        ctx.beginPath(); ctx.arc(x, ky, r, 0, Math.PI * 2); ctx.stroke();
      }
    })();
    ctx.restore();
  }

  // 樂手身高(觀眾尺寸依此換算)
  function guitaristHeight() { return Math.min(H * 0.72, W * 0.82, 470); }

  // 台下觀眾剪影：每人約樂手 1/4 高，前後多排交錯排列(後排較小較暗較高做景深)，隨熱度加排/舉手
  function drawCrowd(hy, st, ghgt) {
    if (hy <= 0.001) return;
    var unit = (ghgt || 320) / 3;                   // 觀眾約樂手身高的 1/3
    var rows = 2 + Math.round(hy * 3);              // 2..5 排(前後)
    ctx.save(); ctx.lineCap = "round";
    for (var r = rows - 1; r >= 0; r--) {           // 後排先畫
      var depth = rows > 1 ? r / (rows - 1) : 0;    // 0=前排 .. 1=最後排
      var sc = 1 - depth * 0.5;                     // 後排縮小
      var dark = 0.96 - depth * 0.32;
      var pH = unit * sc;                            // 此排每個人高度
      var hr = pH * 0.3;                             // 頭半徑
      var sp = pH * 0.62;                            // 人與人間距(略重疊=密)
      var baseB = (H - 4) - depth * (unit * 0.55);  // 此排底線(後排往上=較遠)
      var headY0 = baseB - pH * 0.5;                // 頭中心 Y
      var offset = (r % 2) * sp * 0.5;              // 前後交錯：奇數排水平位移半格
      var n = Math.ceil((W + sp * 2) / sp);
      for (var i = 0; i < n; i++) {
        var x = i * sp - sp + offset;
        var bounce = (Math.sin(st * 4.0 + i * 1.3 + r * 0.9) * 0.5 + 0.5) * (hr * 0.5) * (0.4 + hy);
        var y = headY0 - bounce;
        ctx.fillStyle = "rgba(10,8,15," + dark + ")";
        ctx.beginPath(); ctx.ellipse(x, y + hr * 1.5, hr * 1.35, hr * 1.7, 0, Math.PI, 0); ctx.fill();  // 肩身
        ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill();                                  // 頭
        ctx.strokeStyle = (i % 2 ? "rgba(120,150,255," + (0.4 * dark) + ")" : "rgba(255,120,160," + (0.4 * dark) + ")");  // 舞台邊光描邊
        ctx.lineWidth = Math.max(1, hr * 0.16); ctx.beginPath(); ctx.arc(x, y, hr, Math.PI * 1.1, Math.PI * 2); ctx.stroke();
        if (hy > 0.4 && i % 3 === 0) {                                                                    // 高段舉手歡呼
          ctx.strokeStyle = "rgba(10,8,15," + dark + ")"; ctx.lineWidth = hr * 0.34;
          ctx.beginPath(); ctx.moveTo(x - hr * 0.6, y + hr * 0.3); ctx.lineTo(x - hr * 1.1, y - hr * 1.9 - bounce); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + hr * 0.6, y + hr * 0.3); ctx.lineTo(x + hr * 1.1, y - hr * 1.9 - bounce); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // 舞台升降台：吉他手腳下的台子，連段(熱度 hy)越高台越高，人明顯站上舞台。畫在螢幕座標。
  // 舞台左邊界(右側寬台，容納樂手＋音箱backline)
  function stageLeftX() { return W * 0.46; }

  // 大舞台台面：右側一整塊寬台(連段越高越高)，含霓虹台緣＋桁架＋LED
  function drawStageDeck(topY, floorY, hy, st) {
    var L = stageLeftX(), R = W + 6, bodyBot = floorY + 64;
    ctx.save();
    // 台身
    ctx.fillStyle = "rgba(13,10,19,0.98)"; ctx.fillRect(L, topY + 12, R - L, bodyBot - (topY + 12));
    var sg = ctx.createLinearGradient(L, 0, R, 0);
    sg.addColorStop(0, "rgba(255,255,255,0.06)"); sg.addColorStop(0.5, "rgba(255,255,255,0)"); sg.addColorStop(1, "rgba(0,0,0,0.3)");
    ctx.fillStyle = sg; ctx.fillRect(L, topY + 12, R - L, bodyBot - (topY + 12));
    // 桁架直紋
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 2;
    for (var v = L + 30; v < R; v += 44) { ctx.beginPath(); ctx.moveTo(v, topY + 18); ctx.lineTo(v, bodyBot); ctx.stroke(); }
    // 台面板(厚度＋高光)
    ctx.fillStyle = "rgba(46,41,60,0.98)"; roundRect(L - 6, topY - 6, (R - L) + 12, 24, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.07)"; roundRect(L - 6, topY - 6, (R - L) + 12, 6, 4); ctx.fill();
    // 霓虹台緣＋外暈
    var pulse = 0.5 + 0.5 * Math.sin(st * 6);
    var neon = hy > 0.66 ? "120,200,255" : hy > 0.33 ? "255,180,90" : "255,120,160";
    ctx.fillStyle = "rgba(" + neon + "," + (0.55 + pulse * 0.4 * hy) + ")"; ctx.fillRect(L - 6, topY - 8, (R - L) + 12, 4);
    ctx.shadowColor = "rgba(" + neon + ",0.9)"; ctx.shadowBlur = 16 + hy * 18;
    ctx.fillRect(L - 6, topY - 8, (R - L) + 12, 3); ctx.shadowBlur = 0;
    // 台前 LED 點
    ctx.fillStyle = "rgba(" + neon + ",0.9)";
    for (var x = L + 16; x < R; x += 30) { ctx.beginPath(); ctx.arc(x, topY + 15, 2.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  // 單一知名音箱(cabinet)：依品牌配色，含控制面板/喇叭網/logo板
  var AMP_STYLE = {
    marshall: { body: "#0b0b0d", grille: "#1b1b20", accent: "#d9b24a", panel: "#d9b24a" },  // 黑箱金牌白字
    orange:   { body: "#d5641b", grille: "#0c0c0c", accent: "#f2f2f2", panel: "#f4f4f4" },  // 橘箱
    fender:   { body: "#111319", grille: "#3a4150", accent: "#c7ccd6", panel: "#c7ccd6" },  // 黑箱銀網
    vox:      { body: "#14110d", grille: "#c9bfa6", accent: "#8a6a2a", panel: "#e9dcc0" },  // 鑽石網米色
    mesa:     { body: "#0c0c0e", grille: "#161616", accent: "#7a1414", panel: "#7a1414" }   // 黑箱紅標
  };
  function drawAmp(x, baseY, w, h, brand, hy, st) {
    var s = AMP_STYLE[brand] || AMP_STYLE.marshall, top = baseY - h;
    hy = hy || 0; st = st || 0;
    var puls = 0.5 + 0.5 * Math.sin(st * 9 + x * 0.05);            // 低頻脈動(像喇叭在推空氣)
    var glow = (0.25 + hy * 0.75) * (0.6 + 0.4 * puls);           // 熱度越高越亮
    ctx.save();
    // 熱狂時箱體外圍暖光(音箱特效)
    if (hy > 0.05) {
      var rg = ctx.createRadialGradient(x, top + h * 0.55, w * 0.15, x, top + h * 0.55, w * 0.95);
      rg.addColorStop(0, "rgba(255,150,60," + (0.10 + hy * 0.28) + ")"); rg.addColorStop(1, "rgba(255,150,60,0)");
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = rg;
      ctx.fillRect(x - w, top - h * 0.1, w * 2, h * 1.3); ctx.restore();
    }
    ctx.fillStyle = s.body; roundRect(x - w / 2, top, w, h, 7); ctx.fill();                 // 箱體
    ctx.fillStyle = "rgba(255,255,255,0.05)"; roundRect(x - w / 2, top, w, 6, 4); ctx.fill(); // 上緣高光
    ctx.fillStyle = s.panel; ctx.fillRect(x - w / 2 + 7, top + 8, w - 14, Math.max(4, h * 0.08)); // 控制面板
    ctx.fillStyle = s.grille; roundRect(x - w / 2 + 7, top + h * 0.22, w - 14, h * 0.7, 5); ctx.fill(); // 喇叭網
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;                          // 網布紋
    for (var gy = top + h * 0.3; gy < top + h * 0.88; gy += 6) { ctx.beginPath(); ctx.moveTo(x - w / 2 + 9, gy); ctx.lineTo(x + w / 2 - 9, gy); ctx.stroke(); }
    // 喇叭錐盆發光＋隨脈動抖動(音箱在轟鳴的特效)
    var coneY = top + h * 0.58, coneR = w * (0.2 + 0.02 * puls);
    var cg = ctx.createRadialGradient(x, coneY, 1, x, coneY, coneR * 1.6);
    cg.addColorStop(0, "rgba(255,180,90," + (0.35 * glow) + ")"); cg.addColorStop(1, "rgba(255,120,40,0)");
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(x, coneY, coneR * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = s.accent; roundRect(x - w * 0.19, top + h * 0.45, w * 0.38, h * 0.1, 3); ctx.fill(); // logo 板
    // 電源指示燈(常亮，熱度高更亮)
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,70,60," + (0.55 + glow * 0.45) + ")";
    ctx.beginPath(); ctx.arc(x + w / 2 - 12, top + 8 + Math.max(4, h * 0.08) / 2, 2.6 + hy * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  // 音箱 backline：舞台後方一整排知名音箱(在樂手左後方)，數量隨熱度變多
  function drawAmpBackline(cx, deckTopY, hgt, hy, st) {
    var brands = ["marshall", "orange", "fender", "vox", "mesa"];
    var n = 4 + (hy > 0.5 ? 1 : 0);                       // 4~5 座
    var ah = hgt * 0.46, aw = hgt * 0.38, baseY = deckTopY + 4;   // 音箱加寬(0.26→0.38)
    var startX = stageLeftX() + aw * 0.55, endX = W - aw * 0.55;  // 沿整個舞台後方鋪開(樂手站前方中央)
    var gap = n > 1 ? (endX - startX) / (n - 1) : 0;
    for (var i = 0; i < n; i++) drawAmp(startX + gap * i, baseY, aw, ah, brands[i % brands.length], hy, st || 0);
  }

  // 其他團員(黑色剪影)共用身體：腿＋身＋頭＋舞台邊光；回傳肩/頭座標供加樂器
  function bandBody(cx, footY, h, st, phase) {
    var bob = Math.sin(st * 6.3 + phase) * (h * 0.02);
    var hipY = footY - h * 0.42, shY = footY - h * 0.80 - bob, hr = h * 0.12, headY = shY - hr * 1.15;
    ctx.fillStyle = "rgba(9,9,13,0.98)";
    ctx.fillRect(cx - h * 0.11, hipY, h * 0.08, footY - hipY);              // 腿
    ctx.fillRect(cx + h * 0.03, hipY, h * 0.08, footY - hipY);
    roundRect(cx - h * 0.15, shY, h * 0.30, hipY - shY + h * 0.05, h * 0.06); ctx.fill();   // 身
    ctx.beginPath(); ctx.arc(cx, headY, hr, 0, Math.PI * 2); ctx.fill();   // 頭
    ctx.strokeStyle = (phase % 2 ? "rgba(150,175,255,0.32)" : "rgba(255,140,175,0.30)"); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, headY, hr, Math.PI * 1.08, Math.PI * 1.95); ctx.stroke();  // 邊光
    return { shY: shY, headY: headY, hr: hr, hipY: hipY, bob: bob };
  }
  // 鼓手/貝斯手/KB手（黑色剪影，陪主吉他手站台）
  function drawBandMembers(gcx, groundY, hgt, hy, st) {
    var dark = "rgba(9,9,13,0.98)";
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    // 鼓手：後方(高一點)＋鼓組＋雙棒隨拍
    (function () {
      var h = hgt * 0.5, cx = gcx - hgt * 0.26, footY = groundY - hgt * 0.28;
      var b = bandBody(cx, footY, h, st, 0);
      ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(cx, footY + h * 0.02, h * 0.28, h * 0.24, 0, 0, Math.PI * 2); ctx.fill();   // 大鼓
      ctx.strokeStyle = "rgba(150,175,255,0.28)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, footY + h * 0.02, h * 0.28, h * 0.24, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = dark;                                                                                       // 兩片鈸
      ctx.beginPath(); ctx.ellipse(cx - h * 0.4, b.shY - h * 0.02, h * 0.16, h * 0.035, -0.25, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + h * 0.4, b.shY + h * 0.05, h * 0.16, h * 0.035, 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx - h * 0.4, b.shY); ctx.lineTo(cx - h * 0.3, footY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + h * 0.4, b.shY + h * 0.07); ctx.lineTo(cx + h * 0.3, footY); ctx.stroke();
      var hit = Math.abs(Math.sin(st * 8));                                                                       // 鼓棒交替敲
      ctx.lineWidth = Math.max(2, h * 0.04);
      ctx.beginPath(); ctx.moveTo(cx - h * 0.06, b.shY + h * 0.12); ctx.lineTo(cx - h * 0.36, b.shY - h * 0.04 - hit * h * 0.12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + h * 0.06, b.shY + h * 0.12); ctx.lineTo(cx + h * 0.36, b.shY + h * 0.03 - (1 - hit) * h * 0.12); ctx.stroke();
    })();
    // 貝斯手：舞台左，長頸貝斯斜跨
    (function () {
      var h = hgt * 0.76, cx = gcx - hgt * 0.62, footY = groundY;
      var b = bandBody(cx, footY, h, st, 1);
      ctx.save(); ctx.translate(cx + h * 0.02, b.shY + h * 0.22); ctx.rotate(-0.5);
      ctx.fillStyle = dark; roundRect(-h * 0.07, -h * 0.11, h * 0.17, h * 0.22, h * 0.05); ctx.fill();            // 琴身
      ctx.fillRect(-h * 0.02, -h * 0.52, h * 0.05, h * 0.44);                                                      // 長琴頸
      ctx.strokeStyle = "rgba(150,175,255,0.3)"; ctx.lineWidth = 1.5; roundRect(-h * 0.07, -h * 0.11, h * 0.17, h * 0.22, h * 0.05); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = dark; ctx.lineWidth = Math.max(2, h * 0.05);                                              // 撥弦手
      ctx.beginPath(); ctx.moveTo(cx + h * 0.07, b.shY + h * 0.06); ctx.lineTo(cx + h * 0.04 + Math.sin(st * 7) * h * 0.03, b.shY + h * 0.26); ctx.stroke();
    })();
    // KB手：舞台右，站在鍵盤後
    (function () {
      var h = hgt * 0.68, cx = gcx + hgt * 0.55, footY = groundY;
      var b = bandBody(cx, footY, h, st, 2);
      var kw = h * 0.54, ky = b.hipY + h * 0.02;
      ctx.fillStyle = dark; roundRect(cx - kw / 2, ky, kw, h * 0.09, 4); ctx.fill();                              // 鍵盤板
      ctx.strokeStyle = "rgba(150,175,255,0.3)"; ctx.lineWidth = 1.5; roundRect(cx - kw / 2, ky, kw, h * 0.09, 4); ctx.stroke();
      ctx.fillStyle = "rgba(210,215,230,0.45)";                                                                    // 白鍵提示
      for (var kx = cx - kw / 2 + h * 0.03; kx < cx + kw / 2 - h * 0.02; kx += h * 0.05) ctx.fillRect(kx, ky + 3, h * 0.01, h * 0.05);
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5;                                                                 // 腳架
      ctx.beginPath(); ctx.moveTo(cx - kw * 0.32, ky + h * 0.09); ctx.lineTo(cx - kw * 0.28, footY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + kw * 0.32, ky + h * 0.09); ctx.lineTo(cx + kw * 0.28, footY); ctx.stroke();
      ctx.lineWidth = Math.max(2, h * 0.05);                                                                       // 雙手在鍵上
      ctx.beginPath(); ctx.moveTo(cx - h * 0.05, b.shY + h * 0.12); ctx.lineTo(cx - h * 0.09 + Math.sin(st * 9) * h * 0.02, ky); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + h * 0.05, b.shY + h * 0.12); ctx.lineTo(cx + h * 0.09 + Math.cos(st * 9) * h * 0.02, ky); ctx.stroke();
    })();
    ctx.restore();
  }

  // 追蹤聚光燈：從舞台頂燈架打光在樂手身上(連段越高越亮)。螢幕座標、加色疊光。
  function drawFollowSpot(cx, headY, footY, hy, st, hgt) {
    var k = 0.5 + hy * 0.9;
    var aimX = cx + Math.sin(st * 1.15) * (hgt * 0.045);          // 光束輕微擺動(像真的在追蹤)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var beams = [[cx - hgt * 0.52, "255,236,196"], [cx + hgt * 0.44, "202,224,255"]];   // 上方兩束交叉光
    for (var i = 0; i < beams.length; i++) {
      var sx = beams[i][0], rgb = beams[i][1];
      var g = ctx.createLinearGradient(sx, -20, aimX, footY);
      g.addColorStop(0, "rgba(" + rgb + "," + (0.17 * k) + ")");
      g.addColorStop(0.8, "rgba(" + rgb + "," + (0.05 * k) + ")");
      g.addColorStop(1, "rgba(" + rgb + ",0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx - 12, -20); ctx.lineTo(sx + 12, -20);
      ctx.lineTo(aimX + hgt * 0.3, footY + 6); ctx.lineTo(aimX - hgt * 0.3, footY + 6);
      ctx.closePath(); ctx.fill();
    }
    var midY = (headY + footY) / 2;                                // 打在樂手身上的暖光池
    var pool = ctx.createRadialGradient(aimX, midY, 8, aimX, midY, hgt * 0.6);
    pool.addColorStop(0, "rgba(255,248,224," + (0.16 * k) + ")"); pool.addColorStop(1, "rgba(255,248,224,0)");
    ctx.fillStyle = pool; ctx.beginPath(); ctx.ellipse(aimX, midY, hgt * 0.42, hgt * 0.66, 0, 0, Math.PI * 2); ctx.fill();
    var fl = ctx.createRadialGradient(cx, footY + 6, 4, cx, footY + 6, hgt * 0.5);   // 腳下地面光斑
    fl.addColorStop(0, "rgba(255,240,196," + (0.24 * k) + ")"); fl.addColorStop(1, "rgba(255,240,196,0)");
    ctx.fillStyle = fl; ctx.beginPath(); ctx.ellipse(cx, footY + 6, hgt * 0.42, hgt * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- Q 版知名吉他手 ----
  // 一叢圓球（爆炸頭 / 捲毛）
  function curlCluster(spec, color) {
    ctx.fillStyle = color;
    for (var i = 0; i < spec.length; i++) { ctx.beginPath(); ctx.arc(spec[i][0], spec[i][1], spec[i][2], 0, Math.PI * 2); ctx.fill(); }
  }
  // 一隻有關節的手臂：肩 a → 肘 b → 手 c，上臂穿袖、前臂露膚、末端一顆手
  function drawLimb(a, b, c, sleeve, skin, wUp, wFore) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = sleeve; ctx.lineWidth = wUp;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.strokeStyle = skin; ctx.lineWidth = wFore;
    ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(c[0], c[1], wFore * 0.72, 0, Math.PI * 2); ctx.fill();
  }
  // 吉他（依角色換造型/顏色），畫在角色本地座標
  function drawGuitar(type) {
    ctx.save();
    ctx.translate(2, -70); ctx.rotate(-0.62);
    var maple = (type === "strat" || type === "striped");
    var neckCol = maple ? "#c99a5a" : "#2a1a0c";
    ctx.fillStyle = neckCol; ctx.fillRect(-9, -150, 18, 120);              // 琴頸
    ctx.fillStyle = maple ? "#b8894a" : "#0d0d0d"; roundRect(-13, -170, 26, 24, 3); ctx.fill();  // 琴頭
    if (type === "strat") {
      ctx.fillStyle = "#f4f4f4"; ctx.beginPath(); ctx.ellipse(0, 6, 40, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#dcdcdc"; ctx.beginPath(); ctx.ellipse(5, 12, 25, 33, 0, 0, Math.PI * 2); ctx.fill();  // 護板
      ctx.fillStyle = "#111"; ctx.fillRect(-8, 2, 20, 5); ctx.fillRect(-8, 14, 20, 5); ctx.fillRect(-8, 26, 20, 5);
    } else if (type === "sg") {
      ctx.fillStyle = "#7a1420"; ctx.beginPath(); ctx.ellipse(0, 12, 36, 44, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-32, -22); ctx.lineTo(-4, -34); ctx.lineTo(-6, -4); ctx.closePath(); ctx.fill();  // 左角
      ctx.beginPath(); ctx.moveTo(32, -22); ctx.lineTo(4, -34); ctx.lineTo(6, -4); ctx.closePath(); ctx.fill();     // 右角
      ctx.fillStyle = "#111"; ctx.fillRect(-11, 2, 22, 7); ctx.fillRect(-11, 18, 22, 7);
    } else if (type === "red") {                                            // Brian May · Red Special
      var rg = ctx.createRadialGradient(0, 6, 4, 0, 6, 46);
      rg.addColorStop(0, "#c33742"); rg.addColorStop(0.7, "#7d1620"); rg.addColorStop(1, "#3a0a10");
      ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(0, 6, 40, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#d8b24a"; ctx.fillRect(-12, -4, 24, 7); ctx.fillRect(-12, 14, 24, 7);  // 金拾音器
    } else if (type === "striped") {                                        // Van Halen · Frankenstrat
      ctx.fillStyle = "#d63a3a"; ctx.beginPath(); ctx.ellipse(0, 6, 40, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 6, 40, 50, 0, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = "#f4f4f4"; ctx.lineWidth = 6;
      for (var k = -60; k < 70; k += 22) { ctx.beginPath(); ctx.moveTo(k, -52); ctx.lineTo(k + 42, 62); ctx.stroke(); }
      ctx.strokeStyle = "#111"; ctx.lineWidth = 4;
      for (var k2 = -50; k2 < 70; k2 += 22) { ctx.beginPath(); ctx.moveTo(k2, -52); ctx.lineTo(k2 + 42, 62); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = "#111"; ctx.fillRect(-10, 4, 22, 7);
    } else if (type === "offset") {                                         // Kurt Cobain · 藍色 offset
      var og = ctx.createLinearGradient(-40, -44, 40, 56);
      og.addColorStop(0, "#3f74ad"); og.addColorStop(1, "#16324f");
      ctx.fillStyle = og; ctx.beginPath(); ctx.ellipse(-3, 4, 42, 50, 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8e4d8"; ctx.beginPath(); ctx.ellipse(7, 14, 20, 26, 0.1, 0, Math.PI * 2); ctx.fill();  // 護板
      ctx.fillStyle = "#111"; ctx.fillRect(-4, 6, 18, 5); ctx.fillRect(-4, 20, 18, 5);
    } else if (type === "hollow") {                                         // B.B. King · 黑色空心琴 Lucille
      ctx.fillStyle = "#0e0e12"; ctx.beginPath(); ctx.ellipse(0, 8, 42, 52, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#33333a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 8, 42, 52, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = "#c9a24a"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(-22, 10, 13, -0.6, 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(22, 10, 13, 1.2, 3.7); ctx.stroke();                                            // f 孔
      ctx.fillStyle = "#c9a24a"; ctx.fillRect(-11, -6, 22, 5);
    } else if (type === "bullseye") {                                       // Zakk Wylde · 黑白靶心
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 6, 40, 50, 0, 0, Math.PI * 2); ctx.clip();
      var rr = [58, 49, 40, 31, 22, 13, 6];
      for (var b = 0; b < rr.length; b++) { ctx.fillStyle = (b % 2 === 0) ? "#f2f2f2" : "#0d0d0d"; ctx.beginPath(); ctx.arc(-4, 2, rr[b], 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(-12, -4, 24, 7);
    } else if (type === "nylon") {                                          // Tim Henson · 原木尼龍弦 signature
      var ng = ctx.createRadialGradient(0, 6, 4, 0, 6, 48);
      ng.addColorStop(0, "#e9cd93"); ng.addColorStop(0.7, "#cf9f57"); ng.addColorStop(1, "#9c6e30");
      ctx.fillStyle = ng; ctx.beginPath(); ctx.ellipse(0, 6, 40, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4a2f14"; ctx.beginPath(); ctx.arc(0, 10, 12, 0, Math.PI * 2); ctx.fill();                 // 音孔
      ctx.strokeStyle = "#2e1c0c"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 10, 15, 0, Math.PI * 2); ctx.stroke();  // 玫瑰花飾
      ctx.strokeStyle = "#6a4a24"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-14, -18); ctx.lineTo(14, -18); ctx.stroke();  // 琴橋線
    } else {                                                                // lespaul（sunburst）
      var lg = ctx.createRadialGradient(0, 6, 4, 0, 6, 46);
      lg.addColorStop(0, "#f2b64e"); lg.addColorStop(0.6, "#c6761c"); lg.addColorStop(1, "#37200a");
      ctx.fillStyle = lg; ctx.beginPath(); ctx.ellipse(0, 6, 40, 50, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1a1a1a"; ctx.fillRect(-12, -4, 24, 8); ctx.fillRect(-12, 14, 24, 8);
    }
    ctx.restore();
  }

  var GUITARISTS = {
    slash: {
      skin: "#e7c6a3", legs: "#20222c", torso: "#141118", sleeve: "#141118", chest: "#c99a6a", guitar: "lespaul",
      head: function (hy) {
        ctx.fillStyle = "#0a0a0a";  // 墨鏡
        ctx.beginPath(); ctx.ellipse(-19, hy + 2, 17, 12, 0, 0, Math.PI * 2); ctx.ellipse(19, hy + 2, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(-6, hy - 2, 12, 6);
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(-24, hy - 2, 3, 0, Math.PI * 2); ctx.fill();
        curlCluster([[-46,hy-18,26],[-22,hy-36,25],[8,hy-38,25],[40,hy-20,27],[-56,hy+12,23],[56,hy+10,23],
                     [-52,hy+54,24],[52,hy+54,24],[-42,hy+96,22],[44,hy+98,22],[0,hy-46,27],[-30,hy+120,18],[30,hy+120,18]], "#0e0e13");
        ctx.fillStyle = "#0e0e13"; ctx.beginPath(); ctx.arc(0, hy - 12, 48, Math.PI, 0); ctx.fill();  // 瀏海
        ctx.fillStyle = "#0a0a0a"; ctx.fillRect(-42, hy - 86, 84, 11);        // 帽簷
        roundRect(-33, hy - 150, 66, 66, 6); ctx.fill();                       // 帽身
        ctx.fillStyle = "#6b1414"; ctx.fillRect(-33, hy - 96, 66, 9);          // 帽帶
      }
    },
    hendrix: {
      skin: "#7a4a2c", legs: "#2a2440", torso: "#5a2a6a", sleeve: "#5a2a6a", chest: "#caa15f", guitar: "strat",
      head: function (hy) {
        curlCluster([[0,hy-42,34],[-40,hy-24,30],[40,hy-24,30],[-58,hy+8,26],[58,hy+8,26],
                     [-30,hy-48,26],[30,hy-48,26],[-52,hy+44,24],[52,hy+44,24],[0,hy-56,28]], "#1a1310");  // afro
        ctx.fillStyle = "#1a1310";
        ctx.beginPath(); ctx.moveTo(-48,hy+6); ctx.lineTo(-40,hy+46); ctx.lineTo(-28,hy+40); ctx.closePath(); ctx.fill();  // 鬢角
        ctx.beginPath(); ctx.moveTo(48,hy+6); ctx.lineTo(40,hy+46); ctx.lineTo(28,hy+40); ctx.closePath(); ctx.fill();
        var hb = ctx.createLinearGradient(-46, 0, 46, 0);
        hb.addColorStop(0, "#e0483c"); hb.addColorStop(0.5, "#f2b64e"); hb.addColorStop(1, "#3aa0e0");
        ctx.fillStyle = hb; ctx.fillRect(-46, hy - 20, 92, 13);                // 彩色頭巾
        ctx.fillStyle = "#e0483c"; ctx.fillRect(38, hy - 18, 7, 32);          // 垂帶
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-14, hy + 8, 4, 0, Math.PI * 2); ctx.arc(14, hy + 8, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#1a1310"; ctx.fillRect(-11, hy + 24, 22, 5);         // 髭
      }
    },
    angus: {
      skin: "#e7c6a3", legs: "#e7c6a3", torso: "#7a1f2b", sleeve: "#7a1f2b", chest: "#f2f2f2", tie: "#20242e",
      guitar: "sg", scale: 0.9, shorts: true,
      head: function (hy) {
        curlCluster([[-30,hy-30,20],[0,hy-38,22],[30,hy-30,20],[-40,hy-8,16],[40,hy-8,16]], "#5a3a22");
        ctx.fillStyle = "#5a3a22"; ctx.beginPath(); ctx.arc(0, hy - 14, 44, Math.PI, 0); ctx.fill();  // 短髮
        ctx.fillStyle = "#2b2f3a";
        ctx.beginPath(); ctx.ellipse(0, hy - 38, 46, 20, 0, Math.PI, 0); ctx.fill();                  // 帽頂
        ctx.beginPath(); ctx.ellipse(-16, hy - 28, 36, 10, 0, 0, Math.PI); ctx.fill();                // 帽簷
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-14, hy + 2, 4, 0, Math.PI * 2); ctx.arc(14, hy + 2, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#7a3b2a"; ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(0, hy + 14, 11, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();       // 咧嘴
      }
    },
    may: {
      skin: "#e7c6a3", legs: "#1a1720", torso: "#17151a", sleeve: "#17151a", chest: "#17151a", guitar: "red",
      head: function (hy) {
        curlCluster([[-50,hy-20,28],[-30,hy-46,28],[0,hy-54,30],[30,hy-46,28],[50,hy-20,28],
                     [-62,hy+14,26],[62,hy+14,26],[-54,hy+58,24],[54,hy+58,24],[-32,hy+90,22],[32,hy+90,22],
                     [0,hy-62,26],[-46,hy+96,18],[46,hy+96,18]], "#2a2018");   // 巨大捲毛
        ctx.fillStyle = "#2a2018"; ctx.beginPath(); ctx.arc(0, hy - 10, 46, Math.PI, 0); ctx.fill();
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-14, hy + 6, 4, 0, Math.PI * 2); ctx.arc(14, hy + 6, 4, 0, Math.PI * 2); ctx.fill();
      }
    },
    vanhalen: {
      skin: "#e7c6a3", legs: "#20222c", torso: "#d63a3a", sleeve: "#e7c6a3", chest: "#d63a3a", guitar: "striped",
      head: function (hy) {
        curlCluster([[-34,hy-26,24],[0,hy-42,26],[34,hy-26,24],[-48,hy+6,22],[48,hy+6,22],[-42,hy+46,20],[42,hy+46,20]], "#6a4a2a");
        ctx.fillStyle = "#6a4a2a"; ctx.beginPath(); ctx.arc(0, hy - 12, 46, Math.PI, 0); ctx.fill();  // 蓬亂髮
        ctx.fillStyle = "#e8e8e8"; ctx.fillRect(-46, hy - 20, 92, 12);        // 頭巾
        ctx.fillStyle = "#c33"; ctx.fillRect(-46, hy - 16, 92, 4);
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-14, hy + 4, 4, 0, Math.PI * 2); ctx.arc(14, hy + 4, 4, 0, Math.PI * 2); ctx.fill();
      }
    },
    cobain: {
      skin: "#e7c6a3", legs: "#3a4a5a", torso: "#7d8a55", sleeve: "#7d8a55", chest: "#d8d2c0", guitar: "offset",
      head: function (hy) {
        curlCluster([[-34,hy-22,22],[0,hy-32,24],[34,hy-22,22],[-46,hy+4,20],[46,hy+4,20],[-40,hy+38,18],[40,hy+38,18]], "#caa24a");  // 亂金髮
        ctx.fillStyle = "#caa24a"; ctx.beginPath(); ctx.arc(0, hy - 8, 46, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-46, hy - 4); ctx.quadraticCurveTo(0, hy + 14, 46, hy - 4); ctx.lineTo(46, hy - 16); ctx.lineTo(-46, hy - 16); ctx.closePath(); ctx.fill();  // 瀏海
        ctx.fillStyle = "#f2f2f2"; ctx.beginPath(); ctx.ellipse(-18, hy + 6, 15, 11, 0, 0, Math.PI * 2); ctx.ellipse(18, hy + 6, 15, 11, 0, 0, Math.PI * 2); ctx.fill();  // 白框墨鏡
        ctx.fillStyle = "#3f5a2a"; ctx.beginPath(); ctx.ellipse(-18, hy + 6, 10, 7, 0, 0, Math.PI * 2); ctx.ellipse(18, hy + 6, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
      }
    },
    bbking: {
      skin: "#5a3820", legs: "#161620", torso: "#2b2b3c", sleeve: "#2b2b3c", chest: "#f2f2f2", tie: "#7a1020", guitar: "hollow",
      head: function (hy) {
        ctx.fillStyle = "#191410"; ctx.beginPath(); ctx.arc(0, hy - 4, 44, Math.PI * 1.04, Math.PI * 1.96); ctx.fill(); ctx.fillRect(-44, hy - 6, 88, 7);  // 後退短髮
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-14, hy + 6, 4, 0, Math.PI * 2); ctx.arc(14, hy + 6, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#3a2418"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(0, hy + 16, 11, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();  // 微笑
      }
    },
    page: {
      skin: "#e7c6a3", legs: "#141118", torso: "#141118", sleeve: "#141118", chest: "#c99a6a", guitar: "lespaul",
      head: function (hy) {
        ctx.fillStyle = "#171015";
        ctx.beginPath(); ctx.arc(0, hy - 10, 50, Math.PI, 0); ctx.fill();
        roundRect(-52, hy - 14, 32, 130, 16); ctx.fill(); roundRect(20, hy - 14, 32, 130, 16); ctx.fill();  // 長直髮
        ctx.fillStyle = "#e7c6a3"; ctx.beginPath(); ctx.arc(0, hy + 4, 30, 0, Math.PI * 2); ctx.fill();       // 臉
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-11, hy + 2, 4, 0, Math.PI * 2); ctx.arc(11, hy + 2, 4, 0, Math.PI * 2); ctx.fill();
      }
    },
    zakk: {
      skin: "#e7c6a3", legs: "#141118", torso: "#141118", sleeve: "#141118", chest: "#141118", guitar: "bullseye",
      head: function (hy) {
        ctx.fillStyle = "#b98f3e";
        ctx.beginPath(); ctx.arc(0, hy - 12, 50, Math.PI, 0); ctx.fill();
        roundRect(-54, hy - 16, 32, 140, 16); ctx.fill(); roundRect(22, hy - 16, 32, 140, 16); ctx.fill();  // 超長金髮
        ctx.fillStyle = "#e7c6a3"; ctx.beginPath(); ctx.arc(0, hy + 2, 30, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#a07d34"; ctx.beginPath(); ctx.moveTo(-26, hy + 6); ctx.quadraticCurveTo(0, hy + 58, 26, hy + 6); ctx.quadraticCurveTo(0, hy + 30, -26, hy + 6); ctx.fill();  // 大鬍子
        ctx.fillStyle = "#0a0a0a"; ctx.beginPath(); ctx.ellipse(-13, hy - 2, 12, 9, 0, 0, Math.PI * 2); ctx.ellipse(13, hy - 2, 12, 9, 0, 0, Math.PI * 2); ctx.fill();  // 墨鏡
      }
    },
    henson: {   // Tim Henson (Polyphia)：頂髻(man bun)＋削邊、圓框墨鏡、鬍渣、黑街頭衣、原木尼龍弦
      skin: "#e2b58f", legs: "#17171c", torso: "#17171c", sleeve: "#17171c", chest: "#2a2a30", guitar: "nylon",
      head: function (hy) {
        ctx.fillStyle = "#100e0c";
        ctx.beginPath(); ctx.arc(0, hy - 46, 15, 0, Math.PI * 2); ctx.fill();                        // 髮髻(man bun)
        ctx.fillRect(-3, hy - 44, 6, 10);
        ctx.beginPath(); ctx.arc(0, hy - 14, 47, Math.PI * 1.1, Math.PI * 1.9); ctx.fill();          // 頭頂髮(往後梳)
        ctx.fillRect(-47, hy - 18, 11, 30); ctx.fillRect(36, hy - 18, 11, 30);                        // 兩側削短
        ctx.fillStyle = "rgba(20,16,12,0.32)";                                                        // 鬍渣
        ctx.beginPath(); ctx.arc(0, hy + 20, 33, 0.22, Math.PI - 0.22); ctx.fill();
        ctx.fillStyle = "#0c0c10";                                                                    // 圓框墨鏡
        ctx.beginPath(); ctx.arc(-17, hy + 4, 13, 0, Math.PI * 2); ctx.arc(17, hy + 4, 13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#3a3a42"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-4, hy + 4); ctx.lineTo(4, hy + 4); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.arc(-21, hy, 3, 0, Math.PI * 2); ctx.fill();
      }
    },
    asato: {   // Mateus Asato：深色波浪中長髮、大鬍子、暖膚、sunburst
      skin: "#d7a476", legs: "#1c1e26", torso: "#2b2f38", sleeve: "#2b2f38", chest: "#3a3f4a", guitar: "lespaul",
      head: function (hy) {
        curlCluster([[-34,hy-22,22],[0,hy-34,24],[34,hy-22,22],[-46,hy+2,20],[46,hy+2,20],[-40,hy+34,17],[40,hy+34,17]], "#171310");  // 波浪髮
        ctx.fillStyle = "#171310"; ctx.beginPath(); ctx.arc(0, hy - 10, 46, Math.PI, 0); ctx.fill();
        ctx.fillStyle = "#1a150f";                                                                    // 大鬍子
        ctx.beginPath(); ctx.moveTo(-40, hy + 2); ctx.quadraticCurveTo(-34, hy + 54, 0, hy + 60);
        ctx.quadraticCurveTo(34, hy + 54, 40, hy + 2); ctx.quadraticCurveTo(0, hy + 30, -40, hy + 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-14, hy + 2, 4, 0, Math.PI * 2); ctx.arc(14, hy + 2, 4, 0, Math.PI * 2); ctx.fill();  // 眼
        ctx.strokeStyle = "#171310"; ctx.lineWidth = 3; ctx.lineCap = "round";                        // 眉
        ctx.beginPath(); ctx.moveTo(-22, hy - 8); ctx.lineTo(-7, hy - 10); ctx.moveTo(22, hy - 8); ctx.lineTo(7, hy - 10); ctx.stroke();
      }
    },
    ichika: {   // Ichika Nito：黑直髮瀏海、圓框眼鏡、極簡冷色
      skin: "#edcdaf", legs: "#1a1c22", torso: "#22252d", sleeve: "#22252d", chest: "#2c3038", guitar: "offset",
      head: function (hy) {
        ctx.fillStyle = "#0c0c10";
        ctx.beginPath(); ctx.arc(0, hy - 8, 50, Math.PI, 0); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-50, hy - 8); ctx.lineTo(-50, hy + 6);                            // 瀏海
        ctx.quadraticCurveTo(-25, hy + 20, 0, hy + 4); ctx.quadraticCurveTo(25, hy + 20, 50, hy + 6);
        ctx.lineTo(50, hy - 8); ctx.closePath(); ctx.fill();
        ctx.fillRect(-50, hy - 12, 12, 42); ctx.fillRect(38, hy - 12, 12, 42);                        // 兩側垂髮
        ctx.strokeStyle = "#20202a"; ctx.lineWidth = 3;                                               // 圓框眼鏡
        ctx.beginPath(); ctx.arc(-16, hy + 10, 12, 0, Math.PI * 2); ctx.arc(16, hy + 10, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-4, hy + 10); ctx.lineTo(4, hy + 10); ctx.stroke();
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-16, hy + 10, 3, 0, Math.PI * 2); ctx.arc(16, hy + 10, 3, 0, Math.PI * 2); ctx.fill();
      }
    },
    yvette: {   // Yvette Young (Covet)：黑長髮＋青色挑染、瀏海、開朗
      skin: "#f0d2b6", legs: "#2a2440", torso: "#e86a9a", sleeve: "#e86a9a", chest: "#f7c9dd", guitar: "strat",
      head: function (hy) {
        ctx.fillStyle = "#1a1518";
        ctx.beginPath(); ctx.arc(0, hy - 10, 50, Math.PI, 0); ctx.fill();
        roundRect(-54, hy - 14, 30, 150, 15); ctx.fill(); roundRect(24, hy - 14, 30, 150, 15); ctx.fill();  // 兩側長髮
        ctx.beginPath(); ctx.moveTo(-50, hy - 6); ctx.quadraticCurveTo(0, hy + 12, 50, hy - 6); ctx.lineTo(50, hy - 18); ctx.lineTo(-50, hy - 18); ctx.closePath(); ctx.fill();  // 瀏海
        ctx.fillStyle = "#3fd0c8"; roundRect(30, hy + 10, 12, 112, 6); ctx.fill();                    // 青色挑染
        ctx.fillStyle = "#241a12"; ctx.beginPath(); ctx.arc(-13, hy + 6, 4, 0, Math.PI * 2); ctx.arc(13, hy + 6, 4, 0, Math.PI * 2); ctx.fill();  // 眼
        ctx.strokeStyle = "#c86a6a"; ctx.lineWidth = 3; ctx.lineCap = "round";                        // 微笑
        ctx.beginPath(); ctx.arc(0, hy + 16, 9, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      }
    },
    lulan: {   // 閃電嚕嚕安（專屬）：橄欖 T、深色短髮、銀框眼鏡、髭；動作＝舉啞鈴重訓
      skin: "#e8c4a0", legs: "#16161c", torso: "#3f3f36", sleeve: "#3f3f36", chest: "#3f3f36", lift: true,
      head: function (hy) {
        ctx.fillStyle = "#1c1813";                                   // 深色短髮
        ctx.beginPath(); ctx.arc(0, hy - 4, 47, Math.PI * 1.03, Math.PI * 1.97); ctx.fill();
        ctx.fillRect(-45, hy - 12, 90, 10);
        ctx.fillStyle = "#1c1813"; ctx.lineWidth = 4; ctx.strokeStyle = "#1c1813"; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(-28, hy - 7); ctx.lineTo(-9, hy - 3); ctx.stroke();   // 用力皺眉
        ctx.beginPath(); ctx.moveTo(28, hy - 7); ctx.lineTo(9, hy - 3); ctx.stroke();
        ctx.strokeStyle = "#d7d9de"; ctx.lineWidth = 3;                                   // 銀/透明框眼鏡
        ctx.beginPath(); ctx.ellipse(-17, hy + 7, 15, 12, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(17, hy + 7, 15, 12, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-2, hy + 6); ctx.lineTo(2, hy + 6); ctx.stroke();     // 鼻樑
        ctx.beginPath(); ctx.moveTo(-32, hy + 5); ctx.lineTo(-45, hy + 2); ctx.stroke();  // 鏡腳
        ctx.beginPath(); ctx.moveTo(32, hy + 5); ctx.lineTo(45, hy + 2); ctx.stroke();
        ctx.fillStyle = "rgba(190,205,225,0.16)";                                         // 鏡片反光
        ctx.beginPath(); ctx.ellipse(-17, hy + 7, 13, 10, 0, 0, Math.PI * 2); ctx.ellipse(17, hy + 7, 13, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#241a14"; ctx.beginPath(); ctx.arc(-17, hy + 7, 3.4, 0, Math.PI * 2); ctx.arc(17, hy + 7, 3.4, 0, Math.PI * 2); ctx.fill();  // 眼
        ctx.fillStyle = "#2a2018"; ctx.fillRect(-9, hy + 24, 18, 3);                      // 髭
        ctx.strokeStyle = "#7a4a38"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-8, hy + 31); ctx.lineTo(8, hy + 31); ctx.stroke();  // 咬牙
      }
    }
  };

  // 槓鈴（一支長槓＋兩端槓片），畫在 (cx,cy)，tr=用力抖動位移
  function drawBarbell(cx, cy, tr) {
    ctx.save(); ctx.translate(cx + tr, cy);
    ctx.strokeStyle = "#9aa0a6"; ctx.lineCap = "round"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-92, 0); ctx.lineTo(92, 0); ctx.stroke();          // 槓身
    var plates = [-82, -70, 70, 82];
    for (var i = 0; i < plates.length; i++) {
      ctx.fillStyle = "#141418"; ctx.beginPath(); ctx.ellipse(plates[i], 0, 8, 32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#2c2c34"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(plates[i], 0, 8, 32, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  // 閃電圖案（與胸標同款的填色閃電），中心(cx,cy)、s=縮放
  function drawBoltIcon(cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx + 5 * s, cy - 16 * s);
    ctx.lineTo(cx - 9 * s, cy + 1 * s);
    ctx.lineTo(cx - 1 * s, cy + 1 * s);
    ctx.lineTo(cx - 5 * s, cy + 16 * s);
    ctx.lineTo(cx + 10 * s, cy - 4 * s);
    ctx.lineTo(cx + 1 * s, cy - 4 * s);
    ctx.closePath(); ctx.fill();
  }
  // 汗滴：用力(舉高)時噴汗，拋物線下落淡出
  function updateAndDrawSweat(lift, hy) {
    if (lift > 0.72 && Math.random() < 0.4) {
      var side = Math.random() < 0.5 ? -1 : 1;
      lulanSweat.push({ x: side * (34 + Math.random() * 14), y: hy - 22 + Math.random() * 26,
        vx: side * (1.1 + Math.random() * 1.6), vy: -1.4 - Math.random() * 1.6, life: 22 + Math.random() * 12 });
    }
    ctx.fillStyle = "#a6d4ff";
    for (var i = lulanSweat.length - 1; i >= 0; i--) {
      var d = lulanSweat[i];
      d.x += d.vx; d.y += d.vy; d.vy += 0.34; d.life--;
      if (d.life <= 0 || d.y > 40) { lulanSweat.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(0.9, d.life / 16);
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 2.3, 3.4, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 閃電嚕嚕安：槓鈴挺舉（由下往上舉到過頭）＋用力抖動＋汗滴＋頂點爆閃電（本地座標，腳固定 y=0）
  function drawLifter(char, songTime) {
    var lift = (1 - Math.cos(songTime * 4.0)) / 2;                 // 0 放下(腰) .. 1 舉到過頭
    var dip = (1 - lift) * 12;                                     // 放下時微屈膝借力
    var hipY = -84 + dip, shoulderY = hipY - 88, hy = shoulderY - 34;
    var kneeX = 20 + dip * 0.7, kneeY = hipY * 0.5 + dip * 0.5, footL = -26, footR = 26;
    var trem = lift * Math.sin(songTime * 42) * 2.6;              // 舉越高→用力抖動越明顯

    // 腿
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = char.legs; ctx.lineWidth = 24;
    ctx.beginPath(); ctx.moveTo(-15, hipY); ctx.lineTo(-kneeX, kneeY); ctx.lineTo(footL, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(15, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footR, 0); ctx.stroke();
    // 綠色球鞋
    ctx.fillStyle = "#39b06a"; roundRect(footL - 16, -8, 34, 12, 5); ctx.fill(); roundRect(footR - 18, -8, 34, 12, 5); ctx.fill();

    // 軀幹（橄欖 T）＋閃電胸標
    ctx.fillStyle = char.torso; roundRect(-44, shoulderY, 88, hipY - shoulderY + 8, 18); ctx.fill();
    ctx.fillStyle = "#ffd23d"; drawBoltIcon(0, shoulderY + 35, 1);

    // 挺舉：槓鈴由下(腰) → 過頭；手臂跟著由下往上
    var barY = hipY + ((hy - 62) - hipY) * lift;                   // 槓 y：腰 → 過頭
    var handX = 30, elbowX = 40 - lift * 12, elbowY = shoulderY + 12 - lift * 46;
    drawLimb([-28, shoulderY + 8], [-elbowX, elbowY], [-handX + trem, barY], char.sleeve, char.skin, 15, 12);
    drawLimb([28, shoulderY + 8], [elbowX, elbowY], [handX - trem, barY], char.sleeve, char.skin, 15, 12);
    drawBarbell(0, barY, trem);

    // 頭（用力時微顫）
    var hxt = lift * Math.sin(songTime * 46) * 1.4;
    ctx.fillStyle = char.skin; ctx.beginPath(); ctx.arc(hxt, hy, 46, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(hxt, 0); char.head(hy); ctx.restore();

    // 舉到頂點 → 頭頂冒出「同款閃電圖案」＋閃光暈
    if (lift > 0.8) {
      var e = (lift - 0.8) / 0.2;                                 // 0..1 強度
      ctx.save();
      var fg = ctx.createRadialGradient(0, barY - 8, 4, 0, barY - 8, 74);
      fg.addColorStop(0, "rgba(255,225,120," + (0.5 * e) + ")"); fg.addColorStop(1, "rgba(255,225,120,0)");
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(0, barY - 8, 74, 0, Math.PI * 2); ctx.fill();
      var pulse = 1 + Math.sin(songTime * 40) * 0.14;             // 微跳＝閃爍
      ctx.fillStyle = "#ffd23d"; ctx.globalAlpha = 0.78 + 0.22 * e;
      drawBoltIcon(0, barY - 34, 1.6 * pulse);                    // 頭頂大閃電（同款）
      drawBoltIcon(-36, barY - 14, 0.85 * pulse);                 // 左小
      drawBoltIcon(36, barY - 16, 0.9 * pulse);                   // 右小
      ctx.restore();
    }

    // 汗滴（用力峰值噴發）
    updateAndDrawSweat(lift, hy);
  }

  // 右側 Q 版吉他手（可切換角色；手臂會隨拍擺動）
  function drawGuitarist(songTime) {
    if (guitaristId === "none") return;
    var char = GUITARISTS[guitaristId] || GUITARISTS.slash;
    var hgt = guitaristHeight();                                    // 人物加大(上限 470)
    var rise = 30 + hypeShown * (H * 0.16);                         // 舞台更高
    var cx = (stageLeftX() + W) / 2, floorY = H * 0.88, groundY = floorY - rise, headY = groundY - hgt * 0.86;   // 樂手站在舞台(右側寬台)正中央
    if (stageProcedural) {
      drawFollowSpot(cx, headY, groundY, hypeShown, songTime, hgt);        // 追蹤聚光燈打在樂手身上
      drawStageDeck(groundY, floorY, hypeShown, songTime);                 // 大舞台台面(右側寬台)
      drawAmpBackline(cx, groundY, hgt, hypeShown, songTime);              // 知名音箱 backline(角色左後方)＋音箱特效
    }
    var bob = Math.sin(songTime * 6.3) * 4, sway = Math.sin(songTime * 3.1) * 0.04;
    var s = hgt / 320 * (char.scale || 1) * (1 + charPulse * 0.07);
    ctx.save();
    ctx.translate(cx, groundY - bob - charPulse * 10);
    ctx.scale(s, s); ctx.rotate(sway);
    ctx.globalAlpha = 0.97;

    // 站上台：熱度高時打聚光暈(升降台改在螢幕座標另畫，見 drawStageRiser)
    if (hypeShown > 0.02) {
      var hl = hypeShown;
      var halo = ctx.createRadialGradient(0, -150, 20, 0, -150, 270);
      halo.addColorStop(0, "rgba(255,240,180," + (0.08 + hl * 0.22) + ")");
      halo.addColorStop(1, "rgba(255,240,180,0)");
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, -150, 270, 0, Math.PI * 2); ctx.fill();
    }
    // 連段段位慶祝爆發：角色身後放射光芒＋擴張光環(在角色之下先畫)
    if (comboBurst.t < 0.7) {
      var p = comboBurst.t / 0.7, fade = 1 - p;
      ctx.save();
      ctx.translate(0, -150); ctx.rotate(songTime * 1.2);
      ctx.strokeStyle = "rgba(255,224,130," + (0.55 * fade) + ")"; ctx.lineWidth = 6;
      for (var rb = 0; rb < 12; rb++) {
        var ang = rb / 12 * Math.PI * 2, r0 = 60 + p * 60, r1 = 150 + p * 240;
        ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0); ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,240,190," + (0.7 * fade) + ")"; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(0, 0, 90 + p * 260, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // 專屬：閃電嚕嚕安＝舉啞鈴重訓（非吉他姿勢）
    if (char.lift) { drawLifter(char, songTime); ctx.restore(); return; }

    // 身體
    ctx.fillStyle = char.torso; roundRect(-46, -150, 92, char.shorts ? 118 : 150, 20); ctx.fill();
    // 腿
    if (char.shorts) {
      ctx.fillStyle = char.torso; roundRect(-40, -40, 34, 22, 7); ctx.fill(); roundRect(6, -40, 34, 22, 7); ctx.fill();   // 短褲
      ctx.fillStyle = char.legs;  roundRect(-36, -20, 26, 20, 6); ctx.fill(); roundRect(10, -20, 26, 20, 6); ctx.fill();  // 裸腿
      ctx.fillStyle = "#f2f2f2";  ctx.fillRect(-36, -6, 26, 6); ctx.fillRect(10, -6, 26, 6);                              // 白襪
    } else {
      ctx.fillStyle = char.legs; roundRect(-40, -40, 34, 40, 8); ctx.fill(); roundRect(6, -40, 34, 40, 8); ctx.fill();
    }
    // 胸口 / 領帶
    ctx.fillStyle = char.chest; ctx.beginPath(); ctx.moveTo(-16, -150); ctx.lineTo(16, -150); ctx.lineTo(0, -106); ctx.closePath(); ctx.fill();
    if (char.tie) {
      ctx.fillStyle = char.tie;
      ctx.beginPath(); ctx.moveTo(-5, -146); ctx.lineTo(5, -146); ctx.lineTo(3, -118); ctx.lineTo(-3, -118); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-7, -118); ctx.lineTo(7, -118); ctx.lineTo(0, -104); ctx.closePath(); ctx.fill();
    }

    // 吉他（角色專屬）
    drawGuitar(char.guitar);

    // ---- 手臂（上臂＋前臂＋手，會擺動）----
    var sw = Math.sin(songTime * 9);                              // 刷弦擺動相位
    drawLimb([34, -140], [50, -100 + sw * 4], [14 + sw * 3, -56 + sw * 22], char.sleeve, char.skin, 15, 12);  // 刷弦臂
    ctx.save(); ctx.translate(14 + sw * 3, -56 + sw * 22); ctx.rotate(sw * 0.4);   // 撥片
    ctx.fillStyle = "#e8d24a"; ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(7, 4); ctx.lineTo(-2, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    var vib = Math.sin(songTime * 11) * 2;                        // 按弦臂（輕微揉弦）
    drawLimb([-34, -140], [-52, -108], [-54 + vib, -150 - vib], char.sleeve, char.skin, 15, 12);

    // 頭
    var hy = -206;
    ctx.fillStyle = char.skin; ctx.beginPath(); ctx.arc(0, hy, 50, 0, Math.PI * 2); ctx.fill();
    char.head(hy);

    ctx.restore();

    // 聚光燈打在身上的暖色高光(疊在角色上，讓人明顯被光照亮)
    if (stageProcedural) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var lit = 0.05 + hypeShown * 0.13, cyMid = groundY - hgt * 0.5;
      var hg = ctx.createRadialGradient(cx - hgt * 0.06, cyMid - hgt * 0.08, 8, cx, cyMid, hgt * 0.5);
      hg.addColorStop(0, "rgba(255,246,214," + lit + ")"); hg.addColorStop(1, "rgba(255,246,214,0)");
      ctx.fillStyle = hg; ctx.beginPath(); ctx.ellipse(cx, cyMid, hgt * 0.34, hgt * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // 右側大字評分動畫
  var JUDGE_WORD = { perfect: ["PERFECT!", "#ffd93d"], great: ["GREAT!", "#5ec26a"], good: ["GOOD", "#5b8def"], miss: ["MISS…", "#ff5d6c"] };
  function drawBigJudge() {
    if (!bigJudge) return;
    bigJudge.t += 1 / 60;
    if (bigJudge.t > 0.85) { bigJudge = null; return; }
    var p = bigJudge.t / 0.85, info = JUDGE_WORD[bigJudge.tier];
    var scl = p < 0.24 ? (0.5 + (p / 0.24) * 0.78) : (1.28 - (p - 0.24) / 0.76 * 0.28);
    var alpha = p < 0.72 ? 1 : (1 - (p - 0.72) / 0.28);
    var cx = W * 0.5, cy = H * 0.38 - p * 20;
    // 判定字（畫面置中）
    ctx.save();
    ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.scale(scl, scl); ctx.rotate(-0.05);
    ctx.font = "900 60px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 9; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText(info[0], 0, 0);
    ctx.fillStyle = info[1]; ctx.fillText(info[0], 0, 0);
    ctx.restore();
    // 倍數（×2/×3…）＋ 連段（命中時才顯示）
    if (bigJudge.tier !== "miss" && bigJudge.combo > 1) {
      var mult = comboMult(bigJudge.combo), by = cy + 54;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (mult >= 2) {
        var ms = 1 + (mult - 2) * 0.09;                       // 倍數越高字越大
        ctx.save(); ctx.translate(cx, by); ctx.scale(ms, ms);
        ctx.font = "900 46px system-ui, sans-serif";
        ctx.lineWidth = 9; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText("×" + mult, 0, 0);
        ctx.fillStyle = "#ffd93d"; ctx.fillText("×" + mult, 0, 0);
        ctx.restore();
        by += 40;
      }
      ctx.font = "800 22px system-ui, sans-serif";
      ctx.lineWidth = 5; ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeText(bigJudge.combo + " COMBO", cx, by);
      ctx.fillStyle = "#fff"; ctx.fillText(bigJudge.combo + " COMBO", cx, by);
      ctx.restore();
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    var playingNow = (state === "playing" || state === "paused");
    var hypeTarget = (playingNow && current) ? Math.min(current.combo / 36, 1) : 0;
    hypeShown += (hypeTarget - hypeShown) * 0.06;                    // 連段越高→熱度越高；miss 歸零時平滑降溫
    if (comboBurst.t < 999) comboBurst.t += 0.016;                   // 推進連段慶祝爆發動畫
    drawBackground();
    if (state === "playing" || state === "paused") {
      var songTime = A.getSongTime();
      drawGuitarist(songTime);                                          // 角色＋舞台(在音符之下)
      if (stageProcedural) drawCrowd(hypeShown, songTime, guitaristHeight());   // 台下觀眾(前景，約樂手1/4高、前後交錯)
      if (displayMode === "rocksmith") renderRocksmith(songTime);
      else if (displayMode === "tab") renderTab(songTime);
      else renderJianpu(songTime);
      drawBigJudge();                                                   // 大字評分(最上層)
      charPulse = Math.max(0, charPulse - 0.05);
      drawHud(songTime);
      if (songTime < 0) {                                                                     // 開場先「準備」，再倒數 4 拍
        var countIn = 4 * countBeat;
        if (songTime >= -countIn) drawCenterText(String(Math.min(4, Math.ceil(-songTime / countBeat))), true);
        else drawCenterText("準備", true);
      }
      if (state === "paused") drawCenterText("已暫停　（空白鍵繼續）");
    }
  }

  // --- Rocksmith 風：透視琴頸公路 ---
  // 弦色（低E→高e，依 Rocksmith 慣例；slot0=低E 在左）
  var ROCK_COLS = ["#ff5d5d", "#ffd93d", "#4a9cff", "#ff9a3c", "#3ec46a", "#c06cff"];
  function rockAnchorTop() { return H - Math.max(130, Math.min(190, H * 0.32)); }   // 底部擬真指板加大
  function rockGeom() { return { cx: W * 0.5, topY: 20, strikeY: rockAnchorTop() - 10, farHalf: W * 0.05, nearHalf: W * 0.46 }; }
  function rockAt(p) {                                     // p: 0 遠 → 1 打擊線
    var G = rockGeom();
    return { cx: G.cx, y: G.topY + (G.strikeY - G.topY) * p, half: G.farHalf + (G.nearHalf - G.farHalf) * p, scale: 0.3 + 0.7 * p };
  }
  function rockStringX(slot, p) { var a = rockAt(p); return a.cx + ((slot - 2.5) / 2.5) * a.half; }

  function renderRocksmith(songTime) {
    var aFar = rockAt(0), aNear = rockAt(1);
    // 琴頸表面（深色木質梯形）
    ctx.beginPath();
    ctx.moveTo(aFar.cx - aFar.half, aFar.y); ctx.lineTo(aFar.cx + aFar.half, aFar.y);
    ctx.lineTo(aNear.cx + aNear.half, aNear.y); ctx.lineTo(aNear.cx - aNear.half, aNear.y); ctx.closePath();
    var ng = ctx.createLinearGradient(0, aFar.y, 0, aNear.y);
    ng.addColorStop(0, "rgba(24,18,14,0.15)"); ng.addColorStop(1, "rgba(42,31,22,0.72)");
    ctx.fillStyle = ng; ctx.fill();
    // 琴衍（橫向）＋鑲嵌點（越遠越密，帶景深）
    for (var r = 1; r <= 9; r++) {
      var pr = 1 - Math.pow(1 - r / 10, 1.7), aR = rockAt(pr);
      ctx.strokeStyle = "rgba(205,208,220," + (0.10 + aR.scale * 0.32) + ")"; ctx.lineWidth = Math.max(1, aR.scale * 3);
      ctx.beginPath(); ctx.moveTo(aR.cx - aR.half, aR.y); ctx.lineTo(aR.cx + aR.half, aR.y); ctx.stroke();
      if (r % 2 === 1) { ctx.fillStyle = "rgba(215,215,230," + (0.12 + aR.scale * 0.25) + ")"; ctx.beginPath(); ctx.arc(aR.cx, aR.y, 2.5 * aR.scale + 1, 0, Math.PI * 2); ctx.fill(); }
    }
    // 6 條收束的上色弦（低音弦較粗）
    for (var s = 0; s < 6; s++) {
      var xF = rockStringX(s, 0), xB = rockStringX(s, 1), wN = 3.4 - s * 0.4;
      ctx.globalAlpha = 0.72; ctx.fillStyle = ROCK_COLS[s];
      ctx.beginPath(); ctx.moveTo(xF - 0.6, aFar.y); ctx.lineTo(xF + 0.6, aFar.y); ctx.lineTo(xB + wN, aNear.y); ctx.lineTo(xB - wN, aNear.y); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 音符寶石（由遠而近，寶石上標實際格位）
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    for (var i = 0; i < items.length; i++) {
      var it = items[i], remain = it.time - songTime;
      if (remain > travel || remain < -0.16) continue;
      var p = Math.max(0, 1 - remain / travel), a = rockAt(p), notes = it.notes || [];
      var alpha = it.judged ? (it.missed ? 0.16 : 0.28) : Math.min(1, 0.4 + p * 0.6);
      for (var j = 0; j < notes.length; j++) {
        var n = notes[j], slot = 5 - n.row, gx = rockStringX(slot, p), gy = a.y;
        var w = 52 * a.scale, hh = 34 * a.scale, col = ROCK_COLS[slot];
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col; roundRect(gx - w / 2, gy - hh / 2, w, hh, 8 * a.scale); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = 2 * a.scale; roundRect(gx - w / 2, gy - hh / 2, w, hh, 8 * a.scale); ctx.stroke();
        ctx.font = "800 " + Math.round(22 * a.scale) + "px system-ui, sans-serif";
        ctx.lineWidth = 3.5 * a.scale; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeText(String(n.fret), gx, gy);
        ctx.fillStyle = "#fff"; ctx.fillText(String(n.fret), gx, gy);
      }
    }
    ctx.globalAlpha = 1;
    // 打擊線 + 各弦色標（命中閃動）
    ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(aNear.cx - aNear.half, aNear.y); ctx.lineTo(aNear.cx + aNear.half, aNear.y); ctx.stroke();
    for (var ss = 0; ss < 6; ss++) {
      var fl = flashByString[ss] || 0, sx = rockStringX(ss, 1);
      ctx.globalAlpha = 0.9; ctx.fillStyle = ROCK_COLS[ss];
      ctx.beginPath(); ctx.arc(sx, aNear.y, 7 + fl * 7, 0, Math.PI * 2); ctx.fill();
      if (fl > 0) { ctx.globalAlpha = fl * 0.6; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sx, aNear.y, 5 + fl * 6, 0, Math.PI * 2); ctx.fill(); }
      flashByString[ss] = Math.max(0, fl - 0.06);
    }
    ctx.globalAlpha = 1;
    // 底部真實指板（顯示實際格位，Rocksmith 手位錨點）
    drawRockAnchor(songTime);
  }

  // 底部擬真指板：水平 6 弦 + 真實格位間距 + 鑲嵌點 + 格號；高亮即將要按的音（加大加寬）
  function drawRockAnchor(songTime) {
    var top = rockAnchorTop(), bot = H - 6, h = bot - top;
    if (h < 26) return;
    var x0 = 10, x1 = W - 10, wNeck = x1 - x0, maxF = 12;                              // 少一點格數＝每格更寬
    var denom = 1 - Math.pow(2, -maxF / 12);
    function fx(f) { return x0 + wNeck * (1 - Math.pow(2, -f / 12)) / denom; }          // 真實琴格間距
    function cellX(f) { return f <= 0 ? x0 + 8 : (fx(f - 1) + fx(f)) / 2; }
    function strY(slot) { return bot - 9 - (slot + 0.5) * (h - 18) / 6; }               // slot0=低E 在下
    var wg = ctx.createLinearGradient(0, top, 0, bot);
    wg.addColorStop(0, "#442f1e"); wg.addColorStop(1, "#241a12");
    ctx.fillStyle = wg; roundRect(x0, top, wNeck, h, 8); ctx.fill();
    ctx.fillStyle = "#0d0d12"; ctx.fillRect(x0, top, 6, h);                             // 上弦枕
    // 琴衍
    ctx.strokeStyle = "rgba(205,207,220,0.6)"; ctx.lineWidth = 2.5;
    for (var f = 1; f <= maxF; f++) { var x = fx(f); ctx.beginPath(); ctx.moveTo(x, top + 2); ctx.lineTo(x, bot - 2); ctx.stroke(); }
    // 鑲嵌點（3/5/7/9 單，12 雙）
    ctx.fillStyle = "rgba(234,234,246,0.55)";
    [3, 5, 7, 9].forEach(function (f) { ctx.beginPath(); ctx.arc(cellX(f), (top + bot) / 2, 4.5, 0, Math.PI * 2); ctx.fill(); });
    ctx.beginPath(); ctx.arc(cellX(12), top + h * 0.3, 4.5, 0, Math.PI * 2); ctx.arc(cellX(12), bot - h * 0.3, 4.5, 0, Math.PI * 2); ctx.fill();
    // 6 條弦（低E在下、較粗）
    for (var s = 0; s < 6; s++) {
      ctx.strokeStyle = ROCK_COLS[s]; ctx.globalAlpha = 0.92; ctx.lineWidth = 2 + (5 - s) * 0.6;
      var yy = strY(s); ctx.beginPath(); ctx.moveTo(x0 + 6, yy); ctx.lineTo(x1, yy); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 格號
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "700 14px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    [3, 5, 7, 9, 12].forEach(function (f) { ctx.fillText(String(f), cellX(f), bot - 4); });
    // 高亮：即將／正在按的音（該弦該格亮起，加大）
    ctx.textBaseline = "middle";
    for (var i = 0; i < items.length; i++) {
      var it = items[i], rem = it.time - songTime;
      if (rem > 0.4 || rem < -0.12) continue;
      var glow = 1 - Math.min(1, Math.abs(rem) / 0.4), notes = it.notes || [];
      for (var j = 0; j < notes.length; j++) {
        var n = notes[j], slot = 5 - n.row, cxp = cellX(n.fret), yy2 = strY(slot);
        ctx.globalAlpha = 0.4 + 0.6 * glow; ctx.fillStyle = ROCK_COLS[slot];
        ctx.beginPath(); ctx.arc(cxp, yy2, 10 + glow * 4, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.font = "800 14px system-ui, sans-serif";
        ctx.fillText(String(n.fret), cxp, yy2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- 簡譜直向 ---
  function renderJianpu(songTime) {
    for (var l = 0; l < LANES; l++) {
      var x = laneX(l), w = laneW();
      ctx.fillStyle = (l % 2 === 0) ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.055)";
      ctx.fillRect(x, 0, w, H);
      if (laneFlash[l] > 0) {
        ctx.fillStyle = "rgba(255,255,255," + (0.12 * laneFlash[l]) + ")";
        ctx.fillRect(x, 0, w, H);
        laneFlash[l] = Math.max(0, laneFlash[l] - 0.08);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, judgeY); ctx.lineTo(W, judgeY); ctx.stroke(); ctx.lineWidth = 1;

    drawKeypad(judgeY + 8, 74);

    for (var i = 0; i < items.length; i++) {
      var n = items[i];
      if (n.deadOnly) continue;                                 // 純死音拍無簡譜級數，垂直簡譜模式不畫
      if (n.judged && (n.hit || songTime - n.time > 0.4)) continue;
      var remain = n.time - songTime;
      if (remain > travel + 0.1 || remain < -0.5) continue;
      var y = (1 - remain / travel) * judgeY;
      drawJianpuNote(n, y);
    }
    drawPopupsVertical();
  }

  function drawJianpuNote(n, y) {
    y = Math.round(y);                              // 對齊像素
    var x = laneX(n.lane), w = laneW(), pad = 5, nh = 60, cx = x + w / 2;
    ctx.fillStyle = LANE_COLORS[n.lane];            // 銳利填色（不用 shadowBlur，避免拖尾）
    roundRect(x + pad, y - nh / 2, w - pad * 2, nh, 12); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(0,0,0,0.28)";
    roundRect(x + pad, y - nh / 2, w - pad * 2, nh, 12); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = "#161616"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.fillText(n.symbol + String(n.degree), cx, y + 1);
    if (n.dur != null) drawRhythmMarks(cx, y + 1, 15, rhythmMarks(n.dur), "#161616", false);  // 節奏底線＋附點
    drawOctaveDots(n, cx, y, nh);
  }
  function drawOctaveDots(n, cx, y, nh) {
    var off = n.octaveOffset; if (!off) return;
    var count = Math.min(Math.abs(off), 3);
    ctx.fillStyle = "#161616";
    var spacing = 8, r = 2.6, startX = cx - (count - 1) * spacing / 2;
    var dy = off > 0 ? (y - nh / 2 - 6) : (y + nh / 2 + 6);
    for (var i = 0; i < count; i++) { ctx.beginPath(); ctx.arc(startX + i * spacing, dy, r, 0, Math.PI * 2); ctx.fill(); }
  }

  // --- 六線譜橫向 ---
  function renderTab(songTime) {
    pad = null;   // 六線譜模式沒有觸控鍵盤
    var view = (els.bottomSelect && els.bottomSelect.value) || "jianpu";
    var labelW = 54, topPad = 40;
    var bandH = (view === "fretboard") ? Math.min(200, Math.round(H * 0.4)) : 92;   // 指板圖加大、簡譜列加大
    var bandTop = H - bandH - 8;
    var jY = bandTop + bandH / 2;       // 簡譜列中心
    var sBot = bandTop - 12;            // 弦線底部
    var sc = tabInfo.stringCount, tuning = tabInfo.tuning;
    var rowGap = (sBot - topPad) / Math.max(1, sc - 1);
    var hitX = labelW + (W - labelW) * 0.18;
    var pxPerSec = (W - hitX) / travel;

    // 弦線 + 弦名（弦粗細像真吉他：第1弦(高e,row0)最細 → 第6弦(低E,row5)最粗）
    for (var r = 0; r < sc; r++) {
      var y = topPad + r * rowGap;
      ctx.strokeStyle = "rgba(230,235,245,0.34)"; ctx.lineWidth = 0.8 + r * 0.7;
      ctx.beginPath(); ctx.moveTo(labelW, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(NOTE_NAMES[pc(tuning[r])], labelW - 8, y);
    }
    ctx.lineWidth = 1;

    // 下方：簡譜列（只在簡譜檢視顯示）— GP/KTV 式播放：小節線＋小節號＋當前音高亮
    if (view === "jianpu") {
      var sTop = jY - 38, sH = 76;
      ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(labelW, sTop, W - labelW, sH);
      // 小節線＋小節號（隨譜捲動）
      for (var bi = 0; bi < barStartsScaled.length; bi++) {
        var bx = hitX + (barStartsScaled[bi] - songTime) * pxPerSec;
        if (bx < labelW - 2 || bx > W + 2) continue;
        ctx.strokeStyle = (bi % 4 === 0) ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.22)"; ctx.lineWidth = (bi % 4 === 0) ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(bx, sTop + 2); ctx.lineTo(bx, sTop + sH - 2); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "10px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(String(bi + 1), bx + 3, sTop + 3);
      }
      ctx.lineWidth = 1;
      ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText("簡譜", labelW - 8, jY);
    }
    // KTV：找最接近判定線的音（當前音）供高亮
    var curJ = -1, curBest = 1e9;
    if (view === "jianpu") {
      for (var ci = 0; ci < items.length; ci++) { var dd = Math.abs(items[ci].time - songTime); if (dd < curBest) { curBest = dd; curJ = ci; } }
    }

    // 判定線
    var topY = topPad - 16, botY = (view === "jianpu") ? (jY + 26) : (sBot + 10);
    ctx.fillStyle = "rgba(91,141,239,0.12)"; ctx.fillRect(hitX - 22, topY, 44, botY - topY);
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(hitX, topY); ctx.lineTo(hitX, botY); ctx.stroke(); ctx.lineWidth = 1;

    // 音符（六線譜）+ 同步簡譜
    var strip = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.judged && (it.hit || songTime - it.time > 0.4)) continue;
      var x = hitX + (it.time - songTime) * pxPerSec;
      if (x < labelW - 40 || x > W + 40) continue;
      for (var j = 0; j < it.notes.length; j++) {
        var nn = it.notes[j];
        var baseY = topPad + nn.row * rowGap;
        var defl = 0;                                    // 推弦往下位移量(px)
        if (nn.bend > 0) {
          var t = 1 - (x - hitX) / 110;
          t = Math.max(0, Math.min(1, t));
          var strings = nn.bend / 2;                     // 半音→往下1弦、全音→往下2弦
          var target = strings * rowGap - 17;
          var maxDown = (sBot - baseY) + rowGap * 0.4;   // 不壓出弦區太多
          defl = Math.max(0, Math.min(t * Math.max(0, target), maxDown));
          if (defl > 0.5) drawBendString(x, baseY, defl, nn);
        }
        var vib = nn.vibrato ? Math.sin(x * 0.18) * (nn.vibrato >= 2 ? 5 : 3) : 0;  // 揉弦抖動
        var ny = baseY + defl + vib;
        if (nn.hammerOrigin && nn.linkTime != null) {    // 搥弦/勾弦連接弧線
          var x2 = hitX + (nn.linkTime - songTime) * pxPerSec;
          drawHammerSlur(x, ny, x2, topPad + nn.linkRow * rowGap, nn);
        }
        if (nn.slideOut || nn.slideIn) drawSlide(x, ny, nn);   // 滑音斜線
        drawTabNote(x, ny, nn, it.tier);
      }
      if (it.chord) drawChordLabel(x, topPad - 10, it.chord);   // GP 譜標示的和弦名(顯示在該拍上方)
      if (it.deadNotes) {                                       // 死音/悶音(X)：只顯示、不判定
        for (var dj = 0; dj < it.deadNotes.length; dj++) drawDeadNote(x, topPad + it.deadNotes[dj].row * rowGap);
      }
      if (view === "jianpu" && it.jianpu) strip.push({ x: x, jp: it.jianpu, dur: it.dur, nv: it.nv, dots: it.dots, tuplet: it.tuplet, t: it.time, cur: i === curJ });
    }
    if (view === "jianpu") drawJianpuStrip(strip, jY, sTop, sH, hitX);
    drawPopupsHorizontal(hitX, topPad);

    // 下方：指板圖（顯示本小節要按到的格子）
    if (view === "fretboard") drawFretboardMeasure(labelW, bandTop, bandH, songTime);
  }

  function currentBar(t) {
    var idx = 0;
    for (var i = 0; i < barStartsScaled.length; i++) { if (barStartsScaled[i] <= t + 1e-6) idx = i; else break; }
    return idx;
  }

  function curFretStyle() {
    var v = (els.fretStyleSelect && els.fretStyleSelect.value) || "rosewood";
    return FRETBOARD_STYLES[v] || FRETBOARD_STYLES.rosewood;
  }
  function dotAt(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  function sharkFin(x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y + s * 0.7);
    ctx.lineTo(x, y + s * 0.15); ctx.lineTo(x - s * 0.8, y + s * 0.7); ctx.closePath(); ctx.fill();
  }
  function leafShape(x, y, s, tilt) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function drawVine(fbLeft, colW, gridTop, gridBot, maxFret, color) {
    var midY = (gridTop + gridBot) / 2, amp = (gridBot - gridTop) * 0.3;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (var f = 0; f <= maxFret + 0.5; f += 0.2) {
      var x = fbLeft + (f + 0.5) * colW, y = midY + Math.sin(f * 1.15) * amp;
      if (f === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (var g = 1; g <= maxFret; g++) {
      var vx = fbLeft + (g + 0.5) * colW, vy = midY + Math.sin(g * 1.15) * amp;
      leafShape(vx, vy, colW * 0.17, Math.cos(g * 1.15) >= 0 ? -0.6 : 0.6);
    }
    ctx.restore();
  }
  function drawInlays(st, fbLeft, colW, gridTop, gridBot, rowGap, maxFret) {
    if (st.inlay === "vine") { drawVine(fbLeft, colW, gridTop, gridBot, maxFret, st.inlayColor); return; }
    var midY = (gridTop + gridBot) / 2;
    ctx.save(); ctx.fillStyle = st.inlayColor;
    var marks = INLAY_SINGLE.concat(INLAY_DOUBLE);
    for (var m = 0; m < marks.length; m++) {
      var f = marks[m]; if (f > maxFret) continue;
      var cx = fbLeft + (f + 0.5) * colW, isDbl = INLAY_DOUBLE.indexOf(f) >= 0;
      if (st.inlay === "block") {
        var bw = colW * 0.5, bh = (gridBot - gridTop) * 0.8;
        ctx.fillRect(cx - bw / 2, midY - bh / 2, bw, bh);
      } else if (st.inlay === "shark") {
        var s = Math.min(colW * 0.34, rowGap * 1.1);
        if (isDbl) { sharkFin(cx, midY - rowGap * 0.9, s); sharkFin(cx, midY + rowGap * 0.9, s); }
        else sharkFin(cx, midY, s);
      } else { // dot
        if (isDbl) { dotAt(cx, midY - rowGap * 0.95, 4.5); dotAt(cx, midY + rowGap * 0.95, 4.5); }
        else dotAt(cx, midY, 5);
      }
    }
    ctx.restore();
  }

  // 指板圖：24 格，套用選定樣式，顯示所選範圍(拍/小節)要按的弦/格
  function drawFretboardMeasure(fbLeft, top, h, songTime) {
    var st = curFretStyle();
    var sc = tabInfo.stringCount, tuning = tabInfo.tuning;
    var maxFret = 17, nCols = maxFret + 1;   // 少顯示幾格→每格更寬、點更大（涵蓋多數把位）
    var fbRight = W - 10, gridTop = top + 16, gridBot = top + h - 22;
    var rowGap = (gridBot - gridTop) / Math.max(1, sc - 1);
    var colW = (fbRight - fbLeft) / nCols;

    ctx.save();
    roundRect(fbLeft, top, fbRight - fbLeft, h, 8); ctx.clip();
    var wood = ctx.createLinearGradient(0, top, 0, top + h);
    wood.addColorStop(0, st.wood[0]); wood.addColorStop(1, st.wood[1]);
    ctx.fillStyle = wood; ctx.fillRect(fbLeft, top, fbRight - fbLeft, h);

    drawInlays(st, fbLeft, colW, gridTop, gridBot, rowGap, maxFret);   // 鑲嵌(在弦線底下)

    // 品絲 + 上弦枕
    for (var c = 1; c <= maxFret; c++) {
      var fx = fbLeft + c * colW;
      ctx.strokeStyle = st.fretwire; ctx.lineWidth = (c === 12 || c === 24) ? 2.5 : 1.4;
      ctx.beginPath(); ctx.moveTo(fx, gridTop - 5); ctx.lineTo(fx, gridBot + 5); ctx.stroke();
    }
    ctx.strokeStyle = st.nut; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(fbLeft, gridTop - 5); ctx.lineTo(fbLeft, gridBot + 5); ctx.stroke();
    ctx.lineWidth = 1;

    // 弦線 + 弦名
    for (var r = 0; r < sc; r++) {
      var y = gridTop + r * rowGap;
      ctx.strokeStyle = st.string; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(fbLeft, y); ctx.lineTo(fbRight, y); ctx.stroke();
      ctx.fillStyle = "rgba(245,240,228,0.65)"; ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText(NOTE_NAMES[pc(tuning[r])], fbLeft - 4, y);
    }
    // 格號
    ctx.fillStyle = "rgba(245,240,228,0.55)"; ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var f2 = 1; f2 <= maxFret; f2++) ctx.fillText(String(f2), fbLeft + (f2 + 0.5) * colW, gridBot + 12);

    // 依「指板範圍」過濾要顯示的音
    var win = (els.fretWindowSelect && els.fretWindowSelect.value) || "4";
    var useBar = (win === "bar2"), curB = currentBar(songTime), positions = {};
    var secPerBeat = (60 / (timeline.tempo || 120)) / speed;
    var t0 = songTime - 0.08, t1 = songTime + (parseInt(win, 10) || 4) * secPerBeat;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], inWin = useBar ? (it.bar === curB || it.bar === curB + 1) : (it.time >= t0 && it.time <= t1);
      if (!inWin) continue;
      var cur = Math.abs(it.time - songTime) < 0.28;
      for (var j = 0; j < it.notes.length; j++) {
        var nn = it.notes[j]; if (nn.fret > maxFret) continue;
        var key = nn.row + "-" + nn.fret;
        if (!positions[key]) positions[key] = { row: nn.row, fret: nn.fret, degree: nn.degree, tech: noteHasTech(nn), cur: false };
        if (cur) positions[key].cur = true;
      }
    }
    var rad = Math.max(10, Math.min(18, colW * 0.42, rowGap * 0.46));
    for (var k in positions) {
      var p = positions[k];
      var dx = fbLeft + (p.fret + 0.5) * colW, dy = gridTop + p.row * rowGap;
      var col = p.tech ? LANE_COLORS[p.degree - 1] : (p.cur ? "#ffffff" : st.noteBg);
      if (p.cur) { ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 12; }
      ctx.fillStyle = col; dotAt(dx, dy, rad);
      if (p.cur) ctx.restore();
      ctx.lineWidth = 2; ctx.strokeStyle = p.cur ? "#fff" : "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.arc(dx, dy, rad, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = p.tech ? "#161616" : st.noteFg;
      ctx.font = "bold " + Math.round(rad * 0.95) + "px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(p.fret), dx, dy + 1);
    }
    // 範圍標示
    ctx.fillStyle = "rgba(245,240,228,0.6)"; ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(useBar ? ("第 " + (curB + 1) + "–" + (curB + 2) + " 小節") : ("接下來 " + win + " 拍"), fbLeft + 4, top + 3);
    ctx.restore();
  }

  // 推弦特效：GP 譜風格的拋物線（先沿弦平走，再彎向下方目標；箭頭朝下）
  function drawBendString(x, baseY, defl, nn) {
    var col = LANE_COLORS[nn.degree - 1];
    var x0 = x - Math.max(34, defl * 0.6);
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.92; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x0, baseY);
    ctx.bezierCurveTo(x, baseY, x, baseY + defl * 0.5, x, baseY + defl);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1;
  }

  // 搥弦/勾弦：連接起音與目的音的弧線 + H(搥)/P(勾) 標記
  function drawHammerSlur(x1, y1, x2, y2, nn) {
    var col = LANE_COLORS[nn.degree - 1], rad = 15, topy = Math.min(y1, y2) - 24, mx = (x1 + x2) / 2;
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x1, y1 - rad);
    ctx.quadraticCurveTo(mx, topy, x2, y2 - rad);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = col; ctx.font = "bold 12px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((nn.linkFret != null && nn.linkFret > nn.fret) ? "H" : "P", mx, topy - 6);
    ctx.lineWidth = 1;
  }

  // 滑音：穿過音符的斜線（往高音右上、往低音右下）
  function drawSlide(x, y, nn) {
    var col = LANE_COLORS[nn.degree - 1], L = 22;
    var down = (nn.slideOut === 4 || nn.slideOut === 5 || nn.slideIn === 2);
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.globalAlpha = 0.8;
    ctx.beginPath();
    if (down) { ctx.moveTo(x - L, y - L * 0.6); ctx.lineTo(x + L, y + L * 0.6); }
    else { ctx.moveTo(x - L, y + L * 0.6); ctx.lineTo(x + L, y - L * 0.6); }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 1; ctx.lineCap = "butt";
  }

  // 簡譜字符：級數(依級數上色) + 升降前綴 + 八度點
  // 一拍(四分音符)秒數(已含倍速)
  function beatSec() { return 60 / ((timeline && timeline.tempo) || 120) / (speed || 1); }
  // 由時值(秒)推簡譜節奏記號：u=底線數(八分/十六分…)、d=增時線數(二分/全音符)、dot=附點
  var RHYTHM_TABLE = [[4,0,3,0],[3,0,2,0],[2,0,1,0],[1.5,0,0,1],[1,0,0,0],[0.75,1,0,1],[0.5,1,0,0],[0.375,2,0,1],[0.25,2,0,0],[0.1875,3,0,1],[0.125,3,0,0]];
  function rhythmMarks(durSec) {
    var beats = durSec / beatSec();
    if (!(beats > 0)) return { u: 0, d: 0, dot: false };
    var lb = Math.log(beats), best = RHYTHM_TABLE[4], bd = 1e9;
    for (var i = 0; i < RHYTHM_TABLE.length; i++) { var e = RHYTHM_TABLE[i], dd = Math.abs(lb - Math.log(e[0])); if (dd < bd) { bd = dd; best = e; } }
    return { u: best[1], d: best[2], dot: !!best[3] };
  }
  // 由「書寫音值」精算節奏記號（連音正確：六連音的十六分仍畫兩條底線，不會被時值近似成三條）
  // nv: 1全/2半/4四分/8八分/16十六分…；dots: 附點數。無 nv 時退回以時值近似。
  function marksOf(o) {
    if (o && typeof o.nv === "number" && o.nv > 0) {
      var u = 0, d = 0, nv = o.nv;
      if (nv >= 8) u = Math.round(Math.log(nv / 4) / Math.log(2)); // 8→1,16→2,32→3,64→4
      else if (nv === 2) d = 1;                                    // 二分：一條增時線
      else if (nv === 1) d = 3;                                    // 全音：三條增時線
      return { u: u, d: d, dot: (o.dots || 0) > 0 };
    }
    return rhythmMarks(o && o.dur != null ? o.dur : 0);
  }
  // 畫節奏記號：底線在數字下、附點與增時線在數字右
  function drawRhythmMarks(cx, y, hw, m, color, dashes) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "butt";
    for (var i = 0; i < m.u; i++) { var uy = y + 13 + i * 4; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - hw, uy); ctx.lineTo(cx + hw, uy); ctx.stroke(); }
    var rx = cx + hw + 5;
    if (m.dot) { ctx.beginPath(); ctx.arc(rx, y, 2.3, 0, Math.PI * 2); ctx.fill(); rx += 8; }
    if (dashes) for (var d = 0; d < m.d; d++) { ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(rx, y); ctx.lineTo(rx + 11, y); ctx.stroke(); rx += 16; }
  }

  // 某時間點落在第幾拍（供 beam 分組）
  function beatIndexOf(t) {
    var idx = 0;
    for (var i = 0; i < beatTimes.length; i++) { if (beatTimes[i] <= t + 1e-6) idx = i; else break; }
    return idx;
  }
  // 底部簡譜列：數字＋依拍分組的連底線(beam)＋附點/增時線/八度點＋播放位置線
  function drawJianpuStrip(notes, y, sTop, sH, hitX) {
    var hw = 15, i, k, L;
    for (i = 0; i < notes.length; i++) { var m = marksOf(notes[i]); notes[i].u = m.u; notes[i].d = m.d; notes[i].dot = m.dot; notes[i].beat = beatIndexOf(notes[i].t); }
    // 連底線：同一拍內，每個層級(L=八分/十六分/三十二分)畫連續段落；四分無底線＝獨立
    ctx.strokeStyle = "rgba(232,236,244,0.92)"; ctx.lineCap = "butt";
    var gi = 0;
    while (gi < notes.length) {
      var gj = gi; while (gj + 1 < notes.length && notes[gj + 1].beat === notes[gi].beat) gj++;   // [gi..gj] 同拍
      for (L = 1; L <= 3; L++) {
        var runStart = -1;
        for (k = gi; k <= gj + 1; k++) {
          var has = (k <= gj) && notes[k].u >= L;
          if (has && runStart < 0) runStart = k;
          if (!has && runStart >= 0) {
            var y2 = y + 18 + (L - 1) * 5;
            var x0 = notes[runStart].x - hw, x1 = (k - 1 === runStart) ? notes[runStart].x + hw : notes[k - 1].x + hw;
            ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(x0, y2); ctx.lineTo(x1, y2); ctx.stroke();
            runStart = -1;
          }
        }
      }
      gi = gj + 1;
    }
    // 數字＋附點＋增時線＋八度點＋KTV 高亮
    for (i = 0; i < notes.length; i++) {
      var n = notes[i], jp = n.jp, x = Math.round(n.x);
      var col = jp.tech ? LANE_COLORS[jp.degree - 1] : NEUTRAL_NOTE;
      if (n.cur) { ctx.fillStyle = "rgba(255,214,61,0.92)"; roundRect(x - 20, y - 24, 40, 54, 9); ctx.fill(); col = "#161616"; }
      ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = (n.cur ? "bold 34px" : "bold 30px") + " system-ui, sans-serif";
      ctx.fillText(jp.symbol + String(jp.degree), x, y);
      if (n.dot) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + hw + 6, y, 3, 0, Math.PI * 2); ctx.fill(); }
      for (var dd = 0; dd < n.d; dd++) { ctx.strokeStyle = col; ctx.lineWidth = 3; var rx = x + hw + 10 + dd * 18; ctx.beginPath(); ctx.moveTo(rx, y); ctx.lineTo(rx + 14, y); ctx.stroke(); }
      var off = jp.octaveOffset;
      if (off) {
        ctx.fillStyle = n.cur ? "#161616" : col;
        var cnt = Math.min(Math.abs(off), 3), sp = 9, r = 3, sx = x - (cnt - 1) * sp / 2, dy = off > 0 ? y - 23 : y + 22 + n.u * 5;
        for (var q = 0; q < cnt; q++) { ctx.beginPath(); ctx.arc(sx + q * sp, dy, r, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // 連音括線：同一 tuplet 組的連續音，上方畫方括線＋數字（三連音「3」、六連音「6」…）
    i = 0;
    while (i < notes.length) {
      var tp = notes[i].tuplet;
      if (!tp || tp.gid < 0) { i++; continue; }
      var j = i;
      while (j + 1 < notes.length && notes[j + 1].tuplet && notes[j + 1].tuplet.gid === tp.gid) j++;
      if (j > i) {                                  // 至少兩個音才畫括線
        var bx0 = notes[i].x - hw, bx1 = notes[j].x + hw, by = y - 33, mid = (bx0 + bx1) / 2;
        ctx.strokeStyle = "rgba(180,210,255,0.92)"; ctx.fillStyle = "rgba(198,220,255,0.98)"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bx0, by + 6); ctx.lineTo(bx0, by); ctx.lineTo(mid - 8, by);   // 左半 + 左端下勾
        ctx.moveTo(mid + 8, by); ctx.lineTo(bx1, by); ctx.lineTo(bx1, by + 6);   // 右半 + 右端下勾
        ctx.stroke();
        ctx.font = "bold 13px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(tp.n), mid, by);
        ctx.lineWidth = 1;
      }
      i = j + 1;
    }

    // 播放位置線（即時彈到的位置）＋頂端三角
    ctx.strokeStyle = "#ffd93d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hitX, sTop); ctx.lineTo(hitX, sTop + sH); ctx.stroke();
    ctx.fillStyle = "#ffd93d"; ctx.beginPath(); ctx.moveTo(hitX - 5, sTop); ctx.lineTo(hitX + 5, sTop); ctx.lineTo(hitX, sTop + 7); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 1;
  }

  // 底部觸控鍵盤 = 吉他指板外觀（1–7 為琴格按鍵）；直向 / 橫向共用；記錄 pad 供觸控命中
  function drawKeypad(y0, h) {
    pad = { y0: y0, h: h };
    var lw = laneW(), cy = y0 + h / 2, st = curFretStyle();
    ctx.save();
    roundRect(0, y0, W, h, 10); ctx.clip();

    // 木紋底色（依選定樣式）
    var wood = ctx.createLinearGradient(0, y0, 0, y0 + h);
    wood.addColorStop(0, st.wood[0]); wood.addColorStop(1, st.wood[1]);
    ctx.fillStyle = wood; ctx.fillRect(0, y0, W, h);

    // 弦線（6 條，水平）
    ctx.strokeStyle = st.string; ctx.lineWidth = 1;
    for (var s = 0; s < 6; s++) {
      var sy = y0 + h * (s + 0.5) / 6;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    }

    // 指板記號點（第 3、5、7 格）
    ctx.fillStyle = st.inlayColor;
    [2, 4, 6].forEach(function (idx) {
      ctx.beginPath(); ctx.arc(laneX(idx) + lw / 2, cy, 5, 0, Math.PI * 2); ctx.fill();
    });

    // 品絲（垂直）+ 上弦枕（左邊粗線）
    for (var f = 1; f < LANES; f++) {
      var fx = laneX(f);
      ctx.strokeStyle = st.fretwire; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx, y0); ctx.lineTo(fx, y0 + h); ctx.stroke();
    }
    ctx.strokeStyle = st.nut; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(2, y0); ctx.lineTo(2, y0 + h); ctx.stroke();
    ctx.lineWidth = 1;

    // 按到某格時，在該格顯示一個圓點（手指位置）
    for (var k = 0; k < LANES; k++) {
      var fl = padFlash[k] || 0;
      if (fl <= 0) continue;
      var cx = laneX(k) + lw / 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, fl);
      ctx.shadowColor = "rgba(255,240,205,0.9)"; ctx.shadowBlur = 14;
      ctx.fillStyle = "#f4ecd6";
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = "rgba(60,40,20,0.55)";
      ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      padFlash[k] = Math.max(0, fl - 0.03);   // 慢一點淡出，看得清楚
    }
    ctx.lineWidth = 1;
    ctx.restore();
  }

  // 死音/悶音：六線譜上以灰色「✕」表示（無音高、不判定，純視覺參考）
  function drawDeadNote(x, y) {
    x = Math.round(x); y = Math.round(y);
    var r = 9;
    ctx.save();
    ctx.strokeStyle = "rgba(210,210,210,0.9)"; ctx.lineWidth = 3.2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
    ctx.restore();
  }

  function drawTabNote(x, y, n, tier) {
    x = Math.round(x); y = Math.round(y);          // 對齊像素，避免次像素抖動殘影
    var rad = 20, tech = noteHasTech(n);
    return drawTabNoteBody(x, y, n, rad, tech);
  }
  // 和弦名標籤（金色小膠囊，畫在該拍上方）
  function drawChordLabel(x, y, name) {
    name = String(name); if (!name) return;
    ctx.save();
    ctx.font = "bold 15px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var w = ctx.measureText(name).width + 14, h = 20;
    ctx.fillStyle = "rgba(224,164,75,0.95)";
    roundRect(Math.round(x - w / 2), Math.round(y - h), w, h, 6); ctx.fill();
    ctx.fillStyle = "#20160a"; ctx.fillText(name, x, y - h / 2 + 1);
    ctx.restore();
  }
  function drawTabNoteBody(x, y, n, rad, tech) {
    var col = tech ? LANE_COLORS[n.degree - 1] : NEUTRAL_NOTE;   // 單音中性色，技巧才上色
    ctx.save();
    if (n.palmMute) ctx.globalAlpha = 0.55;         // 悶音：暗化
    ctx.fillStyle = col;
    if (n.harmonic) {                               // 泛音：菱形 + 亮邊
      diamondPath(x, y, rad); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.85)";
      diamondPath(x, y, rad); ctx.stroke();
    } else {                                        // 一般：銳利實心圓
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 1;
    if (n.chordNote) {                              // 屬於和弦的單音：金色外環特別標注
      ctx.save();
      ctx.strokeStyle = "rgba(224,164,75,0.95)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = "#161616"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 19px system-ui, sans-serif";
    ctx.fillText(String(n.fret), x, y + 1);
    // 技巧標記
    if (n.bend > 0) {                               // 推弦向下箭頭
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y + rad + 5); ctx.lineTo(x, y + rad + 12); ctx.lineTo(x + 6, y + rad + 5);
      ctx.stroke(); ctx.lineWidth = 1;
    }
    if (n.vibrato) {                                // 揉弦波浪標記
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      var wy = y - rad - 7;
      ctx.beginPath();
      ctx.moveTo(x - 9, wy); ctx.quadraticCurveTo(x - 4.5, wy - 4, x, wy);
      ctx.quadraticCurveTo(x + 4.5, wy + 4, x + 9, wy);
      ctx.stroke(); ctx.lineWidth = 1;
    }
    if (n.palmMute) {                               // 悶音 PM 標記
      ctx.fillStyle = col; ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("PM", x, y - rad - 8);
    }
    if (n.tap) {                                    // 點弦：左上角 T
      ctx.fillStyle = col; ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillText("T", x - rad - 2, y - rad + 5);
    }
    if (n.trill) {                                  // 顫音：右上角 tr
      ctx.fillStyle = col; ctx.font = "bold italic 13px system-ui, sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("tr", x + rad + 2, y - rad + 5);
    }
    if (n.tremolo) {                                // 震音撥弦：音符上方三條斜線
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineCap = "round";
      var ty = y - rad - 4;
      for (var s = -1; s <= 1; s++) { ctx.beginPath(); ctx.moveTo(x + s * 6 - 3, ty + 3); ctx.lineTo(x + s * 6 + 3, ty - 3); ctx.stroke(); }
      ctx.lineWidth = 1; ctx.lineCap = "butt";
    }
    if (n.staccato) {                               // 斷奏：音符上方一個小實心點
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - rad - 6, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    if (n.letRing) {                                // 延音：往右延伸的虛線 + L.R.
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x + rad + 3, y); ctx.lineTo(x + rad + 26, y); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 1;
      ctx.fillStyle = col; ctx.font = "bold 8px system-ui, sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText("L.R.", x + rad + 3, y - 2);
    }
  }
  function diamondPath(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  }

  function drawPopupsVertical() {
    var labels = { perfect: ["PERFECT", "#ffd93d"], great: ["GREAT", "#5ec26a"], good: ["GOOD", "#5b8def"], miss: ["MISS", "#ff5d6c"] };
    for (var i = popups.length - 1; i >= 0; i--) {
      var p = popups[i]; p.t += 1 / 60;
      if (p.t > 0.6) { popups.splice(i, 1); continue; }
      var alpha = 1 - p.t / 0.6, cx = laneX(p.lane) + laneW() / 2, yy = judgeY - 40 - p.t * 40, info = labels[p.tier];
      ctx.globalAlpha = alpha; ctx.fillStyle = info[1];
      ctx.font = "bold 18px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(info[0], cx, yy); ctx.globalAlpha = 1;
    }
  }
  function drawPopupsHorizontal(hitX, topPad) {
    var labels = { perfect: ["PERFECT", "#ffd93d"], great: ["GREAT", "#5ec26a"], good: ["GOOD", "#5b8def"], miss: ["MISS", "#ff5d6c"] };
    var shown = 0;
    for (var i = popups.length - 1; i >= 0; i--) {
      var p = popups[i]; p.t += 1 / 60;
      if (p.t > 0.6) { popups.splice(i, 1); continue; }
      if (shown++ > 3) continue;
      var alpha = 1 - p.t / 0.6, info = labels[p.tier];
      ctx.globalAlpha = alpha; ctx.fillStyle = info[1];
      ctx.font = "bold 22px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(info[0], hitX, topPad - 26 - p.t * 26); ctx.globalAlpha = 1;
    }
  }

  function drawHud(songTime) {
    els.hudScore.textContent = score.toLocaleString();
    els.hudCombo.textContent = current.combo > 1
      ? ((comboMult(current.combo) >= 2 ? "×" + comboMult(current.combo) + "　" : "") + current.combo + " combo")
      : "";
    var total = stats.perfect + stats.great + stats.good + stats.miss;
    var accSum = stats.perfect * ACC.perfect + stats.great * ACC.great + stats.good * ACC.good;
    els.hudAcc.textContent = (total ? (accSum / total * 100) : 100).toFixed(1) + "%";
    els.progressFill.style.width = (Math.max(0, Math.min(1, songTime / (songDuration || 1))) * 100) + "%";
  }

  function drawCenterText(text, big) {
    if (!text) return;
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0, H / 2 - 60, W, 120);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = (big ? "bold 72px" : "bold 28px") + " system-ui, sans-serif";
    ctx.fillText(text, W / 2, H / 2);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmtTime(sec) { sec = Math.max(0, Math.round(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }

  window.JianpuGame = {
    loadArrayBuffer: loadArrayBuffer,
    gateOwnUse: gateOwnUse,              // 我的曲庫(自己上傳)播放前呼叫，未開通者扣每日免費次數
    ownGateBlockedMsg: ownGateBlockedMsg,
    start: startGame,
    getState: function () { return state; },
    getDebug: function () { return { score: score, combo: current && current.combo, stats: stats, songTime: A.getSongTime(), items: items && items.length, displayMode: displayMode, inputMode: inputMode }; },
    _micTick: function () { micTick(A.getSongTime()); }   // 測試用：手動觸發一次收音判定
  };

  document.addEventListener("DOMContentLoaded", init);
})();
