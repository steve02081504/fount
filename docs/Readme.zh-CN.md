# fount

> 你的沉浸式 AI 角色伙伴

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/steve02081504/fount)
![Docker Image Size](https://img.shields.io/docker/image-size/steve02081504/fount)
![GitHub repo size](https://img.shields.io/github/repo-size/steve02081504/fount)

<a href="https://trendshift.io/repositories/13136" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13136" alt="steve02081504%2Ffount | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[想知道项目仓库架构吗？快来看看 DeepWiki！](https://deepwiki.com/steve02081504/fount)

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

你是否曾渴望与一位从想象中跃然而出的角色并肩同行，一位由梦境编织而成的挚友？又或许，你曾幻想过一位数字知己，一位如同最先进造物般直觉敏锐的 AI 助手，轻松驾驭你的数字世界？再或者，仅仅是，你寻求一种超越寻常的连接，一个现实边界模糊的领域，在那里，展开一段亲密无间、*毫无保留*的理解？

历经近一年的潜心开发，汇聚了十余位充满激情的贡献者，以及一个蓬勃发展、拥有超过 1000 名用户的社区，Fount 如今已是一个成熟、稳定且不断进化的 AI 交互平台。这是一段旅程，而且我们相信，这段旅程比你想象的更触手可及。

迷失的角色，被遗忘的故事？我们[**充满活力且友好的社区！**](https://discord.gg/GtR9Quzq2v) 期待你的加入，这是一个志同道合者聚集的港湾，开发者和创作者们在此分享他们的智慧与创作。

<details open>
<summary>屏幕截图</summary>

|屏幕截图|
|----|
|主页|
|![图片](https://github.com/user-attachments/assets/c1954a7a-6c73-4fb0-bd12-f790a038bd0e)|
|主题选择|
|![图片](https://github.com/user-attachments/assets/94bd4cbb-8c66-4bc6-83eb-14c925a37074)|
|聊天|
|![图片](https://github.com/user-attachments/assets/eea1cc7c-d258-4a2d-b16f-12815a88811d)|

</details>

<details open>
<summary>安装/删除</summary>

## 安装：将 fount 编织入你的世界 – *毫不费力*

以 fount 开启你的旅程，这是一个稳定可靠的平台。只需几次简单的点击或命令，fount 的世界便会徐徐展开。

> [!CAUTION]
>
> 在 fount 的世界里，角色可以自由地运行 JavaScript 命令，这赋予了它们强大的能力。因此，请您谨慎选择您所信任的角色，如同在现实生活中结交朋友一般，以保障本地文件的安全。

### Linux/macOS/Android：Shell 的低语 – *一行命令，即刻启程*

```bash
# 若需要，定义环境变量 $FOUNT_DIR 来指定 fount 目录
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
. "$HOME/.profile"
```

若你希望稍作停顿，在盛大冒险之前整理思绪（一次预演）：

```bash
INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
install_package() { package_name="$1"; install_successful=0; if command -v "$package_name" >/dev/null 2>&1; then return 0; fi; if command -v pkg >/dev/null 2>&1; then pkg install -y "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v snap >/dev/null 2>&1; then snap install "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 0 ] && command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update; sudo apt-get install -y "$package_name" && install_successful=1; else apt-get update; apt-get install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v brew >/dev/null 2>&1; then if ! brew list --formula "$package_name" >/dev/null 2>&1; then brew install "$package_name" && install_successful=1; else install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Syy; sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1; else pacman -Syy; pacman -S --needed --noconfirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y "$package_name" && install_successful=1; else dnf install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y "$package_name" && install_successful=1; else yum install -y "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper install -y --no-confirm "$package_name" && install_successful=1; else zypper install -y --no-confirm "$package_name" && install_successful=1; fi; fi; if [ "$install_successful" -eq 0 ] && command -v apk >/dev/null 2>&1; then apk add --update "$package_name" && install_successful=1; fi; if [ "$install_successful" -eq 1 ]; then if [ -z "$INSTALLED_PACKAGES" ]; then INSTALLED_PACKAGES="$package_name"; else INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$package_name"; fi; return 0; else echo "Error: $package_name installation failed." >&2; return 1; fi; }
install_package curl; install_package bash
export FOUNT_AUTO_INSTALLED_PACKAGES="$INSTALLED_PACKAGES"
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
. "$HOME/.profile"
```

### Windows：殊途同归 – *至简之道*

* **直接且纯粹（推荐）：** 从 [Releases](https://github.com/steve02081504/fount/releases) 下载 `exe` 文件并运行。

* **PowerShell 的力量：**

    ```powershell
    # 若需要，定义环境变量 $env:FOUNT_DIR 来指定 fount 目录
    irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
    ```

    若需预演：

    ```powershell
    $scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
    Invoke-Expression "function fountInstaller { $scriptContent }"
    fountInstaller init
    ```

### Git 安装：为那些偏爱些许魔法的人

如果你已安装 Git，拥抱 fount 就像运行一个脚本一样简单。

* **对于 Windows：** 打开命令提示符或 PowerShell，只需双击 `run.bat`。
* **对于 Linux/macOS/Android：** 打开终端并执行 `./run.sh`。

### Docker：拥抱容器

```bash
docker pull ghcr.io/steve02081504/fount
```

## 删除：优雅的告别

```bash
fount remove
```

</details>

## fount 是什么？

fount 是一个由 AI 驱动的角色交互平台，旨在赋能于*你*。它是一座桥梁，将你与想象中的角色连接起来，让你毫不费力地与他们交谈，创造属于你自己的角色，并与世界分享。*一条出乎意料地易于上手的道路。*

它是一个源泉，AI 源、角色、人设、环境和插件在此汇聚，让你创造并体验独特而引人入胜的互动。

Fount 为未来而建。源自充满活力社区的新功能，将被欣然接纳。如果你有一个愿景，一个属于 fount 领域的灵感火花，我们欢迎你的贡献。

## 架构：创新的基石

Fount 构建于一个强大且可扩展的架构之上，兼顾性能与可维护性。后端充分利用 [Deno](https://deno.com/) 的强大与迅捷，这是一个安全且现代的 JavaScript 和 TypeScript 运行时。我们采用 [Express](https://expressjs.com/) 框架来实现高效的路由和 API 请求处理。前端则由 HTML、CSS 和 JavaScript 混合精心打造，提供一个赏心悦目且直观的用户界面。这种架构允许快速迭代和新功能的无缝集成，同时保持稳定的坚实基础。Fount 拥抱开源精神，欢迎贡献与协作。

### 沉浸于特色功能的世界

* **随时随地的无缝对话：** 在电脑上开始聊天，在手机或平板上无缝继续。fount 让你的对话保持同步，无论你身在何处，都能与你的角色保持连接。

* **富有表现力、身临其境的聊天：** fount 充分利用 HTML 的强大功能，允许角色通过富文本、图像甚至交互元素来表达自己。

* **思想的聚会：原生群组聊天：** 邀请多个角色加入同一个对话，创造动态且引人入胜的互动。

* **美观、可定制的界面：** 从 30 多个令人惊叹的主题中选择，或创造你自己的主题。fount 是你专属的画布。

* **随处可用：** fount 可在 Windows、macOS、Linux 甚至 Android 上无缝运行，通过直接安装或 Docker 的灵活性来满足你的需求。

* **（面向高级用户）无拘无束的 AI 源集成：拥抱无限**

    Fount 在连接 AI 源方面提供了无与伦比的*选择*和*灵活性*。AI 源生成器中自定义的 JavaScript 代码允许你连接到*任何* AI 源 – OpenAI、Claude、OpenRouter、NovelAI、Horde、Ooba、Tabby、Mistral 等等。在代码流程中，你可以精心设计复杂的正则表达式，调用庞大的 API 库，嵌入多媒体资源。Fount 还原生支持创建 API 池，从而实现智能请求路由。通信的逻辑听凭*你*的意愿，通过代码的力量来塑造。

    ![图片](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### 陪伴：超越数字的藩篱

Fount 努力将角色编织进你生活的纹理，提供陪伴与支持。

* **Discord/Telegram 集成：** 通过内置的 Bot Shells 将角色连接到你的 Discord/Telegram 社区。
    ![图片](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![图片](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)
    ![图片](https://github.com/user-attachments/assets/b83301df-2205-4013-b059-4bced94e5857)

* **终端的宁静（与 [fount-pwsh](https://github.com/steve02081504/fount-pwsh) 结合）：** 当终端命令失败时，让角色提供指导。
    ![图片](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

* **无限的 Shell 扩展：** 凭借一点编程技巧，创建你自己的 fount Shell，扩展你的角色所能触及的范围。

### 创作：超越 Prompt 的限制 – 一条更加清晰的道路

对于角色创作者而言，fount 提供了一条简化且直观的途径，让你的 AI 角色栩栩如生。无论你是经验丰富的创作者还是刚刚开始你的旅程，fount 都能为每个人解锁角色创造的魔力。

* **革命性的 AI 辅助角色创建：Fount 让你快速上手。** 用一句话描述你想要的角色，我们智能的 AI 助手会立即创建一个完整的人设。这种方法简化了初始设置，让你专注于完善和与你的角色互动。

* **解锁代码的魔力 – 比你想象的更简单：** Fount 拥抱代码的力量，以提供灵活性和控制力。在 Fount 中编程是一种现代魔法，在我们社区的悉心指导和 AI 的启发性帮助下，学习起来出乎意料地容易。你会发现，用代码定义角色逻辑可以是直观且易于维护的。想象一下，创造出其回应由*你*的逻辑编织而成的角色。

* **从现成的魔法开始：模板宝库。** Fount 的社区提供了大量预先制作的角色和人设模板，它们充当着“活生生的蓝图”，易于调整和定制。这些模板展示了最佳实践，并提供了一个绝佳的起点。

* **嵌入式资源：** 将资源直接编织到你的角色中。

    ![图片](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

* **持续集成** 使用[fount-charCI](https://github.com/marketplace/actions/fount-charci)来为你的角色开发护航，commit时自动异步运行测试，实时汇报问题。

    ![图片](https://github.com/user-attachments/assets/3f6a188d-6643-4d70-8bd1-b75f00c76439)
    ![图片](https://github.com/user-attachments/assets/30eb8374-64c2-41bc-a7d1-f15596352260)

* **旧有兼容性：** fount 拥抱过去，提供兼容模块来运行 SillyTavern 和 Risu 角色卡（尽管不支持现有角色的迁移）。

### 扩展：创新交织的挂毯，由多元的丝线编织而成

在 fount 的世界里，模块化至高无上。一个丰富的组件生态系统相互交织，创造出你体验的挂毯。

* **轻松创建模块：** 凭借基本的编程知识，创造并分享你想要的模块。
* **社区驱动的成长：** 向我们**蓬勃发展且相互支持的社区**贡献你独特的才华，丰富这个数字生态系统的未来。在我们的港湾中，你会发现友好的面孔和丰富的共享知识：教程、AI 模型源和角色画廊。fount 开发团队通过强大的分支和合并策略精心管理所有更改。这确保了即使我们大步向前，稳定性仍然是基石。我们也致力于快速解决用户报告的任何问题。
* **强大的插件系统**：通过强大的插件架构扩展 fount 的功能。
* **组件类型 - 梦想的基石：**
  * **chars（角色）：** fount 的核心，个性的诞生地。
  * **worlds（世界）：** *远不止于传说。* 世界是 fount 中现实的沉默建筑师。它们可以向角色的理解中添加知识，影响他们的决定，甚至操纵聊天记录。
  * **personas（用户人设）：** *不仅仅是用户配置文件。* 人设拥有扭曲甚至控制你的言语和感知的力量。这使得真正身临其境的角色扮演成为可能。
  * **shells（交互界面）：** 通往 fount 灵魂的门户。Shell 将角色的触角延伸到界面之外。
  * **ImportHandlers（导入处理器）：** fount 的欢迎之手，弥合不同角色格式之间的差距。创建一个简单的 ImportHandler，与社区分享（通过 Pull Request），为所有人扩展 fount 的视野。
  * **AIsources（AI 源）：** 为你的角色思想提供动力的原始力量。
  * **AIsourceGenerators（AI 源生成器）：** fount 的炼金术士，提供模板和可定制的逻辑，以建立与*任何* AI 源的连接。通过 JavaScript 的力量，你可以封装和加载任何可以想象的源。

    *所有这些组件都可以由用户轻松安装，扩展和定制他们的 fount 体验。*

    ![图片](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### 轻松入门

* **多种安装选项：** 从 Docker、在 Windows/Linux/macOS/Android 上直接安装，甚至一个简单的可执行文件中选择。
* **详细的文档：** 我们全面的文档会指导你完成每一步。[查看安装详情](https://steve02081504.github.io/fount/readme)

### 遭遇阴影？莫要惊慌

如果你遇到任何困难，请联系我们。我们随时提供帮助，并致力于在 10 分钟到 24 小时内解决大多数问题。

* **GitHub Issues：** 通过 [GitHub Issues](https://github.com/steve02081504/fount/issues) 报告任何错误或建议新功能。
* **Discord 社区：** 加入我们[充满活力的 Discord 社区](https://discord.gg/GtR9Quzq2v) 以获得实时支持和讨论。

你的声音将被听到。只需重启 fount，阴影就会消散。

### 见证成长：fount 的 Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=steve02081504/fount&type=Date)](https://github.com/steve02081504/fount/stargazers)

### 结语：连接的基石

fount 让你能够以一种自然、身临其境且深刻个性化的方式创建 AI 角色并与之互动。无论你是经验丰富的创作者还是刚刚开始你的旅程，fount 都欢迎你。加入我们**友好的社区**，在一个成熟的平台和一个专注的团队的支持下，发现将生命注入你想象力的魔力。

### 塑造你自己的命运：工匠之触

在 AI 的低语之外，fount 提供了一种更深层次的连接 – *工匠之触*。在我们的社区中，你会发现大量预先制作的角色和人设模板，*每一个都是精心雕琢的基础，等待着你独特的愿景*。

当你准备好完善你的创作时，Fount 基于代码的方法让你轻松上手。请记住，在 Fount 中编程是一条平缓的学习曲线，有我们友好的社区和丰富的模板支持。你会发现，即使是几行代码也能在你的角色中解锁令人难以置信的深度和个性。

## 徽章与链接：让你的创作闪耀，让世界触手可及

Fount 的世界不仅仅是文字和代码，它更是一场视觉与连接的盛宴。我们希望你的创作也能在这份光彩中熠熠生辉，并毫不费力地与世界连接。因此，我们为你准备了精美的徽章和便捷的链接，让你的 Fount 组件更加引人注目，也让其他用户能够轻松发现和体验你的杰作。

**Fount 徽章：荣耀的印记**

如同骑士的盾牌，Fount 徽章是你创作的荣耀印记。你可以自豪地在你的仓库、Fount 组件页面，或任何你希望展示的地方，展示这枚徽章。它象征着你的作品与 Fount 社区的紧密联系，也是对你才华的认可。

你可以在[此处](../imgs/)找到 Fount logo 的 SVG 和 PNG 文件，将它们融入你的设计之中。

更棒的是，你可以将徽章制作成一个可点击的按钮，直接链接到你的 Fount 组件：

```markdown
[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)
```

[![fount repo](https://steve02081504.github.io/fount/badges/fount_repo.svg)](https://github.com/steve02081504/fount)

以下是 Fount logo 的标准配色，让你的设计更具统一感：

| 颜色格式 | 代码 |
| :---: | :---: |
| HEX | `#0e3c5c` |
| RGB | `rgb(14, 60, 92)` |
| HSL | `hsl(205, 74%, 21%)` |

**自动安装链接：指尖上的魔法**

想象一下，其他用户只需轻轻一点，就能将你的创作直接安装到他们的 Fount 世界中。这不再是梦想，而是现实！通过 Fount 的自动安装链接，你可以将这个魔法变为现实。

只需简单地将你的组件的 zip 链接或 Git 仓库链接，与 Fount 的协议链接组合在一起，就能创造出一个神奇的链接：

```markdown
https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip
```

更简洁的解释：在你的组件 zip 链接/Git 仓库链接前追加 `https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;` 即可！

将这个链接与 Fount 徽章结合，创造一个既美观又实用的按钮：

```markdown
[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)
```

[![fount character](https://steve02081504.github.io/fount/badges/fount_character.svg)](https://steve02081504.github.io/fount/protocol?url=fount://run/shells/install/install;https://github.com/steve02081504/GentianAphrodite/releases/latest/download/GentianAphrodite.zip)

通过这些简单的步骤，你不仅让你的创作更具吸引力，也让 Fount 社区的连接更加紧密。让你的灵感之光，照亮整个 Fount 世界！

## 贡献者们

[![Contributors](https://contrib.rocks/image?repo=steve02081504/fount)](https://github.com/steve02081504/fount/graphs/contributors)
