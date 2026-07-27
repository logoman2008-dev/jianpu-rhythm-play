// ===================================================================
// gp-loader.js — 用 alphaTab 解析 Guitar Pro 檔，抽出音符時間軸
// 只用 alphaTab 的「匯入器(importer)」做解析，不做繪譜，
// 因此不需要字型檔或 Web Worker。掛在 window.GPLoader。
// ===================================================================
(function () {
  "use strict";

  var QUARTER = 960;          // alphaTab 每四分音符的 tick 數
  var WHOLE = QUARTER * 4;    // 全音符 = 3840 ticks

  function beatTicks(beat) {
    var d = beat.duration;
    var base = d > 0 ? WHOLE / d : WHOLE * (-d); // 負值=倍全音符
    if (beat.dots === 1) base *= 1.5;
    else if (beat.dots >= 2) base *= 1.75;
    var tn = beat.tupletNumerator, td = beat.tupletDenominator;
    if (tn && td && tn > 0 && td > 0 && tn !== td) base *= td / tn;
    return base;
  }

  function barTicks(masterBar) {
    var num = masterBar.timeSignatureNumerator || 4;
    var den = masterBar.timeSignatureDenominator || 4;
    return WHOLE * num / den;
  }

  // 取一個 beat 中的「代表音」= 最高音（旋律頂音）。回傳 realValue(MIDI) 或 null
  function topNoteMidi(beat) {
    if (!beat.notes || beat.notes.length === 0) return null;
    var best = null;
    for (var i = 0; i < beat.notes.length; i++) {
      var n = beat.notes[i];
      if (n.isTieDestination) continue;      // 連結線的延續音不算新音符
      if (n.isDead) continue;                // 悶音
      var v = (typeof n.realValue === "number") ? n.realValue : null;
      if (v == null) continue;
      if (best == null || v > best) best = v;
    }
    return best;
  }

  // 取一個 beat 的「代表音」= 最高音，並回傳其推弦幅度。回傳 {midi, bend} 或 null
  function topNoteInfo(beat) {
    if (!beat.notes || beat.notes.length === 0) return null;
    var bestNote = null;
    for (var i = 0; i < beat.notes.length; i++) {
      var n = beat.notes[i];
      if (n.isTieDestination || n.isDead) continue;
      if (typeof n.realValue !== "number") continue;
      if (bestNote == null || n.realValue > bestNote.realValue) bestNote = n;
    }
    if (!bestNote) return null;
    var bend = 0;
    if (bestNote.hasBend && bestNote.bendPoints && bestNote.bendPoints.length) {
      for (var b = 0; b < bestNote.bendPoints.length; b++) {
        if (bestNote.bendPoints[b].value > bend) bend = bestNote.bendPoints[b].value;
      }
    }
    return { midi: bestNote.realValue, bend: bend };
  }

  function isGrace(beat) {
    // graceType: 0 = None
    return beat.graceType && beat.graceType !== 0;
  }

  function tempoAutomationValue(beat) {
    var autos = beat.automations;
    if (!autos || !autos.length) return null;
    var TEMPO = 0;
    try {
      if (window.alphaTab && alphaTab.model && alphaTab.model.AutomationType) {
        TEMPO = alphaTab.model.AutomationType.Tempo;
      }
    } catch (e) {}
    for (var i = 0; i < autos.length; i++) {
      if (autos[i].type === TEMPO) return autos[i].value;
    }
    return null;
  }

  // 列出可玩軌道（含每軌音符數，過濾打擊樂）
  function listTracks(score) {
    var out = [];
    for (var t = 0; t < score.tracks.length; t++) {
      var track = score.tracks[t];
      var staff = track.staves[0];
      var isPerc = staff && (staff.isPercussion || (staff.showTablature === false && staff.isPercussion));
      var count = 0;
      if (staff) {
        for (var b = 0; b < staff.bars.length; b++) {
          var voice = staff.bars[b].voices[0];
          if (!voice) continue;
          for (var k = 0; k < voice.beats.length; k++) {
            if (!voice.beats[k].isRest && topNoteMidi(voice.beats[k]) != null) count++;
          }
        }
      }
      out.push({
        index: t,
        name: track.name || ("Track " + (t + 1)),
        noteCount: count,
        isPercussion: !!isPerc
      });
    }
    return out;
  }

  // 建立 tempo 事件表 [{tick,bpm}...]（已排序）
  function buildTempoMap(score, staff) {
    var events = [{ tick: 0, bpm: score.tempo || 120 }];
    var barStart = 0;
    for (var b = 0; b < staff.bars.length; b++) {
      var mb = score.masterBars[b];
      var voice = staff.bars[b].voices[0];
      var tick = barStart;
      if (voice) {
        for (var k = 0; k < voice.beats.length; k++) {
          var beat = voice.beats[k];
          var bpm = tempoAutomationValue(beat);
          if (bpm != null) events.push({ tick: tick, bpm: bpm });
          tick += beatTicks(beat);
        }
      }
      barStart += barTicks(mb);
    }
    events.sort(function (a, b) { return a.tick - b.tick; });
    // 去除同 tick 重複，保留最後
    var dedup = [];
    for (var i = 0; i < events.length; i++) {
      if (dedup.length && dedup[dedup.length - 1].tick === events[i].tick) dedup[dedup.length - 1] = events[i];
      else dedup.push(events[i]);
    }
    return dedup;
  }

  function makeTickToSec(tempoMap) {
    // 預先累積每個 tempo 段的起始秒數
    var segs = [];
    var sec = 0;
    for (var i = 0; i < tempoMap.length; i++) {
      var startTick = tempoMap[i].tick;
      var bpm = tempoMap[i].bpm || 120;
      var secPerTick = 60 / bpm / QUARTER;
      segs.push({ tick: startTick, sec: sec, secPerTick: secPerTick });
      if (i + 1 < tempoMap.length) {
        var span = tempoMap[i + 1].tick - startTick;
        sec += span * secPerTick;
      }
    }
    return function (tick) {
      // 找最後一個 startTick <= tick
      var seg = segs[0];
      for (var j = 0; j < segs.length; j++) {
        if (segs[j].tick <= tick) seg = segs[j]; else break;
      }
      return seg.sec + (tick - seg.tick) * seg.secPerTick;
    };
  }

  // 解析成遊戲用時間軸
  // 回傳 { title, artist, tempo, keySig, tonicPc, trackName, notes:[{time,dur,midi}], durationSec }
  function buildTimeline(score, trackIndex) {
    var track = score.tracks[trackIndex];
    var staff = track.staves[0];
    var tempoMap = buildTempoMap(score, staff);
    var tickToSec = makeTickToSec(tempoMap);

    var firstMb = score.masterBars[0];
    var keySig = firstMb ? (firstMb.keySignature || 0) : 0;
    var tonicPc = window.Theory.sigToTonicPc(keySig);

    var notes = [];
    var barStart = 0;
    for (var b = 0; b < staff.bars.length; b++) {
      var mb = score.masterBars[b];
      var voice = staff.bars[b].voices[0];
      var tick = barStart;
      if (voice) {
        for (var k = 0; k < voice.beats.length; k++) {
          var beat = voice.beats[k];
          var bt = beatTicks(beat);
          if (!beat.isRest && !isGrace(beat)) {
            var top = topNoteInfo(beat);
            if (top != null) {
              var t0 = tickToSec(tick);
              var t1 = tickToSec(tick + bt);
              notes.push({ time: t0, dur: Math.max(0.08, t1 - t0), midi: top.midi, bend: top.bend });
            }
          }
          tick += bt;
        }
      }
      barStart += barTicks(mb);
    }

    notes.sort(function (a, b) { return a.time - b.time; });
    var totalTicks = barStart;
    var durationSec = tickToSec(totalTicks);

    return {
      title: (score.title || "").trim() || "未命名樂曲",
      artist: (score.artist || "").trim(),
      tempo: score.tempo || 120,
      keySig: keySig,
      tonicPc: tonicPc,
      trackName: track.name || ("Track " + (trackIndex + 1)),
      notes: notes,
      durationSec: durationSec
    };
  }

  // 六線譜(TAB)時間軸：保留每個 beat 的所有音（含弦/格）
  // 回傳 { ...meta, tuning, stringCount, beats:[{time,dur,notes:[{string,fret,midi}]}] }
  function buildTabTimeline(score, trackIndex) {
    var track = score.tracks[trackIndex];
    var staff = track.staves[0];
    var tempoMap = buildTempoMap(score, staff);
    var tickToSec = makeTickToSec(tempoMap);

    var tuning = (staff.tuning && staff.tuning.length) ? staff.tuning.slice() : [64, 59, 55, 50, 45, 40];
    var stringCount = tuning.length;

    var firstMb = score.masterBars[0];
    var keySig = firstMb ? (firstMb.keySignature || 0) : 0;
    var tonicPc = window.Theory.sigToTonicPc(keySig);

    var beats = [];
    var barStarts = [];   // 各小節起始秒數
    var maxFret = 0;
    var barStart = 0;
    var tupletGroups = []; // 記錄已見過的連音組物件，索引即組別 id
    for (var b = 0; b < staff.bars.length; b++) {
      var mb = score.masterBars[b];
      barStarts.push(tickToSec(barStart));
      var voice = staff.bars[b].voices[0];
      var tick = barStart;
      if (voice) {
        for (var k = 0; k < voice.beats.length; k++) {
          var beat = voice.beats[k];
          var bt = beatTicks(beat);
          if (!beat.isRest && !isGrace(beat) && beat.notes && beat.notes.length) {
            var ns = [], deadNs = [];
            for (var i = 0; i < beat.notes.length; i++) {
              var n = beat.notes[i];
              if (n.isTieDestination) continue;      // 連結線的延續音不算新音符
              if (n.isDead) {                        // 死音/悶音(X)：無音高，只記弦與格位供六線譜顯示（不進判定）
                deadNs.push({ string: (typeof n.string === "number" ? n.string : 1), fret: (typeof n.fret === "number" ? n.fret : 0) });
                continue;
              }
              if (typeof n.realValue !== "number") continue;
              // 推弦幅度(四分音為單位；4 = 全音 full bend)
              var bend = 0;
              if (n.hasBend && n.bendPoints && n.bendPoints.length) {
                for (var bp = 0; bp < n.bendPoints.length; bp++) {
                  if (n.bendPoints[bp].value > bend) bend = n.bendPoints[bp].value;
                }
              }
              var fr = (typeof n.fret === "number" ? n.fret : 0);
              if (fr > maxFret) maxFret = fr;
              ns.push({
                string: (typeof n.string === "number" ? n.string : 1),
                fret: fr,
                midi: n.realValue,
                bend: bend,
                hammerOrigin: !!n.isHammerPullOrigin,
                hammerDest: !!n.isHammerPullDestination,
                slideOut: n.slideOutType || 0,   // 0=無
                slideIn: n.slideInType || 0,
                vibrato: n.vibrato || 0,          // 0 無 / 1 輕 / 2 寬
                palmMute: !!n.isPalmMute,
                harmonic: n.harmonicType || 0,    // 0 無，其餘為泛音類型
                trill: !!n.isTrill,               // 顫音
                letRing: !!n.isLetRing,           // 延音
                staccato: !!n.isStaccato,         // 斷奏
                tapLH: !!n.isLeftHandTapped        // 左手點弦
              });
            }
            var chordName = "", chordFrets = null, chordFirst = 0;   // 和弦名＋各弦格位(和弦表用)
            try {
              var ch = beat.chord;
              if (ch) {
                if (ch.name) chordName = String(ch.name);
                if (ch.strings && ch.strings.length) chordFrets = [].slice.call(ch.strings);   // 每弦格位(-1=不彈/悶)
                if (typeof ch.firstFret === "number") chordFirst = ch.firstFret;
              }
            } catch (e) {}
            if (ns.length || deadNs.length) {
              var t0 = tickToSec(tick);
              var t1 = tickToSec(tick + bt);
              // 連音(tuplet)：以 tupletGroup 物件參照分組，畫括線用
              var tup = null, tn = beat.tupletNumerator, td = beat.tupletDenominator;
              if (tn && td && tn > 0 && td > 0 && tn !== td) {
                var gid = -1, grp = beat.tupletGroup;
                if (grp) {
                  gid = tupletGroups.indexOf(grp);
                  if (gid < 0) { gid = tupletGroups.length; tupletGroups.push(grp); }
                }
                tup = { n: tn, d: td, gid: gid };
              }
              beats.push({
                time: t0, dur: Math.max(0.08, t1 - t0), notes: ns, dead: deadNs, bar: b,
                chord: chordName,               // 和弦名(有標示才有；空字串=無)
                chordFrets: chordFrets,         // 各弦格位陣列(畫和弦表用)或 null
                chordFirst: chordFirst,         // 起始格(和弦表左側基準)
                nv: beat.duration,              // 書寫音值(1全/2半/4四分/8八分/16十六分…)
                dots: beat.dots || 0,           // 附點數
                tuplet: tup,                    // 連音資訊或 null
                tap: !!beat.tap,                // 右手點弦(整拍)
                tremolo: (beat.tremoloSpeed != null), // 震音撥弦
                slap: !!beat.slap,              // 擊弦(slap)
                pop: !!beat.pop                 // 勾弦(pop)
              });
            }
          }
          tick += bt;
        }
      }
      barStart += barTicks(mb);
    }
    beats.sort(function (a, b) { return a.time - b.time; });

    // 搥弦/勾弦連結：把起音連到同弦的下一個音（目的音）
    for (var bi = 0; bi < beats.length; bi++) {
      var ns2 = beats[bi].notes;
      for (var ni = 0; ni < ns2.length; ni++) {
        var origin = ns2[ni];
        if (!origin.hammerOrigin) continue;
        for (var bj = bi + 1; bj < beats.length && !origin.link; bj++) {
          for (var nk = 0; nk < beats[bj].notes.length; nk++) {
            var cand = beats[bj].notes[nk];
            if (cand.string === origin.string) {
              origin.link = { time: beats[bj].time, midi: cand.midi, fret: cand.fret, string: cand.string };
              break;
            }
          }
        }
      }
    }

    return {
      title: (score.title || "").trim() || "未命名樂曲",
      artist: (score.artist || "").trim(),
      tempo: score.tempo || 120,
      keySig: keySig,
      tonicPc: tonicPc,
      trackName: track.name || ("Track " + (trackIndex + 1)),
      tuning: tuning,
      stringCount: stringCount,
      beats: beats,
      barStarts: barStarts,
      barCount: staff.bars.length,
      maxFret: maxFret,
      durationSec: tickToSec(barStart)
    };
  }

  // 由 ArrayBuffer 解析出 Score
  function parseBytes(arrayBuffer) {
    if (!window.alphaTab || !alphaTab.importer || !alphaTab.importer.ScoreLoader) {
      throw new Error("alphaTab 尚未載入");
    }
    var bytes = new Uint8Array(arrayBuffer);
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
  }

  window.GPLoader = {
    parseBytes: parseBytes,
    listTracks: listTracks,
    buildTimeline: buildTimeline,
    buildTabTimeline: buildTabTimeline
  };
})();
