// LiteJam LED 吉他 — Web Bluetooth 連線與燈控（簡譜音遊用，非模組版）
//
// 協定（由 glowtab.litejam.com 前端程式碼逆向而得）
//   Service 0x00FF 狀態：0xFF01 模式 / 0xFF02 電量% / 0xFF03 實體按鈕（皆可 notify）
//   Service 0x00EE 控制：0xEE01 LED模式(1B) / 0xEE02 Pattern(4B) / 0xEE03 Party(10B)
//                        0xEE04 Segment(燈組, >=4B) / 0xEE05 SoundReact(9B) / 0xEE06 SoundReactData(1B)
//
//   Segment 封包格式：
//     [群組數]
//       每組：[本組燈數] ([格號][弦bitmask]) x N [R][G][B]
//     結尾三碼 0x45 0x4E 0x44 ("END")
//   弦 bitmask：bit0 = 第1弦 … bit5 = 第6弦（0x3F = 全六弦）
//
// 用法：window.JianpuLite.instance  → LiteJam 物件（connect / disconnect / sendNotes / ledOff）
(function () {
  "use strict";

  var SVC_STATUS = 0x00ff;
  var SVC_CONTROL = 0x00ee;

  var CHR = {
    MODE: 0xff01,
    BATTERY: 0xff02,
    BUTTON: 0xff03,
    LED_MODE: 0xee01,
    PATTERN: 0xee02,
    PARTY: 0xee03,
    SEGMENT: 0xee04,
    SOUND_REACT: 0xee05,
    SOUND_REACT_DATA: 0xee06,
  };

  // 這把琴不在廣播裡帶服務 UUID，只能用「名稱開頭」當過濾條件（Web Bluetooth 規定必須給 filters）。
  var NAME_PREFIXES = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    .split("")
    .map(function (c) { return { namePrefix: c }; });

  var MAX_FRET = 24;

  function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  // {r,g,b} 乘上亮度並夾在 0–255
  function scaleColor(color, brightness) {
    if (brightness == null) brightness = 1;
    return { r: clamp255(color.r * brightness), g: clamp255(color.g * brightness), b: clamp255(color.b * brightness) };
  }

  // #rrggbb → {r,g,b}
  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return { r: 255, g: 255, b: 255 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  // 把燈組編碼成 Segment 位元組。
  function encodeSegment(groups) {
    var size = 4; // 群組數 1 byte + 結尾 "END" 3 bytes
    for (var g = 0; g < groups.length; g++) size += 1 + groups[g].leds.length * 2 + 3;

    var buf = new Uint8Array(size);
    var i = 0;
    buf[i++] = groups.length & 0xff;
    for (var k = 0; k < groups.length; k++) {
      var grp = groups[k];
      buf[i++] = grp.leds.length & 0xff;
      for (var j = 0; j < grp.leds.length; j++) {
        var led = grp.leds[j];
        buf[i++] = led.fret & 0xff;
        var mask = 0;
        for (var s = 0; s < led.strings.length; s++) {
          var str = led.strings[s];
          if (str >= 1 && str <= 6) mask |= 1 << (str - 1);
        }
        buf[i++] = mask & 0x3f;
      }
      buf[i++] = grp.color.r & 0xff;
      buf[i++] = grp.color.g & 0xff;
      buf[i++] = grp.color.b & 0xff;
    }
    buf[i++] = 0x45; // E
    buf[i++] = 0x4e; // N
    buf[i++] = 0x44; // D
    return buf;
  }

  // 同一格上的多條弦合併成一筆，並依格號排序（封包更短、寫入更快）
  function packNotes(notes) {
    var byFret = {};
    for (var n = 0; n < notes.length; n++) {
      var fret = Math.max(0, Math.min(MAX_FRET, notes[n].fret | 0));
      var string = Math.max(1, Math.min(6, notes[n].string | 0));
      if (!byFret[fret]) byFret[fret] = [];
      if (byFret[fret].indexOf(string) < 0) byFret[fret].push(string);
    }
    return Object.keys(byFret)
      .map(function (f) { return +f; })
      .sort(function (a, b) { return a - b; })
      .map(function (fret) { return { fret: fret, strings: byFret[fret].sort(function (a, b) { return a - b; }) }; });
  }

  function LiteJam() {
    this.status = "disconnected"; // disconnected | connecting | connected
    this.deviceName = "";
    this.battery = null;
    this.mode = null;
    this.button = null;
    this.hasStatus = false;
    this.hasControl = false;
    this.lastError = null;

    this._listeners = {};
    this._device = null;
    this._server = null;
    this._chr = {};
    this._writeChain = Promise.resolve();
    this._pending = {};
    this._lastSegmentHex = "";
  }

  LiteJam.prototype.supported = function () {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  };

  // 極簡事件系統（on / off / emit）
  LiteJam.prototype.on = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
    return this;
  };
  LiteJam.prototype._emit = function (type, detail) {
    var arr = this._listeners[type];
    if (arr) for (var i = 0; i < arr.length; i++) { try { arr[i](detail); } catch (e) {} }
  };

  LiteJam.prototype._setStatus = function (status) {
    this.status = status;
    this._emit("status", { status: status });
  };

  LiteJam.prototype.snapshot = function () {
    return {
      status: this.status, name: this.deviceName, battery: this.battery, mode: this.mode,
      button: this.button, hasStatus: this.hasStatus, hasControl: this.hasControl, lastError: this.lastError,
    };
  };

  LiteJam.prototype.connect = function (opts) {
    opts = opts || {};
    var self = this;
    if (!this.supported()) {
      this.lastError = "這個瀏覽器不支援 Web Bluetooth，請用電腦版 Chrome / Edge（Safari、iPhone 不支援）。";
      this._emit("error", { message: this.lastError });
      return Promise.reject(new Error(this.lastError));
    }

    this._setStatus("connecting");
    this.lastError = null;

    var base = { optionalServices: [SVC_STATUS, SVC_CONTROL] };
    var req = opts.allDevices
      ? { optionalServices: base.optionalServices, acceptAllDevices: true }
      : { optionalServices: base.optionalServices, filters: NAME_PREFIXES };

    return navigator.bluetooth.requestDevice(req).then(function (device) {
      self._device = device;
      self.deviceName = device.name || "";
      device.addEventListener("gattserverdisconnected", function () { self._reset(); });
      return device.gatt.connect();
    }).then(function (server) {
      self._server = server;

      // 狀態服務（模式 / 電量 / 按鈕）— 讀不到不影響燈控
      return server.getPrimaryService(SVC_STATUS).then(function (svc) {
        return Promise.all([svc.getCharacteristic(CHR.MODE), svc.getCharacteristic(CHR.BATTERY), svc.getCharacteristic(CHR.BUTTON)])
          .then(function (cs) {
            self._chr.mode = cs[0]; self._chr.battery = cs[1]; self._chr.button = cs[2];
            self.hasStatus = true;
            var onNotify = function (ev) {
              var chr = ev.target, v = chr.value.getUint8(0);
              if (chr === self._chr.mode) self.mode = v;
              else if (chr === self._chr.battery) self.battery = v;
              else if (chr === self._chr.button) { self.button = v; self._emit("button", { value: v }); }
              self._emit("state", self.snapshot());
            };
            return Promise.all(cs.map(function (chr) {
              return Promise.resolve()
                .then(function () { return chr.readValue(); })
                .then(function (dv) {
                  if (chr === self._chr.mode) self.mode = dv.getUint8(0);
                  else if (chr === self._chr.battery) self.battery = dv.getUint8(0);
                  else if (chr === self._chr.button) self.button = dv.getUint8(0);
                })
                .catch(function () {})
                .then(function () { return chr.startNotifications(); })
                .then(function () { chr.addEventListener("characteristicvaluechanged", onNotify); })
                .catch(function () {});
            }));
          });
      }).catch(function () { self.hasStatus = false; });
    }).then(function () {
      // 控制服務（燈）
      return self._server.getPrimaryService(SVC_CONTROL).then(function (svc) {
        return Promise.all([
          svc.getCharacteristic(CHR.LED_MODE), svc.getCharacteristic(CHR.PATTERN), svc.getCharacteristic(CHR.PARTY),
          svc.getCharacteristic(CHR.SEGMENT), svc.getCharacteristic(CHR.SOUND_REACT), svc.getCharacteristic(CHR.SOUND_REACT_DATA),
        ]).then(function (cs) {
          self._chr.ledMode = cs[0]; self._chr.pattern = cs[1]; self._chr.party = cs[2];
          self._chr.segment = cs[3]; self._chr.soundReact = cs[4]; self._chr.soundReactData = cs[5];
          self.hasControl = true;
        });
      }).catch(function () { self.hasControl = false; });
    }).then(function () {
      if (!self.hasStatus || !self.hasControl) {
        var msg = "這個裝置不是 LiteJam 吉他（找不到必要的 BLE 服務 0x00FF / 0x00EE）。";
        self.lastError = msg;
        try { self._server.disconnect(); } catch (e) {}
        self._reset();
        self._emit("error", { message: msg });
        throw new Error(msg);
      }
      self._setStatus("connected");
      self._emit("state", self.snapshot());
      return self.snapshot();
    }).catch(function (err) {
      if (err && err.name === "NotFoundError") { self._reset(); return null; }   // 使用者自己按取消
      self.lastError = self.lastError || (err && err.message) || String(err);
      self._reset();
      throw err;
    });
  };

  LiteJam.prototype.disconnect = function () {
    try { if (this._server) this._server.disconnect(); } catch (e) {}
    this._reset();
  };

  LiteJam.prototype._reset = function () {
    this._device = null;
    this._server = null;
    this._chr = {};
    this._pending = {};
    this._lastSegmentHex = "";
    this.deviceName = "";
    this.battery = null;
    this.mode = null;
    this.button = null;
    this.hasStatus = false;
    this.hasControl = false;
    this._setStatus("disconnected");
    this._emit("state", this.snapshot());
  };

  // 寫入佇列。BLE 一次只能一個 GATT 操作，燈只在乎最新狀態→同一 characteristic 舊資料直接丟掉。
  LiteJam.prototype._write = function (key, data) {
    var self = this;
    if (this.status !== "connected") return Promise.resolve(false);
    this._pending[key] = data;
    this._writeChain = this._writeChain.then(function () {
      var payload = self._pending[key];
      if (!payload) return false;
      delete self._pending[key];
      var chr = self._chr[key];
      if (!chr) return false;
      var p = chr.writeValueWithoutResponse ? chr.writeValueWithoutResponse(payload) : chr.writeValue(payload);
      return Promise.resolve(p).then(function () { return true; }).catch(function (err) {
        self._emit("error", { message: "寫入失敗（" + key + "）：" + ((err && err.message) || err) });
        return false;
      });
    });
    return this._writeChain;
  };

  // LED 模式：0 = 全部關燈 / 交還控制權
  LiteJam.prototype.setLedMode = function (mode) {
    return this._write("ledMode", new Uint8Array([mode & 0xff]));
  };

  LiteJam.prototype.ledOff = function () {
    this._lastSegmentHex = "";
    return this.setLedMode(0);
  };

  // 送出燈組；內容和上一次完全相同時直接跳過，省藍牙頻寬
  LiteJam.prototype.sendSegment = function (groups) {
    var valid = groups.filter(function (g) { return g.leds.length > 0; });
    if (valid.length === 0) return this.ledOff();
    var payload = encodeSegment(valid);
    var hex = "";
    for (var b = 0; b < payload.length; b++) hex += (payload[b] < 16 ? "0" : "") + payload[b].toString(16);
    if (hex === this._lastSegmentHex) return Promise.resolve(true);
    this._lastSegmentHex = hex;
    return this._write("segment", payload);
  };

  // 便利函式：一批音 + 單一顏色
  LiteJam.prototype.sendNotes = function (notes, color) {
    return this.sendSegment([{ leds: packNotes(notes), color: color }]);
  };

  window.JianpuLite = {
    LiteJam: LiteJam,
    instance: new LiteJam(),
    scaleColor: scaleColor,
    hexToRgb: hexToRgb,
    packNotes: packNotes,
    encodeSegment: encodeSegment,
    MAX_FRET: MAX_FRET,
  };
})();
