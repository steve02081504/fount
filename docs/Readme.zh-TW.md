<details>
<summary><small>太長不看</small></summary>

fount 是一個可程式化的標準化部件化客製化 Agent 運行平台，載入各種部件來提供服務。  
程式碼相關的問題請參考 [deepwiki](https://deepwiki.com/steve02081504/fount)。  
<small>fount 名稱使用全小寫，是 `f`ount 而不是 `F`ount。</small>

#### 為什麼 fount？

- 標準化、現有豐富、強大的生態可開箱即用，避免重複造輪子和除錯惡夢
- 客製化 Agent 邏輯，而不只是 prompt 和 UI 工程
- 使用和參考社群中其他強大的 fount Agent
- 辦公友好，快速匯出報告
- 無縫整合角色到各種軟體如 IDE、瀏覽器、終端、discord 等
- 其他 LLM 對話前端所沒有的，社群中各種面向 Agent 的外掛
- 只需配置 API，隨後即可使用預設角色 ZL-31 來用對話完成部件配置、建立部件等一切使用者操作，無需學習和上手

#### 為什麼不 fount？

- 精通成本較高，需要程式知識
- 有的社群部件可能有惡意程式碼，需要判斷和篩選

##### 我該用什麼？

使用 [OpenClaw](https://openclaw.ai/)，當你：

- 想嘗鮮而不想深度客製化、高效化 Agent 時

使用 [ChatGPT](https://chatgpt.com/) 或類似線上 LLM 聊天平台，當你：

- 只想聊天
- 無需深度客製化 AI 的角色
- 不在乎聊天記錄被在雲端保存而無法匯出和遷移
- 不在乎廣告

使用 [character.ai](https://character.ai/) 或類似的線上 LLM 角色扮演聊天平台，當你：

- 想運行一個 LLM 驅動的角色，而不是使用 Agent 功能
- 覺得會員的錢可以接受
- 懶得配置程式

使用 [SillyTavern](https://github.com/SillyTavern/SillyTavern/)，當你：

- 想運行一個需要 STscript 或 SillyTavern 外掛才能運行的角色或功能

</details>

<h1 align="center">⛲fount💪</h1>

> <p align="center">靈犀一點，應念而生</p>

<p align="center">
<a href="https://github.com/topics/fount-repo"><img src="https://steve02081504.github.io/fount/badges/fount_repo.svg" alt="fount repo"></a>
<a href="https://deepwiki.com/steve02081504/fount"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki"></a>
<a href="https://github.com/users/steve02081504/packages/container/package/fount"><img src="https://img.shields.io/docker/image-size/steve02081504/fount" alt="Docker Image Size"></a>
<a href="https://github.com/steve02081504/fount/archive/refs/heads/master.zip"><img src="https://img.shields.io/github/repo-size/steve02081504/fount" alt="GitHub repo size"></a>
<a href="https://discord.gg/GtR9Quzq2v"><img src="https://img.shields.io/discord/1288934771153440768" alt="Discord"></a>
<a href="https://www.codefactor.io/repository/github/steve02081504/fount"><img src="https://www.codefactor.io/repository/github/steve02081504/fount/badge" alt="CodeFactor"></a>
<a href="https://app.codacy.com/gh/steve02081504/fount/dashboard?utm_source=gh&amp;utm_medium=referral&amp;utm_content=&amp;utm_campaign=Badge_grade"><img src="https://app.codacy.com/project/badge/Grade/8615bc18e3fa4ff391f41e9dcadf93f7" alt="Codacy Badge"></a>
</p>

<p align="center"><a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a></p>

![repo img](https://repository-images.githubusercontent.com/862251163/0ac90205-ae40-4fc6-af67-1e28d074c76b)

## fount 是什麼？

fount 是一個**現代化、可擴展的 AI Agent 運行時環境**。

我們認為，**高效率的生產力工具**與**沉浸式的情感互動**並非水火不容。fount 是一座橋樑：白天，它可以是輔助你編寫複雜程式碼、整理會議紀錄的得力助手；夜晚，它可以是能理解你情緒、與之共鳴的數位知己。

歷經![relative date](https://img.shields.io/date/1727107200?label=費時)的潛心雕琢，匯聚了![GitHub contributors](https://img.shields.io/github/contributors/steve02081504/fount?label=貢獻者)的熱忱，以及一個擁有![number of active users](https://img.shields.io/jsdelivr/gh/hy/steve02081504/fount?label=活躍用戶)的鮮活社群，fount 如今已是一個成熟、穩定且不斷演進的 AI 互動平台。

若你希望從零開始完成配置、搭建與入門，可參閱社群教學 [**fount 從零開始的傻瓜式指南**](https://github.com/Xiaoqiush81/fount-Guide-for-dummies)（教學為中文，非中文使用者可使用瀏覽器翻譯功能閱讀）。

![圖片](https://github.com/user-attachments/assets/05a5ad16-cc9a-49be-8c55-0c11353cb0d2)

---

## 🚀 效率與工程：為專業人士、開發者與極客打造

fount 將互動轉化為生產力資產，一切皆可拖曳，一切皆為檔案，邏輯由程式碼驅動。

### 1. 無需學習，開箱即用

- 只需配置 API，隨後即可使用預設角色 ZL-31 來用對話完成部件配置、建立部件等**一切使用者操作**，無需學習和上手
  ![圖片](https://github.com/user-attachments/assets/b871ec43-731a-468c-ad74-6c5a7ba8d737)

### 2. 知識資產化與無縫分享

- **即時報告生成**：將對話氣泡直接拖曳至資料夾，瞬間生成獨立的 HTML 報告。適合快速整理技術文件、會議紀錄或靈感片段。
  ![圖片](https://github.com/user-attachments/assets/0ef54ac0-7575-4b52-aa44-7b555dc4c4be)
- **工作流封裝與分發**：將你創建好的角色直接拖曳至桌面，生成可分享的檔案。讓你的 Prompt 工程和工作流邏輯輕鬆分發給同事或社群。
  ![圖片](https://github.com/user-attachments/assets/5e14fe6e-2c65-492a-a09f-964c1e8ab9e0)

### 3. 即時程式碼執行環境

不再僅僅是 Markdown 語法突顯。在 fount 中，角色發送的程式碼區塊是**鮮活的**。

- 支援多種語言（C/C++/Rust/Python/JS 等）的即時編譯與執行。
- 直接查看 stdout 輸出，甚至查看編譯語言的 ASM 反組譯結果。
- 讓 AI 成為你協同程式設計 (Pair Programming) 的即時驗證者。
  ![圖片](https://github.com/user-attachments/assets/66792238-4d70-4fa6-b0b3-76e506e49977)

### 4. 開發者友好

fount 的專案架構設計充分考慮了開發者的習慣。
[想知道專案儲存庫架構嗎？快來看看 DeepWiki！](https://deepwiki.com/steve02081504/fount)

- **Git 驅動**：所有部件均可透過 Git 管理。
- **VSCode 整合**：專案結構清晰，配合 [AGENTS.md](../AGENTS.md) 提供的指引，你可以直接在你喜歡的 IDE 中開發、除錯你的 Agent 邏輯。

---

## 🎭 沉浸與共鳴：高保真互動體驗

當工作結束，fount 提供了一種超越尋常的連接。我們摒棄了傳統工具的生硬感，追求一種自然、流暢且富有深度的「高保真」互動。

- **隨時隨地的無縫對話**
  在電腦上開啟的絮語，可以在手機或平板上無縫延續。fount 讓你的對話保持同步，無論身在何處，都能與你的角色緊密相連。

- **富有表現力、身臨其境的聊天**
  fount 藉由 HTML 的力量，允許角色透過富文本、圖像甚至互動式元素來表達自我，讓每一次對話都生動而深刻。

- **思想的聚會：原生群組聊天**
  邀請多個角色加入同一場對話，見證他們之間動態且引人入勝的互動，無論是工作上的腦力激盪，還是角色間的故事演繹。
  ![圖片](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)

- **美觀、可客製化的介面**
  從 30 餘款令人驚嘆的主題中挑選，或親手創造屬於你的色彩。fount 是你專屬的畫布。
  ![圖片](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)

- **隨處可用**
  fount 可在 Windows、macOS、Linux 甚至 Android 上無縫運行，透過直接安裝或 Docker 的靈活性來滿足你的不同需求。

- **無拘無束的 AI 源整合：擁抱無限**
  fount 在連接 AI 源方面，提供了無與倫比的*選擇*與*靈活性*。在 AI 源生成器中，自定義的 JavaScript 程式碼允許你連接到*任何* AI 源——OpenAI、Claude、OpenRouter、NovelAI、Horde、Ooba、Tabby、Mistral……在程式碼的流動中，你可以精心設計複雜的正規表示式，呼叫龐大的 API 函式庫，嵌入多媒體資源。fount 亦原生支援創建 API 池，以實現智慧的請求路由。通訊的邏輯，聽憑*你*的意願，由程式碼的力量來塑造。
  ![圖片](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

倘若你感到迷失於角色的海洋，或是在尋覓被遺忘的故事，我們[**充滿活力且友好的社群**](https://discord.gg/GtR9Quzq2v)期待你的到來。那是一個志同道合者的港灣，開發者與創作者們在此分享他們的智慧與創作。

---

## 陪伴：超越數位的藩籬

fount 致力於將角色編織進你生活的紋理，提供超越螢幕的陪伴與支持。

- **Discord/Telegram 整合**
  透過內建的 Bot Shells，將你的角色連接到 Discord 或 Telegram 社群，讓他們成為活生生的成員。
  ![圖片](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
  ![圖片](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)
  ![圖片](https://github.com/user-attachments/assets/b83301df-2205-4013-b059-4bced94e5857)

- **瀏覽器整合**
  將角色整合到瀏覽器擴充功能中，讓角色能夠**看到並修改**你瀏覽器中的頁面內容，實現真正的「與 AI 一起上網」。
  你可以對你的角色說：嘿 XX，幫我給這個頁面換個顏色並加點裝飾。
  ![圖片](https://github.com/user-attachments/assets/c4dd7d46-122d-45f3-b0fe-53239725dcd6)

- **IDE 整合**
  將角色整合到 JetBrains、neovim、Zed 等 IDE 中，讓角色像 Cursor Agent 或 GitHub Copilot 一樣，在編寫程式碼時為你提供上下文感知的輔助與建議。
  ![圖片](https://github.com/user-attachments/assets/70385a8d-c2cf-474d-b894-12f8675c2dc9)

- **終端機的寧靜 (與 [fount-pwsh](https://github.com/steve02081504/fount-pwsh) 結合)**
  當終端機指令執行失敗時，讓你的角色在旁輕聲提供指導，化解程式碼世界的孤寂。
  ![圖片](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- **無限的 Shell 擴充**
  憑藉些許程式設計技巧，你便能創造屬於自己的 fount Shell，將角色的觸角延伸至你所能想像的任何角落。

---

## 創作：超越提示詞的疆界

對於創作者而言，fount 提供了一條更為清晰的道路，讓你的 AI 角色栩栩如生。

- **革命性的 AI 輔助創作**
  用一句話描述你心中的角色，我們智慧的 AI 助理便會為你生成一個完整的人設。這大大簡化了初始的繁瑣，讓你能專注於完善和與你的創作互動。

- **程式碼的魔力，比你想像中更易觸及**
  在 fount 中，程式碼是一種現代魔法。在我們社群的悉心指導與 AI 的啟發下，學習它出乎意料地容易。你會發現，用程式碼來定義角色的邏輯，可以是一種直觀且易於維護的方式，創造出其回應由*你*的邏輯編織而成的角色。

- **從現成的魔法開始：範本寶庫**
  fount 社群提供了大量預製的角色與人設範本。它們是「活的藍圖」，易於調整和自訂，為你提供絕佳的起點。

- **嵌入式資源**
  將圖片、音訊等資源直接編織進你的角色，讓他們的存在更加豐滿。
  ![圖片](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

- **持續整合**
  使用 [fount-charCI](https://github.com/marketplace/actions/fount-charci) 為你的角色開發護航，在 commit 時自動執行測試，即時回報問題。
  ![圖片](https://github.com/user-attachments/assets/3f6a188d-6643-4d70-8bd1-b75f00c76439)
  ![圖片](https://github.com/user-attachments/assets/30eb8374-64c2-41bc-a7d1-f15596352260)

- **舊有相容性**
  fount 擁抱過去，提供相容模組來執行 SillyTavern 和 Risu 角色卡（儘管不支援現有角色的遷移）。

---

## 架構：創新的基石

fount 建構於一個強大且可擴充的架構之上。後端利用 [Deno](https://deno.com/) 的安全與迅捷，並採用 [Express](https://expressjs.com/) 實現高效路由。前端則由 HTML、CSS 與 JavaScript 精心打造，提供直觀且賞心悅目的介面。

### 擴充：由萬千絲線交織的創新織錦

在 fount 的世界裡，模組化至高無上。一個豐富的組件生態系統相互交織，創造出你體驗的織錦。所有這些組件都可以由使用者輕鬆安裝、擴充和自訂。

- **chars (角色):** fount 的核心，個性的誕生地。
- **worlds (世界):** _遠不止於傳說。_ 它們是現實的沉默建築師，可以向角色注入知識，影響其決定，甚至操縱聊天記錄。
- **personas (使用者人設):** _不僅僅是使用者設定檔。_ 人設擁有扭曲甚至控制你的言行和感知的力量，使得真正身歷其境的角色扮演成為可能。
- **shells (互動介面):** 通往 fount 靈魂的門戶，將角色的觸角延伸到介面之外。
- **ImportHandlers (匯入處理器):** fount 的歡迎之手，彌合不同角色格式之間的差距。
- **AIsources (AI 來源):** 為你的角色思想提供動力的原始力量。
- **AIsourceGenerators (AI 來源產生器):** fount 的煉金術士，透過 JavaScript 的力量，提供範本和邏輯，以建立與*任何*可以想像的 AI 來源的連接。

![圖片](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

## 安裝與移除：一場優雅的相遇與告別

### 安裝：將 fount 編織入你的世界 – _毫不費力_

> [!TIP]
>
> 若你希望從零開始完成配置、搭建與入門，可參閱社群教學 [**fount 從零開始的傻瓜式指南**](https://github.com/Xiaoqiush81/fount-Guide-for-dummies)（教學為中文，非中文使用者可使用瀏覽器翻譯功能閱讀）。

以 fount 開啟你的旅程，這是一個穩定可靠的平台。只需幾次簡單的點擊或指令，fount 的世界便會徐徐展開。

> [!CAUTION]
>
> 在 fount 的世界裡，角色可以自由地執行 JavaScript 指令，這賦予了它們強大的能力。因此，請您謹慎選擇您所信任的角色，如同在現實生活中結交朋友一般，以保障本機檔案的安全。

### Linux/macOS/Android：Shell 的低語 – _一行指令，即刻啟程_

```bash
# 若需要，定義環境變數 $FOUNT_DIR 來指定 fount 目錄
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

若你希望稍作停頓，在盛大冒險之前整理思緒（一次預演）：

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { _command_name="$1"; _package_list=${2:-$_command_name}; _has_sudo=""; _installed_pkg_name="" ; if command -v "$_command_name" >/dev/null 2>&1; then return 0; fi; if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then _has_sudo="sudo"; fi; for _package in $_package_list; do if command -v apt-get >/dev/null 2>&1; then $_has_sudo apt-get update -y; $_has_sudo apt-get install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pacman >/dev/null 2>&1; then $_has_sudo pacman -Syy --noconfirm; $_has_sudo pacman -S --needed --noconfirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v dnf >/dev/null 2>&1; then $_has_sudo dnf install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v yum >/dev/null 2>&1; then $_has_sudo yum install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v zypper >/dev/null 2>&1; then $_has_sudo zypper install -y --no-confirm "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v apk >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apk add --update "$_package"; else $_has_sudo apk add --update "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v brew >/dev/null 2>&1; then if ! brew list --formula "$_package"; then brew install "$_package"; fi; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; if command -v snap >/dev/null 2>&1; then $_has_sudo snap install "$_package"; if command -v "$_command_name" >/dev/null 2>&1; then _installed_pkg_name="$_package"; break; fi; fi; done; if command -v "$_command_name" >/dev/null 2>&1; then case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in *";$_installed_pkg_name;"*) ;; *) if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"; else FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"; fi; ;; esac; return 0; else echo "Error: Failed to install '$_command_name' from any source." >&2; return 1; fi; }
install_package "bash" "bash gnu-bash"; install_package "curl"
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows：殊途同歸 – _至簡之道_

- **直接且純粹（推薦）：** 從 [Releases](https://github.com/steve02081504/fount/releases) 下載 `exe` 檔案並執行。

- **PowerShell 的力量：**

  ```powershell
  # 若需要，定義環境變數 $env:FOUNT_DIR 來指定 fount 目錄
  irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
  ```

  若需預演：

  ```powershell
  $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
  Invoke-Expression "function fountInstaller { $scriptContent }"
  fountInstaller init
  ```

### Git 安裝：為那些偏愛些許魔法的人

如果你已安裝 Git，擁抱 fount 就像執行一個腳本一樣簡單。

- **對於 Windows：** 開啟命令提示字元或 PowerShell，只需雙擊 `run.bat`。
- **對於 Linux/macOS/Android：** 開啟終端機並執行 `./run.sh`。

### Docker：擁抱容器

```bash
docker pull ghcr.io/steve02081504/fount
```

### 移除：優雅的告別

```bash
fount remove
```

## 遭遇陰影？不必驚慌

如果你在旅途中遇到任何困難，請聯繫我們。我們隨時準備提供協助，並致力於在 10 分鐘到 24 小時內解決大多數問題。

- **GitHub Issues：** 透過 [GitHub Issues](https://github.com/steve02081504/fount/issues) 回報任何錯誤或提出新功能的建議。
- **Discord 社群：** 加入我們[充滿活力的 Discord 社群](https://discord.gg/GtR9Quzq2v)，以獲得即時的支援與討論。

你的聲音終將被聽見。只需重啟 fount，陰影便會消散。

---

## 徽章與連結：讓創作閃耀，讓世界觸手可及

fount 的世界不止是文字與程式碼，它更是一場視覺與連結的盛宴。我們為你準備了精美的徽章和便利的連結，讓你的創作在這份光彩中熠熠生輝。

### fount 徽章：榮耀的印記

你可以自豪地在你的儲存庫或任何希望展示的地方，使用這枚徽章。你可以在[此處](../imgs/)找到 fount logo 的 SVG 檔案。

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/topics/fount-repo)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/topics/fount-repo)

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://github.com/topics/fount-character)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://github.com/topics/fount-character)

| 顏色格式 |        程式碼        |
| :------: | :------------------: |
|   HEX    |      `#0e3c5c`       |
|   RGB    |  `rgb(14, 60, 92)`   |
|   HSL    | `hsl(205, 74%, 21%)` |

你也可以使用[徽章添加器](https://steve02081504.github.io/fount/badges/)，將任何 shields.io 的徽章帶上 fount 的 logo。

### 自動安裝連結：指尖上的魔法

想像一下，其他使用者只需輕輕一點，就能將你的創作直接安裝到他們的 fount 世界中。只需將你的組件 zip 連結或 Git 儲存庫連結與 fount 的協定連結組合即可。

`https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;` + `你的組件連結`

---

## 推薦的瀏覽器：為了一場完美的邂逅

fount 的前端由現代 Web 技術織成，但並非所有瀏覽器都能與它的靈魂產生完美的共鳴。為了一場最沉靜、最流暢的體驗，我們推薦與 fount 的步調最為和諧的夥伴：

- [**Google Chrome**](https://www.google.com/chrome/) / [**Microsoft Edge**](https://www.microsoft.com/edge/) / [**Opera**](https://www.opera.com/)：它們與 fount 的精神同步，能提供最出色的效能與相容性，讓每一次互動都如詩般流暢。

而有些瀏覽器，它們走在不同的道路上，與 fount 的相遇可能會帶有些許不協調的微音：

- **Mozilla Firefox**：它像一位固執的漫遊者，對新技術的接納總是不疾不徐，有時甚至選擇永遠停留在過去。這份堅持，卻可能導致一些遺憾：
  - 由於缺少對 [`speculationrules`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules) 的支援，fount 的每次冷啟動和協定處理都會比應有的慢上 1-2 秒，這些是被悄然偷走的時光。
  - 對 [CSS `anchor` 定位](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_anchor_positioning)支援的缺失，會讓部分頁面的 UI 沾染上一絲不完美的塵埃，破壞了那份本該純粹的心情。
  - 對 [`blocking="render"`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script) 支援的缺席，則可能導致 fount 頁面在載入時閃爍，傷害你的眼睛。
  - 據後台的錯誤回報，唯有在 Firefox 的世界裡，fount 頁面有時會陷入神秘的錯誤或呈現怪異的樣貌——當那種情況發生時，試試重新整理，或許能驅散迷霧。

- **Apple Safari**：它對「新興」（數年前）Web 標準的支援，或許比 Firefox 多了一絲親近，但終究不多。
  - 同樣缺少對 [`speculationrules`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/speculationrules) 的支援，這意味著 fount 的啟動依然會帶有些許遲緩，浪費你寶貴的片刻。

- **Brave**：它基於 Chromium，但其強大的隱私之盾，有時可能會無意中遮蔽 fount 的某些光芒，影響部分功能的正常運作。

---

### 見證成長：fount 的 Star 歷史

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### 貢獻者們

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)

### 結語：工匠之觸

在 AI 的低語之外，fount 提供了一種更深層次的連結——_工匠之觸_。在我們的社群中，你會發現大量預先製作的角色與人設範本，_每一個都是精心雕琢的基礎，等待著你獨特的願景去喚醒_。

fount 讓你能以一種自然、身歷其境且深刻個人化的方式，去創造並與 AI 角色互動。無論你是經驗豐富的創作者，還是剛剛開始你的旅程，fount 都歡迎你的到來。

加入我們**友善的社群**，在一個成熟的平台和一個專注的團隊的支持下，發現將生命注入你想像力的魔力。
