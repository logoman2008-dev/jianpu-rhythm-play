// ===================================================================
// supabase-config.js — 後端連線設定
//
// 這支檔案「可以」安全地公開放上 GitHub。
// anonKey（anon public key）設計上就是給前端瀏覽器用的，
// 真正的安全是靠 Supabase 後端的權限規則（RLS Policy）在把關，
// 不是靠藏這把鑰匙。
//
//   ⚠️ 但「service_role」那把金鑰絕對不能放這裡、也不能上 GitHub。
//
// 用法：到 Supabase → Project Settings → API，把兩個值貼進來。
//       （詳見專案根目錄的「後端設定指南.md」）
// ===================================================================
window.SUPABASE_CONFIG = {
  url:     "https://mqxfsqiliuoopzcvqbpm.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xeGZzcWlsaXVvb3B6Y3ZxYnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1MTgxMjIsImV4cCI6MjEwMDA5NDEyMn0.9wdKES-BBJfd2VzscepISONWMoFuWI9IOoynxynfTko",
  bucket:  "paid-songs"   // 放付費教材的私密 bucket 名稱（照指南建立即可，不用改）
};
