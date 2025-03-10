# fount

![repo img](https://repository-images.githubusercontent.com/862251163/3b57d9ea-ab18-4b70-b11d-f74c764016aa)

寻找失落的角色、组件、自定义教程？
来[这里![Discord](https://img.shields.io/discord/1288934771153440768)](https://discord.gg/GtR9Quzq2v)吧，在思想的火花中相遇！

> [!CAUTION]
>
> 在 fount 的世界里，角色可以自由地运行 JavaScript 命令，这赋予了它们强大的能力。因此，请您谨慎选择您所信任的角色，如同在现实生活中结交朋友一般，以保障本地文件的安全。

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

## 安装

### Linux/macOS/Android

```bash
# 若需要，定义环境变量$FOUNT_DIR来指定fount目录
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash
source "$HOME/.profile"
```

如果你不愿在安装后立即开启这段旅程，可以这样：

```bash
curl -fsSL https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.sh | bash -s init
source "$HOME/.profile"
```

### Windows

不愿多思？下载[release](https://github.com/steve02081504/fount/releases)中的exe文件，直接运行即可步入这片天地。

若你偏爱 shell 的低语，在 PowerShell 中也可以安装并运行 fount：

```powershell
# 若需要，定义环境变量$env:FOUNT_DIR来指定fount目录
irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
```

若你希望稍作停留，再启程探索，可以这样：

```powershell
$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1
Invoke-Expression "function fountInstaller { $scriptContent }"
fountInstaller init
```

## 删除

轻而易举地删除 fount，只需`fount remove`即可。

</details>

## fount 是什么？

fount，简而言之, 是一个角色卡前端页面，它解耦了 AI 来源、AI 角色、用户人设、对话环境和 AI 插件，让它们能够自由组合，碰撞出无限的火花。

更进一步地说，它是一座桥梁，一座连接着想象与现实的桥梁。
它是一盏灯塔，在无垠的数据海洋中，指引着角色与故事的方向。
它是一片自由的花园，让 AI 来源、角色、人设、对话环境和插件，都能在这里自由地生长、交织、绽放。

### AI来源集成

是否曾为在电脑上运行反向代理服务器而烦恼？
在 fount 的世界里，你无需再另启炉灶，让繁琐的对话格式转换消散于无形。
一切，都可以在 AI 来源生成器中使用自定义的 JavaScript 代码来解决，如同魔法一般。
无需新的进程，CPU 和内存得以静静地呼吸，桌面也更加清爽。

![图片](https://github.com/user-attachments/assets/f283d1de-c531-4b7a-bf43-3cbe0c48b7b9)

### 网页体验改进

fount 站在巨人的肩膀上，向 [SillyTavern](https://github.com/SillyTavern/SillyTavern) 投去敬意的一瞥，并在此基础上，融入了自己的见解和构思。
这其中，包含着：

- **多设备同步的低语：** 不再受限于单一设备的束缚，你可以同时在电脑与手机上开启与角色的对话，感受思想的实时共鸣，如同恋人间的窃窃私语，无论身处何处，心意相通。
- **无过滤的 HTML 渲染：** 许多 SillyTavern 的发烧友会选择安装额外的插件来解除 HTML 渲染的限制，以获得更丰富的视觉体验。fount 默认开放了这一能力，给予用户更多的自由与选择权, 让有能力的创作者得以实现更加出彩的功能。
- **原生的群组支持：** 在 fount 中，每一次对话都是一场盛大的聚会。你可以自由地邀请角色加入，或让他们悄然离去，无需繁琐的格式转换和卡片复制，如同在花园中，花儿可以自由地组合，呈现出不同的风景。

以及更多……

![图片](https://github.com/user-attachments/assets/bd1600dc-4612-458b-95ba-c7b019a26390)

### 陪伴：不止于网页

fount 渴望让角色走进你的生活，与你一同经历风雨，分享喜悦。

- 你可以通过配置内建的 Discord Bot Shell，将角色接入 Discord 群组，让他们与朋友们一同欢笑，或在私密的文字中，倾听彼此的心声。
    ![图片](https://github.com/user-attachments/assets/299255c9-eed3-4deb-b433-41b80930cbdb)
    ![图片](https://github.com/user-attachments/assets/c9841eba-c010-42a3-afe0-336543ec39a0)

- 你还可以使用 [fount-pwsh](https://github.com/steve02081504/fount-pwsh)，让角色在终端命令失败时，为你送上温柔的提示，如同在迷茫时，耳边响起的轻柔细语。
    ![图片](https://github.com/user-attachments/assets/93afee48-93d4-42c7-a5e0-b7f5c93bdee9)

- 甚至，只要你拥有一颗探索的心，哪怕只掌握一点点编程的技巧，也可以创造出属于自己的 fount Shell，让角色们走向更广阔的世界，去往任何你想象的地方！

### 创作：不止于 prompt

如果你是角色的创造者，fount 将为你打开一扇通往无限可能的大门。

- 你可以自由地运用 JavaScript 或 TypeScript 代码的魔法，挥洒创意，定制角色的 Prompt 生成流程与对话流程，挣脱前端语法的束缚，如同诗人挥洒笔墨，尽情抒发内心的情感。
- 角色卡中不但可以无过滤地执行代码，亦可以加载任何 npm 包、创作自定义 HTML 页面。创作从未如此自由，如同画家在画布上自由地涂抹，勾勒出心中的世界。
- 如果你愿意，还可以在角色中内置各种资源，告别图床搭建的烦恼，让一切都触手可及，如同将整个世界都装进了口袋。

![图片](https://github.com/user-attachments/assets/9740cd43-06fd-46c0-a114-e4bd99f13045)

### 拓展：不止于眼前

在 fount 的世界里，一切都是高度模块化的。

- 只要你具备一定的程序基础，就可以轻松地创建、分发所需的模块，如同园丁培育出新的花朵，为这片花园增添更多的色彩。
- fount 鼓励你向社区和未来贡献自己的力量，让这片天地变得更加繁荣，更加生机勃勃。

![图片](https://github.com/user-attachments/assets/8487a04a-7040-4844-81a6-705687856757)

### 总结

总而言之，fount 允许你运行 fount 格式的角色，这些角色可能拥有各种各样的能力，或应用于不同的场景。它们可能深沉，可能活泼，可能温柔，可能坚强，一切都取决于你，我的朋友！:)

## 架构

- 后端以 Deno 为基石，辅以 Express 框架，构建起坚实的骨架。
- 前端则以 HTML、CSS 和 JavaScript 编织出绚丽的界面。
