// ===================================================================
// theory.js — 簡譜（首調 / 可動 Do）音樂理論核心
// 由 MIDI 音高 + 調性 → 級數(1~7) + 升降 + 八度點
// 沿用桌面既有 numbered-notation-ext/lib/theory.js 的慣例。
// 純函式、掛在 window.Theory，classic script（file:// 也能用）。
// ===================================================================
(function () {
  "use strict";

  var LETTER_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // 大調音階各級半音（第 1~7 級）
  var MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  // 半音距離(0~11) → { degree, alter }
  // 慣例：升的音記為 #（1→#1、4→#4）；6、8、10 記為 b（b3、b6、b7）
  var SEMITONE_TO_DEG = [
    { degree: 1, alter: 0 },   // 0
    { degree: 1, alter: 1 },   // 1  #1
    { degree: 2, alter: 0 },   // 2
    { degree: 3, alter: -1 },  // 3  b3
    { degree: 3, alter: 0 },   // 4
    { degree: 4, alter: 0 },   // 5
    { degree: 4, alter: 1 },   // 6  #4
    { degree: 5, alter: 0 },   // 7
    { degree: 6, alter: -1 },  // 8  b6
    { degree: 6, alter: 0 },   // 9
    { degree: 7, alter: -1 },  // 10 b7
    { degree: 7, alter: 0 }    // 11
  ];

  // 可選調性（首調：以此音為 1=Do）。circle of fifths。
  var KEY_OPTIONS = [
    { value: "C",  label: "C 大調（無升降）", pc: 0,  sig: 0 },
    { value: "G",  label: "G 大調（1♯）",    pc: 7,  sig: 1 },
    { value: "D",  label: "D 大調（2♯）",    pc: 2,  sig: 2 },
    { value: "A",  label: "A 大調（3♯）",    pc: 9,  sig: 3 },
    { value: "E",  label: "E 大調（4♯）",    pc: 4,  sig: 4 },
    { value: "B",  label: "B 大調（5♯）",    pc: 11, sig: 5 },
    { value: "F#", label: "F♯大調（6♯）",   pc: 6,  sig: 6 },
    { value: "Db", label: "D♭大調（5♭）",   pc: 1,  sig: -5 },
    { value: "Ab", label: "A♭大調（4♭）",   pc: 8,  sig: -4 },
    { value: "Eb", label: "E♭大調（3♭）",   pc: 3,  sig: -3 },
    { value: "Bb", label: "B♭大調（2♭）",   pc: 10, sig: -2 },
    { value: "F",  label: "F 大調（1♭）",    pc: 5,  sig: -1 }
  ];

  // alphaTab keySignature 整數(-7..7) → 主音 pitch class（該調號的大調）
  // 0=C,1=G,2=D,...,-1=F,-2=Bb...
  function sigToTonicPc(sig) {
    // 每加一個升號 = 上五度(+7 半音)，取模 12
    return (((sig * 7) % 12) + 12) % 12;
  }

  function tonicPcToKeyValue(pc) {
    for (var i = 0; i < KEY_OPTIONS.length; i++) {
      if (KEY_OPTIONS[i].pc === pc) return KEY_OPTIONS[i].value;
    }
    return "C";
  }

  function keyValueToPc(value) {
    for (var i = 0; i < KEY_OPTIONS.length; i++) {
      if (KEY_OPTIONS[i].value === value) return KEY_OPTIONS[i].pc;
    }
    return 0;
  }

  function accSymbol(alter) {
    if (alter === 0) return "";
    if (alter === 1) return "♯";
    if (alter === -1) return "♭";
    if (alter === 2) return "𝄪";
    if (alter === -2) return "♭♭";
    return alter > 0 ? new Array(alter + 1).join("♯") : new Array(-alter + 1).join("♭");
  }

  // MIDI → { degree, alter } 相對於 tonicPc
  function midiToDegree(midi, tonicPc) {
    var s = (((midi - tonicPc) % 12) + 12) % 12;
    return SEMITONE_TO_DEG[s];
  }

  // 決定「中央八度」的參考 MIDI：以整首音高中位數附近的主音為 0 點
  // 回傳一個函式 midi -> octaveOffset（0=中央，>0 上加點，<0 下加點）
  function makeOctaveOffsetFn(midis, tonicPc) {
    var valid = midis.filter(function (m) { return m != null; }).slice().sort(function (a, b) { return a - b; });
    if (valid.length === 0) return function () { return 0; };
    var median = valid[Math.floor(valid.length / 2)];
    var refMidi = tonicPc; // 找出 <= median 的最高主音當基準
    while (refMidi + 12 <= median) refMidi += 12;
    while (refMidi > median) refMidi -= 12;
    return function (midi) {
      if (midi == null) return 0;
      return Math.floor((midi - refMidi) / 12);
    };
  }

  // 完整標記：{ degree, alter, octaveOffset, symbol, label }
  // label 為單純的「級數+升降」文字（八度以點另外畫），symbol 含升降前綴
  function label(midi, tonicPc, octaveOffset) {
    var d = midiToDegree(midi, tonicPc);
    return {
      degree: d.degree,
      alter: d.alter,
      octaveOffset: octaveOffset || 0,
      symbol: accSymbol(d.alter),
      text: String(d.degree)
    };
  }

  window.Theory = {
    LETTER_TO_PC: LETTER_TO_PC,
    MAJOR_STEPS: MAJOR_STEPS,
    KEY_OPTIONS: KEY_OPTIONS,
    sigToTonicPc: sigToTonicPc,
    tonicPcToKeyValue: tonicPcToKeyValue,
    keyValueToPc: keyValueToPc,
    accSymbol: accSymbol,
    midiToDegree: midiToDegree,
    makeOctaveOffsetFn: makeOctaveOffsetFn,
    label: label
  };
})();
