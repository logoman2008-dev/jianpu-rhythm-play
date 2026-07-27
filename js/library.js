// ===================================================================
// library.js — 「我的曲庫」：使用者自訂樂曲/資料夾，存在瀏覽器 IndexedDB
//   - 加入檔案（多選）／加入整個資料夾（webkitdirectory）／新資料夾
//   - 每首可改名／移動／刪除；每個資料夾可改名／刪除
//   - 點擊 → window.JianpuGame.loadArrayBuffer 播放
// ===================================================================
(function () {
  "use strict";

  var DB_NAME = "jianpu_library", DB_VER = 1, GP_RE = /\.(gp\d?|gpx|gpif)$/i, _db = null;

  function openDB() {
    return new Promise(function (res, rej) {
      if (_db) return res(_db);
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains("folders")) d.createObjectStore("folders", { keyPath: "id", autoIncrement: true });
        if (!d.objectStoreNames.contains("songs")) {
          var s = d.createObjectStore("songs", { keyPath: "id", autoIncrement: true });
          s.createIndex("folderId", "folderId");
        }
      };
      rq.onsuccess = function () { _db = rq.result; res(_db); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function store(name, mode) { return openDB().then(function (d) { return d.transaction(name, mode).objectStore(name); }); }
  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function getAll(name) { return store(name, "readonly").then(function (os) { return reqP(os.getAll()); }); }
  function getOne(name, id) { return store(name, "readonly").then(function (os) { return reqP(os.get(id)); }); }
  function add(name, obj) { return store(name, "readwrite").then(function (os) { return reqP(os.add(obj)); }); }
  function put(name, obj) { return store(name, "readwrite").then(function (os) { return reqP(os.put(obj)); }); }
  function del(name, id) { return store(name, "readwrite").then(function (os) { return reqP(os.delete(id)); }); }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function baseName(fn) { return fn.replace(GP_RE, ""); }
  function $(id) { return document.getElementById(id); }

  function ensureFolder(name) {
    return getAll("folders").then(function (fs) {
      for (var i = 0; i < fs.length; i++) if (fs[i].name === name) return fs[i].id;
      return add("folders", { name: name });
    });
  }
  function fileToSong(file, folderId) {
    return file.arrayBuffer().then(function (buf) {
      return add("songs", { name: baseName(file.name), folderId: folderId || 0, data: buf });
    });
  }
  function addFiles(fileList, folderId) {
    var files = [].filter.call(fileList, function (f) { return GP_RE.test(f.name); });
    if (!files.length) { setLibTip("沒有 .gp 檔可加入。"); return Promise.resolve(); }
    return Promise.all(files.map(function (f) { return fileToSong(f, folderId || 0); }))
      .then(function () { setLibTip("已加入 " + files.length + " 首。"); render(); });
  }
  // 整個資料夾：依相對路徑第一層分組成資料夾
  function addDirectory(fileList) {
    var byDir = {};
    [].forEach.call(fileList, function (f) {
      if (!GP_RE.test(f.name)) return;
      var rel = f.webkitRelativePath || f.name, top = rel.indexOf("/") >= 0 ? rel.split("/")[0] : "匯入";
      (byDir[top] = byDir[top] || []).push(f);
    });
    var dirs = Object.keys(byDir);
    if (!dirs.length) { setLibTip("該資料夾內沒有 .gp 檔。"); return Promise.resolve(); }
    var chain = Promise.resolve(), total = 0;
    dirs.forEach(function (dir) {
      chain = chain.then(function () { return ensureFolder(dir); }).then(function (fid) {
        return Promise.all(byDir[dir].map(function (f) { total++; return fileToSong(f, fid); }));
      });
    });
    return chain.then(function () { setLibTip("已從 " + dirs.length + " 個資料夾加入 " + total + " 首。"); render(); });
  }
  function playSong(id, name) {
    getOne("songs", id).then(function (s) {
      if (!s || !window.JianpuGame || !window.JianpuGame.loadArrayBuffer) return;
      // 我的曲庫＝自己上傳的譜：未開通者受每日免費次數限制（開通後無限）
      if (window.JianpuGame.gateOwnUse && !window.JianpuGame.gateOwnUse()) {
        setLibTip(window.JianpuGame.ownGateBlockedMsg ? window.JianpuGame.ownGateBlockedMsg()
                  : "今日免費次數已用完，登入開通後可無限使用。");
        return;
      }
      window.JianpuGame.loadArrayBuffer(s.data, name + ".gp");
    });
  }

  function setLibTip(t) { var e = $("libTip"); if (e) e.textContent = t || ""; }

  // 拖曳：把某首曲子移到某資料夾（folderId，0=未分類）
  function moveSongToFolder(songId, folderId) {
    getOne("songs", songId).then(function (s) {
      if (!s) return;
      if ((s.folderId || 0) === folderId) return;         // 已在該資料夾，不動
      s.folderId = folderId;
      put("songs", s).then(function () { setLibTip("已移動「" + s.name + "」。"); render(); });
    });
  }
  // ---- 從作業系統把檔案/資料夾「拖進來」加入曲庫 ----
  function isFileDrag(dt) { return !!(dt && dt.types && [].indexOf.call(dt.types, "Files") >= 0); }
  // 遞迴讀出一個資料夾 entry 底下所有檔案
  function collectDirFiles(dirEntry) {
    var reader = dirEntry.createReader(), files = [];
    return new Promise(function (resolve) {
      (function next() {
        reader.readEntries(function (entries) {
          if (!entries.length) { resolve(files); return; }
          Promise.all(entries.map(function (en) {
            return new Promise(function (r) {
              if (en.isFile) en.file(function (f) { files.push(f); r(); }, function () { r(); });
              else if (en.isDirectory) collectDirFiles(en).then(function (fs) { files.push.apply(files, fs); r(); });
              else r();
            });
          })).then(next);
        }, function () { resolve(files); });
      })();
    });
  }
  // 處理一次拖放：可同時含多個檔案與資料夾。資料夾→各自成一個曲庫資料夾；散檔→放進 folderId
  function handleFileDrop(dt, folderId) {
    var entries = [], items = dt.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      for (var i = 0; i < items.length; i++) { var en = items[i].webkitGetAsEntry(); if (en) entries.push(en); }
    }
    if (!entries.length) { if (dt.files && dt.files.length) addFiles(dt.files, folderId || 0); return; }
    var flat = [], chain = Promise.resolve(), dirCount = 0;
    entries.forEach(function (en) {
      if (en.isFile) chain = chain.then(function () {
        return new Promise(function (r) { en.file(function (f) { if (GP_RE.test(f.name)) flat.push(f); r(); }, function () { r(); }); });
      });
      else if (en.isDirectory) chain = chain.then(function () {
        return collectDirFiles(en).then(function (fs) {
          var g = fs.filter(function (f) { return GP_RE.test(f.name); });
          if (!g.length) return;
          return ensureFolder(en.name).then(function (fid) {
            return Promise.all(g.map(function (f) { return fileToSong(f, fid); })).then(function () { dirCount++; });
          });
        });
      });
    });
    chain.then(function () { return flat.length ? Promise.all(flat.map(function (f) { return fileToSong(f, folderId || 0); })) : null; })
      .then(function () {
        var msg = [];
        if (flat.length) msg.push(flat.length + " 首檔案");
        if (dirCount) msg.push(dirCount + " 個資料夾");
        setLibTip(msg.length ? "已拖曳加入 " + msg.join("、") + "。" : "沒有 .gp 檔可加入。");
        render();
      });
  }

  // 讓一個元素成為放置目標：可接「內部拖曳整理」也可接「外部檔案拖入」
  function makeDropTarget(el, folderId) {
    el.addEventListener("dragover", function (e) {
      e.preventDefault(); e.dataTransfer.dropEffect = isFileDrag(e.dataTransfer) ? "copy" : "move"; el.classList.add("lib-drop-over");
    });
    el.addEventListener("dragleave", function (e) {
      if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove("lib-drop-over");
    });
    el.addEventListener("drop", function (e) {
      e.preventDefault(); el.classList.remove("lib-drop-over");
      if (isFileDrag(e.dataTransfer)) { e.stopPropagation(); handleFileDrop(e.dataTransfer, folderId); return; }
      var id = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!isNaN(id)) moveSongToFolder(id, folderId);
    });
  }
  // 讓整個曲庫外框都能接收外部檔案拖入(放到未分類)；內部資料夾的拖入已由 makeDropTarget 攔截
  function makeFileDropZone(el) {
    if (!el) return;
    el.addEventListener("dragover", function (e) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy"; el.classList.add("lib-file-over");
    });
    el.addEventListener("dragleave", function (e) {
      if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove("lib-file-over");
    });
    el.addEventListener("drop", function (e) {
      if (!isFileDrag(e.dataTransfer)) return;
      e.preventDefault(); el.classList.remove("lib-file-over");
      handleFileDrop(e.dataTransfer, 0);
    });
  }

  function actBtn(label, title, fn) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "lib-act"; b.textContent = label; b.title = title;
    b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  }

  function songRow(s, groups) {
    var row = document.createElement("div"); row.className = "lib-song";
    row.draggable = true;                                  // 可拖曳到資料夾整理
    row.addEventListener("dragstart", function (e) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(s.id));
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", function () { row.classList.remove("dragging"); });
    var play = document.createElement("button");
    play.type = "button"; play.className = "btn small ghost lib-play"; play.textContent = "▶ " + s.name; play.title = s.name;
    play.addEventListener("click", function () { playSong(s.id, s.name); });
    row.appendChild(play);
    row.appendChild(actBtn("✎", "改名", function () {
      var n = prompt("樂曲新名稱：", s.name); if (n && n.trim()) { s.name = n.trim(); put("songs", s).then(render); }
    }));
    row.appendChild(actBtn("📁", "移動到資料夾", function () {
      var list = groups.map(function (g, i) { return (i + 1) + ". " + g.name; }).join("\n");
      var pick = prompt("移動「" + s.name + "」到哪個資料夾？輸入編號：\n" + list);
      var idx = parseInt(pick, 10) - 1;
      if (idx >= 0 && idx < groups.length) { s.folderId = groups[idx].id; put("songs", s).then(render); }
    }));
    row.appendChild(actBtn("🗑", "刪除", function () {
      if (confirm("刪除「" + s.name + "」？")) del("songs", s.id).then(render);
    }));
    return row;
  }

  function render() {
    var box = $("myLibrary"); if (!box) return;
    Promise.all([getAll("folders"), getAll("songs")]).then(function (r) {
      var folders = r[0].sort(function (a, b) { return a.id - b.id; }), songs = r[1];
      box.innerHTML = "";
      if (!songs.length && !folders.length) {
        box.innerHTML = '<div class="lib-empty">還沒有曲子——點上面「加入檔案」或「加入資料夾」開始。存在你的瀏覽器裡，下次還在。</div>';
        return;
      }
      var groups = [{ id: 0, name: "未分類" }].concat(folders);
      groups.forEach(function (f) {
        var fs = songs.filter(function (s) { return (s.folderId || 0) === f.id; });
        // 未分類空時：若有資料夾才保留（當作把曲子拖出來的放置區），否則隱藏
        if (f.id === 0 && fs.length === 0 && folders.length === 0) return;
        var det = document.createElement("details"); det.className = "sample-group"; det.open = true;
        makeDropTarget(det, f.id);                                    // 整個資料夾區塊可接收拖入的曲子
        var sum = document.createElement("summary");
        var titleSpan = document.createElement("span"); titleSpan.className = "lib-fname";
        titleSpan.textContent = f.name;
        sum.appendChild(titleSpan);
        var cnt = document.createElement("span"); cnt.className = "sample-count"; cnt.textContent = fs.length; sum.appendChild(cnt);
        if (f.id !== 0) {                                             // 資料夾操作（未分類不可改名/刪）
          sum.appendChild(actBtn("✎", "資料夾改名", function () {
            var n = prompt("資料夾新名稱：", f.name); if (n && n.trim()) { f.name = n.trim(); put("folders", f).then(render); }
          }));
          sum.appendChild(actBtn("🗑", "刪除資料夾(含裡面的曲子)", function () {
            if (!confirm("刪除資料夾「" + f.name + "」和裡面 " + fs.length + " 首？")) return;
            Promise.all(fs.map(function (s) { return del("songs", s.id); })).then(function () { return del("folders", f.id); }).then(render);
          }));
        }
        det.appendChild(sum);
        var inner = document.createElement("div"); inner.className = "lib-inner";
        if (fs.length === 0) {
          var hint = document.createElement("div"); hint.className = "lib-drop-hint";
          hint.textContent = "把曲子拖到這裡";
          inner.appendChild(hint);
        }
        fs.forEach(function (s) { inner.appendChild(songRow(s, groups)); });
        det.appendChild(inner);
        box.appendChild(det);
      });
    });
  }

  function wire() {
    var fileInput = $("libFileInput"), dirInput = $("libDirInput");
    var bFiles = $("libAddFiles"), bFolder = $("libAddFolder"), bNew = $("libNewFolder");
    if (bFiles && fileInput) {
      bFiles.addEventListener("click", function () { fileInput.value = ""; fileInput.click(); });
      fileInput.addEventListener("change", function () { if (fileInput.files.length) addFiles(fileInput.files, 0); });
    }
    if (bFolder && dirInput) {
      bFolder.addEventListener("click", function () { dirInput.value = ""; dirInput.click(); });
      dirInput.addEventListener("change", function () { if (dirInput.files.length) addDirectory(dirInput.files); });
    }
    if (bNew) bNew.addEventListener("click", function () {
      var n = prompt("新資料夾名稱："); if (n && n.trim()) ensureFolder(n.trim()).then(function () { setLibTip("已建立資料夾。"); render(); });
    });
    makeFileDropZone($("myLibraryBox"));    // 直接把 .gp 檔或整個資料夾拖進曲庫即可加入
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.JianpuLibrary = { render: render };
})();
