// ===================================================================
// auth.js — 登入 + 付費驗證 + 付費教材下載（Supabase）
//
//   運作重點（這就是「資料放後端」的核心）：
//   1. Email 魔術連結登入（無密碼）
//   2. 私密 bucket 預設任何人都讀不到；只有「已登入 + 在付費名單」的人，
//      後端才臨時發檔（download 回傳位元組）。沒付費的人連檔案都拿不到。
//   3. 沒設定 supabase-config.js、或離線時 → 優雅降級：
//      免費曲照玩，教材則顯示「需登入 / 需開通」。
//
//   對外介面：window.JianpuAuth
// ===================================================================
(function () {
  "use strict";

  var cfg = window.SUPABASE_CONFIG || null;
  var sb = null;            // supabase client
  var user = null;          // 目前登入者（null = 未登入）
  var entitled = false;     // 是否在付費名單
  var listeners = [];       // 狀態改變時要通知的回呼

  function ready() { return !!sb; }
  function bucket() { return (cfg && cfg.bucket) || "paid-songs"; }
  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function mkErr(code, msg) { var e = new Error(msg || code); e.code = code; return e; }
  function escapeHtml(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}

  // ---------- 初始化 ----------
  function init() {
    wireUI();
    var unset = !cfg || !cfg.url || !cfg.anonKey || /貼上/.test(cfg.url) || /貼上/.test(cfg.anonKey);
    if (unset) { setStatusText("（登入服務尚未設定——請先照「後端設定指南」填好 supabase-config.js）"); return; }
    if (!window.supabase || !window.supabase.createClient) { setStatusText("（登入元件載入失敗，請檢查網路連線）"); return; }
    try { sb = window.supabase.createClient(cfg.url, cfg.anonKey); }
    catch (e) { setStatusText("（登入服務初始化失敗）"); return; }

    sb.auth.getSession().then(function (res) {
      applyUser(res && res.data && res.data.session ? res.data.session.user : null);
    });
    sb.auth.onAuthStateChange(function (_ev, session) {
      applyUser(session ? session.user : null);
    });
  }

  function applyUser(u) {
    user = u || null;
    if (!user) { entitled = false; renderUI(); notify(); return; }
    checkEntitlement().then(function (ok) { entitled = ok; renderUI(); notify(); });
  }

  // 查自己在不在付費名單（RLS 只讓你讀到「自己那一筆」）
  function checkEntitlement() {
    if (!sb || !user) return Promise.resolve(false);
    var email = (user.email || "").toLowerCase();
    return sb.from("allowed_emails").select("active").eq("email", email).maybeSingle()
      .then(function (res) { return !!(res && res.data && res.data.active); })
      .catch(function () { return false; });
  }

  // ---------- 登入 / 登出 ----------
  function signIn(email) {
    if (!sb) { setStatusText("登入服務尚未設定。"); return; }
    email = (email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setStatusText("請輸入正確的 Email。"); return; }
    setStatusText("寄送登入連結中…");
    sb.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: location.origin + location.pathname }
    }).then(function (res) {
      if (res.error) setStatusText("寄送失敗：" + res.error.message);
      else setStatusText("已寄出登入連結到 " + email + "，請到信箱點連結（用「同一個瀏覽器」打開）。");
    });
  }
  function signOut() { if (sb) sb.auth.signOut(); }  // onAuthStateChange 會處理後續

  // ---------- 付費教材下載：只有已登入 + 已開通才拿得到位元組 ----------
  function downloadPaidSong(path) {
    if (!sb)   return Promise.reject(mkErr("NOT_READY",     "登入服務尚未設定"));
    if (!user) return Promise.reject(mkErr("NOT_LOGGED_IN", "尚未登入"));
    return downloadSong(bucket(), path);
  }
  // 從任意倉庫下載：free-songs 公開（任何人可）；paid-songs 私密（RLS 只放行已開通者）
  function downloadSong(bkt, path) {
    if (!sb) return Promise.reject(mkErr("NOT_READY", "登入服務尚未設定"));
    return sb.storage.from(bkt).download(path).then(function (res) {
      if (res.error || !res.data) throw mkErr("NOT_ENTITLED", (res.error && res.error.message) || "無法下載（可能尚未開通）");
      return res.data.arrayBuffer();
    });
  }
  // 讀取「songs」清單表（管理後台新增的自訂曲；清單標題公開可讀）
  function fetchCatalog() {
    if (!sb) return Promise.resolve([]);
    return sb.from("songs").select("title,grp,bucket,path,tier,sort").order("sort").order("title")
      .then(function (res) { return (res && res.data) ? res.data : []; })
      .catch(function () { return []; });
  }
  // 用 Email 查是否已開通（不需登入）：呼叫後端 RPC email_unlocked(p_email) → boolean
  //   需在 Supabase 先建立該 function（見後端設定指南）。連不到/未建 → 回 null（前端會提示尚未設定）。
  function checkEmailUnlock(email) {
    email = (email || "").trim().toLowerCase();
    if (!sb || !email) return Promise.resolve(false);
    return sb.rpc("email_unlocked", { p_email: email })
      .then(function (res) { if (res.error) return null; return !!res.data; })
      .catch(function () { return null; });
  }
  // 登記一台裝置到某 Email（後端限制每信箱最多 4 台）。回傳 'ok'|'limit'|'not_entitled'|null
  function registerDevice(email, device) {
    email = (email || "").trim().toLowerCase();
    if (!sb || !email || !device) return Promise.resolve(null);
    return sb.rpc("register_device", { p_email: email, p_device: device })
      .then(function (res) { return res.error ? null : res.data; })
      .catch(function () { return null; });
  }
  // 重置某 Email 的所有裝置（買家自行清空後重新登入）。回傳清除數(>=0)、-1未開通、null失敗
  function resetDevices(email) {
    email = (email || "").trim().toLowerCase();
    if (!sb || !email) return Promise.resolve(null);
    return sb.rpc("reset_devices", { p_email: email })
      .then(function (res) { return res.error ? null : res.data; })
      .catch(function () { return null; });
  }
  // 依 Email 讀回「已解鎖角色」狀態(跨裝置記住)。回傳 jsonb 物件或 null(未建/連不到)。
  function getCharUnlocks(email) {
    email = (email || "").trim().toLowerCase();
    if (!sb || !email) return Promise.resolve(null);
    return sb.rpc("get_char_unlocks", { p_email: email })
      .then(function (res) { return res.error ? null : (res.data || null); })
      .catch(function () { return null; });
  }
  // 把「已解鎖角色」狀態存到某 Email(跨裝置記住)。回傳 true/false。
  function saveCharUnlocks(email, data) {
    email = (email || "").trim().toLowerCase();
    if (!sb || !email) return Promise.resolve(false);
    return sb.rpc("save_char_unlocks", { p_email: email, p_data: data || {} })
      .then(function (res) { return !res.error; })
      .catch(function () { return false; });
  }
  // 讀取付費資料夾的上鎖設定（每個 grp 可獨立上鎖＋獨立密碼）；回傳 {grp:{locked,pw_hash}}
  function fetchFolders() {
    if (!sb) return Promise.resolve({});
    return sb.from("paid_folders").select("grp,locked,pw_hash")
      .then(function (res) {
        var m = {};
        (res && res.data ? res.data : []).forEach(function (r) { m[r.grp] = { locked: !!r.locked, pw_hash: r.pw_hash || "" }; });
        return m;
      })
      .catch(function () { return {}; });
  }
  // 讀取「app_config」設定表的一個 key（例：解鎖密碼 hash）；公開可讀，找不到就回 null
  function fetchConfig(key) {
    if (!sb) return Promise.resolve(null);
    return sb.from("app_config").select("value").eq("key", key).maybeSingle()
      .then(function (res) { return (res && res.data) ? res.data.value : null; })
      .catch(function () { return null; });
  }

  // ---------- 帳號列 UI ----------
  var el = {};
  function wireUI() {
    el.status   = document.getElementById("acctStatus");
    el.email    = document.getElementById("acctEmail");
    el.loginBtn = document.getElementById("acctLoginBtn");
    el.logoutBtn= document.getElementById("acctLogoutBtn");
    el.loginBox = document.getElementById("acctLoginBox");
    if (el.loginBtn) el.loginBtn.addEventListener("click", function () { signIn(el.email ? el.email.value : ""); });
    if (el.email)    el.email.addEventListener("keydown", function (e) { if (e.key === "Enter") signIn(el.email.value); });
    if (el.logoutBtn)el.logoutBtn.addEventListener("click", signOut);
    renderUI();
  }
  function setStatusText(t) { if (el.status) el.status.textContent = t; }
  function renderUI() {
    if (!el.status) return;
    if (user) {
      el.status.innerHTML = "已登入：" + escapeHtml(user.email) +
        (entitled ? " · <b style='color:#7CFC9B'>教材已開通 ✓</b>"
                  : " · <span style='color:#ffb454'>教材尚未開通（付款後老師會幫你開通）</span>");
      if (el.loginBox)  el.loginBox.style.display = "none";
      if (el.logoutBtn) el.logoutBtn.style.display = "";
    } else {
      if (ready()) setStatusText("未登入（免費曲可直接玩；教材需登入並開通）");
      if (el.loginBox)  el.loginBox.style.display = "";
      if (el.logoutBtn) el.logoutBtn.style.display = "none";
    }
  }
  function focusLogin() { if (el.email) { try { el.email.focus(); el.email.scrollIntoView({ block: "center" }); } catch (e) {} } }

  window.JianpuAuth = {
    isReady: ready,
    getUser: function () { return user; },
    isEntitled: function () { return entitled; },
    signIn: signIn,
    signOut: signOut,
    downloadPaidSong: downloadPaidSong,
    downloadSong: downloadSong,
    fetchCatalog: fetchCatalog,
    fetchConfig: fetchConfig,
    fetchFolders: fetchFolders,
    checkEmailUnlock: checkEmailUnlock,
    registerDevice: registerDevice,
    resetDevices: resetDevices,
    getCharUnlocks: getCharUnlocks,
    saveCharUnlocks: saveCharUnlocks,
    onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    focusLogin: focusLogin
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
