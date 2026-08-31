# 第三方元件與授權聲明 · Third-Party Notices

本專案（簡譜音遊 Jianpu Rhythm）使用了下列第三方元件。
所有元件皆以**未經修改**的形式使用，並完整保留其原始著作權與授權宣告。

This project uses the third-party components listed below. All of them are used
**unmodified**, with their original copyright and license notices preserved.

---

## 1. alphaTab

| 項目 | 內容 |
|---|---|
| 用途 | 解析 Guitar Pro 檔（`.gp` / `.gpx` / `.gp5` / `.gp4` / `.gp3` / `.gpif`）。僅使用其匯入器，不使用繪譜功能。 |
| 版本 | v1.6.0（`@coderline/alphatab`） |
| 檔案 | `lib/alphaTab.min.js` |
| 著作權 | Copyright © 2025, Daniel Kuschny and Contributors. All rights reserved. |
| 授權 | **Mozilla Public License, Version 2.0（MPL-2.0）** |
| 授權全文 | 本專案內附 [`lib/alphaTab-LICENSE.txt`](lib/alphaTab-LICENSE.txt) ／ <https://mozilla.org/MPL/2.0/> |
| 原始碼 | <https://github.com/CoderLine/alphaTab> ・ <https://alphatab.net> |

> **MPL-2.0 合規說明**：`lib/alphaTab.min.js` 為官方發行版，**未經任何修改**；其檔頭之
> copyright 與 MPL 宣告完整保留（請勿在壓縮或部署流程中移除該檔頭）。依 MPL-2.0 第 3.2 條，
> 對應之原始碼可於上方 GitHub 網址取得。本專案自行撰寫的檔案（`js/*.js` 等）並非 MPL 涵蓋之
> "Covered Software"，不受 MPL 之 copyleft 拘束。

alphaTab 本身另整合了下列元件（宣告同樣保留於 `lib/alphaTab.min.js` 檔頭）：

| 元件 | 授權 | 著作權 |
|---|---|---|
| TinySoundFont | MIT | Copyright © 2017, 2018 Bernhard Schelling |
| SFZero | MIT | Copyright © 2012 Steve Folta |
| Haxe Standard Library | MIT | Copyright © 2005-2025 Haxe Foundation |
| SharpZipLib | MIT | Copyright © 2000-2018 SharpZipLib Contributors |
| NVorbis | MIT | Copyright © 2020 Andrew Ward |
| libvorbis | BSD-3-Clause | Copyright © 2002-2020 Xiph.org Foundation |

---

## 2. DrumGizmo — MuldjordKit（鼓組取樣音源）

| 項目 | 內容 |
|---|---|
| 用途 | 遊戲內鼓組音色（kick / snare / hat / openhat / crash） |
| 檔案 | `assets/drums/*.mp3` |
| 來源 | Drum samples provided by **DrumGizmo.org** — *MuldjordKit* by **Lars Muldjord** |
| 授權 | **Creative Commons Attribution 4.0 International（CC BY 4.0）** |
| 授權全文 | <https://creativecommons.org/licenses/by/4.0/> |
| 網址 | <https://drumgizmo.org/> |

> **CC BY 4.0 合規說明**：已於遊戲首頁「玩法」區塊、`terms.html` 與本檔案標示作者、來源與授權。
> 原始取樣經格式轉換／裁切為 mp3 供網頁串流使用（**內容未經改作，僅編碼格式轉換**）。

---

## 3. supabase-js

| 項目 | 內容 |
|---|---|
| 用途 | 解鎖驗證用之後端連線（讀取設定、Email／裝置開通、下載已授權之教材檔） |
| 載入方式 | 由 jsDelivr CDN 載入（`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`），未隨本專案散布 |
| 著作權 | Copyright © Supabase |
| 授權 | **MIT** |
| 原始碼 | <https://github.com/supabase/supabase-js> |

---

## 4. 選單背景音樂（非第三方 — 自製）

| 項目 | 內容 |
|---|---|
| 檔案 | `assets/menu-bgm.m4a`（選單背景音樂「Dorian Pocket」，約 4 分鐘） |
| 來源 | **由本專案作者使用 AI 音樂生成工具 Suno 自行製作**，非第三方既有錄音 |
| 權利 | 作者自有；未使用任何第三方唱片、樣本包或既有樂曲 |

---

## 5. 字型與圖像

- 介面字型使用作業系統內建字型（`system-ui` / PingFang TC / Noto Sans TC / Microsoft JhengHei），未內嵌任何字型檔。
- 遊戲中的 Q 版人物、指板、舞台、音箱等圖形，皆為本專案以 Canvas 程式碼**自行繪製之原創圖像**；
  人物取材自**公共領域之歷史人物**，非任何既有角色或在世人物之重製。

---

## 本專案自身之授權

本專案（簡譜音遊 Jianpu Rhythm）**未採用開放原始碼授權**，作者**保留所有權利（All rights reserved）**。
原始碼雖可公開瀏覽，但不代表授權重製、修改或再散布。

This project itself is **not released under an open-source license**.
All rights reserved. Source being publicly viewable does not grant any license to copy,
modify, or redistribute it.

---

*最後更新：2026-07-27*
