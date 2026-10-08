# Code shell CLI 调研与实施规划

日期：2026-10-07。状态：CLI 主体已实现，本文保留调研与设计决策；功能和验证事实以当前代码、`code/AGENTS.md`、`public/llms.txt` 及文末实施记录为准。未完成项和未验证项单独标明。

## 目标与结论

当前可用入口：`fount run code --cli [--session <id>] [--prompt <text>]` 启动交互 TUI；`--print` 强制一次性纯文本输出，并要求 prompt 或 `--attach`。指定 `--prompt` 而不带 CLI 开关仍走原网页路径。CLI 的选项和会话 ID 工作区作用域见下方实际用法。

为 `fount run code` 增加显式终端入口，默认仍打开网页。CLI 与网页共享用户、工作区、会话文件、角色和生成后端，覆盖文件编辑器以外的 code shell 能力。提供交互终端与一次性纯文本输出两种界面。

推荐扩展 ArgumentsHandler 的返回值，使任意 part 都可以请求发起 IPC 的调用方执行本地客户端模块。code 自己解析 --cli/--print 并返回执行描述符；调用方通过通用返回值分派器加载 mjs，复用已有 HTTP/WS。AI 生成和工具执行仍在已有 fount 服务进程内。不要在后台 `ArgumentsHandler` 中读取 stdin 或绘制终端，也不要另建一套 agent loop / 会话存储。通用启动链不出现 `partpath === 'shells/code'` 分支。

这里排除的是用户操作的文件编辑器，并不禁用 agent 的文件操作工具。文件引用、读取、附件、变更摘要与只读 diff 仍属于 CLI 范围。消息编辑也保留。

## 调研证据

| 当前能力 | 代码与结论 |
| --- | --- |
| CLI 分派 | `path/src/index.{ps1,sh}` 未发现专用 run 命令文件；当前回落 `cmd/default` → `path/src/run.{ps1,sh}` → `src/server/index.mjs` |
| 用户与 IPC | `src/server/index.mjs` 将 run/runas 解析为 runpart；run 在初始化后选最后活跃用户，runas 显式指定；`src/server/ipc_server/index.mjs` 用虚拟 console 包装 handler，返回 result/outputs |
| 网页入口 | `shells/code/main.mjs` 目前只解析 prompt/workspace，注册 cwd 工作区并用 `npm:open` 打开页面；prompt 可以通过 open-claim 交给现有页面 |
| 生成 | `code/src/endpoints.mjs` 的 session WS 支持 send/regen/trigger/attach/abort/typing；run-start、preview、entries-append、tool-output、done/aborted/error 均可供客户端使用 |
| 会话权威性 | 后端运行开始写占位、每轮与终态落盘；终态在落盘后广播；关闭 socket 只解除观察，不中止运行 |
| 多客户端 | `code/src/runs.mjs` 与 endpoints 的 sockets 集合支持网页和 CLI 同时观察；attach 向新连接回放权威条目、最近工具输出和当前 preview |
| 运行身份 | 每帧带 sessionId/runId；CLI 默认提交以 `replace: false` 原子拒绝忙会话，并以 `expectedVersion` 防止过期副本覆盖 |
| 设置与其他能力 | HTTP 已有 machines/workspaces/sessions/profiles/commands/history/aisources/async-tasks/shutdown/retention；角色列表来自共享 getPartList 接口 |
| 模型语义 | 网页 pills 切换 `ai_source`，不是任意 provider/model；CLI 首版模型选择应对应已配置 AI source，并显示名称和可获得的模型信息 |
| 身份认证 | code 路由使用 authenticate；支持 API key、accessToken/refreshToken cookie。不能因 eval 可由本地终端访问就认为 code API 自动拥有最后活跃用户身份 |
| 终端经验 | `src/log_viewer/{interactive,keys,render,history}.mjs` 已处理输入、中文/IME、粘贴、终端绘制和历史，可抽取纯通用叶子；不能导入整个 log viewer 或其 eval 状态 |
| 测试基础 | code 有 pure/integration/frontend 套件及慢角色、多轮、工具等 fixtures，现有 multi_socket / wake_append / reply_failure 测试可扩展 |

### 参考项目

- [OpenCode CLI](https://opencode.ai/docs/cli/) 与 [TUI](https://opencode.ai/docs/tui/)：采用会话选择、模型选择、斜杠命令，以及连接已有服务的终端客户端。适合借鉴 fount 的前后端分离形态。
- [Pi CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md) 与 [交互用法](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)：交互和 print 模式分离、非 TTY 自动选择 print、按 ID 恢复会话。Pi 的 print 主要输出最终 assistant 文本；fount 按本需求输出整轮日志。
- [Claude Code 非交互用法](https://code.claude.com/docs/en/headless)：借鉴 prompt 参数、会话续接和 stdout/stderr 分工。不要照搬其权限模型或后台任务退出规则。
- [Pi TUI 组件库](https://github.com/earendil-works/pi/blob/main/packages/tui/README.md)：有输入、Markdown、选择器和差量渲染组件，可作为终端底层候选；Deno/Windows/中文输入兼容性尚未实测。

### 鼠标 TUI 库补充调研

这里的目标是带组件树、鼠标命中和浮层的终端应用，而不只是带颜色的逐行聊天。界面内的模型区域可点击，并直接打开可搜索、可鼠标选择的面板；角色、会话、profile、工具展开也采用相同交互。

| 候选 | 源码/文档证据 | 对 fount 的判断 |
| --- | --- | --- |
| OpenTUI core | [官方仓库](https://github.com/anomalyco/opentui/) 表明 OpenCode 使用它，底层为 Zig；[package.json](https://github.com/anomalyco/opentui/blob/main/packages/core/package.json) 包含平台原生包与 Bun/Node 路径 | 最接近目标体验；只用 core 可省 React/Solid，但不等于轻量纯 JS，Deno 尚未验证。保留为对比候选，不额外引入运行时只为 TUI |
| Pi TUI | [文档](https://github.com/earendil-works/pi/blob/main/packages/tui/README.md) 提供 alternate screen 的鼠标事件、命中测试、浮层和选择器；[依赖声明](https://github.com/earendil-works/pi/blob/main/packages/tui/package.json) 当前只有两个直接运行依赖，同时发布各平台原生模块 | 当前优先验证对象，只使用 TUI 层。不能称为无原生依赖；导入、Windows VT 输入与 Deno 适配都要验证 |
| neo-blessed | [项目文档](https://github.com/Rich-Harris/neo-blessed) 提供高层 widgets 和鼠标，但明确记录 Windows mouse/resize 不支持的限制 | 与本项目主要 Windows 使用场景不匹配，不作为首选；不能用组件多来替代目标终端实测 |
| 扩展现有 log_viewer | 已有输入和终端绘制；还需自行建立鼠标事件、组件布局/命中、浮层、焦点与选择 | 可复用经验和小叶子，但完整补齐会变成维护一个 UI 框架；两库都不适合时采用，自研范围限定为所需组件与终端内核，不降低鼠标交互目标 |

“轻量”按新增运行时、原生构件、依赖树、下载体积、启动耗时与闲置 CPU 衡量，不能只看顶层包数量。首选验证 Pi TUI 的 alternate-screen renderer，OpenTUI core 作对照。若两库在 Deno/Windows 兼容、体积或 API 上均不适合，则自行实现终端组件层，复用现有 log_viewer 的纯叶子与协议经验；不勉强引入额外运行时。自研需要差量绘制、宽字符布局、SGR 鼠标解析与命中、焦点/浮层、滚动/选择、IME/粘贴和手势动画。TUI 依赖延迟导入，print 与默认网页路径不加载渲染库；不引入完整 Pi/OpenCode agent，也不为动画加入图形/3D 渲染栈。

标题动画在 TUI 内容区域绘制，不是操作系统终端标题栏：鼠标按下可播放短动画，按住达到阈值进入持续动画，释放/拖离/失焦取消；这是应用手势状态机，无需终端原生长按事件。按需重绘、闲置零动画计时器，动画期间限制帧率（初始目标 20–30 fps，实际以终端验证为准），支持关闭动画。鼠标组件需要 press/release/move/capture，不能只有 click 回调。

当前实现中 fullscreen 使用 alternate screen；regular 在主缓冲区使用同一全屏绘制器，不保证保留原生 scrollback。终端不支持鼠标时仍可使用键盘入口；终端兼容性以实际环境为准。

## 命令行用法（已实现）

```sh
fount run code                                      # 保持打开网页
fount run code --prompt "检查这个项目"                 # 保持现有网页行为
fount run code --cli                                # 交互终端
fount run code --cli --session abc123 --prompt "继续"
fount run code --cli --prompt "检查测试" > turn.log    # 自动一次性文本模式
fount run code --cli --print --session abc123 --prompt "继续检查"
fount runas alice code --cli --workspace ./project --char coder --model my-source
```

| 参数 | 当前语义 |
| --- | --- |
| `--cli` | 请求交互终端；stdin/stdout 任一不是 TTY 时自动使用 print 模式 |
| `--print` | 强制一次性纯文本模式，即使终端支持交互也不启动 TUI |
| `--session <id>` / `-s` | 在所选工作区打开或新建指定会话；省略时创建新会话。ID 格式为 1–64 个字母、数字、下划线或连字符 |
| `--prompt <text>` / `-p` | 在交互模式发送初始消息，或在 print 模式发起本轮生成；支持 `--prompt=value` |
| `--prompt-file <path>` | 从文件读取提示词；`-` 明确表示读取 stdin。与 `--prompt` 互斥 |
| `--workspace <path>` / `-w`、`--workspace-id <id>` | 指定路径或已保存工作区，两者互斥 |
| `--char <name>`、`--model <name>` / `--ai-source <name>`、`--profile <name>` | 选择角色、AI source 或 profile |
| `--attach` | 观察指定会话当前运行，不发送提示词；需要 `--session` |
| `--tui-mode fullscreen\|regular` | 选择终端呈现方式，默认 fullscreen |
| `--help` | 打印 CLI 帮助，不启动浏览器或生成 |

print 模式缺少 prompt / prompt-file 且不是 attach 时返回用法错误。管道输入需明确使用 `--prompt-file -`。

配置优先级：显式参数 > 已载入会话值 > 新会话工作区配置 > CLI 用户偏好 > 后端默认。新会话没有可用角色时交互显示选择器，print 在发起生成前报错。CLI 偏好和按工作区/sessionId 隔离的输入草稿保存于独立 shell data；不覆盖网页 localStorage，也不将 CLI 草稿塞入网页标签列表。

会话文件与草稿按工作区隔离；活跃运行注册仍按用户名与 sessionId 串行，因此跨工作区复用同一 ID 会竞争。CLI 的 attach/abort 同时校验工作区和 runId，事件也按目标过滤。跨工作区列表选择项携带 workspaceId，切换时同时切换目标机器和路径。不能按 ID 盲目猜另一个工作区。

## 交互界面及功能覆盖

采用全屏应用滚动消息区、底部多行输入、可点击状态区域；状态区显示用户、工作区/机器、会话、角色、AI source、profile、运行/连接状态。点击模型/角色/会话/profile 直接打开面板，选择行支持悬停、点击和滚轮。支持搜索选择器、键盘导航、粘贴、多行、输入历史、宽度变化、中文和 emoji。工具块默认摘要，点击可展开正文。标题有点击/按住动画反馈。regular 模式使用主缓冲区绘制，但不保证保留原生终端历史；可通过导出保存文本记录。

浮层弹出时捕获键盘焦点，关闭后恢复输入框及草稿；鼠标命中使用最后一帧布局，包含浮层层级、遮挡、裁剪和滚动偏移。对话滚动离开底部时停止自动跟随，提供可点击的回到底部提示。鼠标拖选文本与工具卡片点击不能互相误触；支持终端惯用的绕过鼠标捕获方式，并在帮助中说明实际终端行为。

| 能力 | CLI 接入 |
| --- | --- |
| 新建、列表、切换、重命名、删除会话 | `/new`、`/sessions`、`/session <id>`、`/rename`、`/delete`；列表可筛工作区/全局，删除明确指定对象 |
| 角色与 AI source | `/chars`、`/char`、`/models`、`/model`；source 隐藏/显示管理，角色自带源可选；有效值由服务端提供 |
| profile / 自定义命令 | `/profile`、`/commands`、自定义斜杠命令与参数输入；复用 profiles / commands/render，不自行重写模板规则 |
| 工作区与机器 | `/workspaces`、`/workspace`、`/machines`；工作区增删改、远程选择、目录浏览/搜索；保持执行目标可见 |
| 正常聊天 | 实时 preview，按顺序展示已完成角色轮次、工具、系统通知、错误；保留正在编辑的下一条草稿 |
| 观察工具和子代理 | start/chunk/end 的临时输出；工具摘要、成功/失败；异步任务、子代理状态与只读详情；合并全局事件，必要时按 chatId 刷新查询 |
| 停止、恢复、重试 | `/stop`、`/attach`、`/retry`、`/regen`；复用 session run 身份和现有重试截断语义 |
| 用户 shell 执行 | `!命令`、`/shell` 选择目标 shell；用 exec WS 流式输出，并将结果和 elapsedMs 按现有语义写进会话 |
| 附件与引用 | `/attach-file`、附件列表/移除、文件路径和 gist 引用补全；复用 files 格式、AGENTS 上下文和 gist 获取，不要求内置文件编辑器 |
| 消息操作 | 查看、编辑、反馈、复制文本、保存 gist、导出文本/HTML；输入界面编辑消息，不启动额外 OS 编辑器 |
| 变更摘要 | 读取 extension.pluginData 的现有 edit 摘要，显示文件和增删统计、只读 diff；不提供写文件 UI |
| 保留与清理 | `/retention`、`/cleanup`；非空网页草稿、CLI 草稿和运行中会话受保护 |
| 完成行为、电源操作 | 终端完成提示、后台会话未读标记；`/power` 查看/设置/取消既有电源动作；通知沿用服务端策略，防止多客户端重复提示 |
| 退出 | `/exit`、`/quit`、Ctrl+D；关闭 CLI 观察连接，后台生成按已有规则继续，给出恢复 ID |

Ctrl+C：正在生成时第一次发送携带 sessionId/runId 的 abort；空闲时清除当前输入，空输入时退出。停止等待再次 Ctrl+C 可直接解除观察退出；弹出选择器时 Ctrl+C 仍执行该流程；不关闭整个 fount。终端 raw mode、粘贴模式、光标与滚动区必须在退出/异常时恢复。

内建斜杠命令和用户模板冲突时内建优先，并提供 `/command <name>` 显式调用模板。隐藏工具正文只影响显示，不更改持久化日志。复制、HTML 导出等能力由终端可用性决定操作形式，但保留命令入口，不将其默默排除。

## 一次性文本输出契约

输出范围为本次请求所对应 run 的所有已提交 agent 日志：中间角色轮次、工具调用摘要及结果、系统通知、最终角色回复。默认不重复历史或输入的用户 prompt。每条使用稳定的角色/工具标题、按后端顺序排列，正文取 `content_for_show ?? content`，保留可读 Markdown，结构化卡片转换为文本。只输出服务端提供的展示内容，不尝试获取隐藏推理。

preview 是可替换快照，不能逐帧拼接；tool-output 分片可能随后以完整 tool 条目出现，不能两份都输出。print 首版收集 entries-append 与终态 entries，按 entry.id 去重，终态一次输出。临时工具分片用于交互显示；仅对无法产生正式条目的异常，作为明确标记的未提交输出保留，不伪装为权威 transcript。

- stdout：仅本轮文本，无 ANSI、logo、进度、启动信息和 JSON 元数据。
- stderr：sessionId、workspaceId、runId、连接诊断和错误；新会话 ID 在生成前给出，调用方可保留并续接。
- 退出码：0 成功且持久化完成；1 生成/连接/持久化失败；2 参数错误；130 用户中断。工具失败后 agent 正常完成不自动等同整轮失败。
- error / aborted：输出已提交的部分日志并返回非零；不能把占位或未完成 preview 冒充结果。
- 大日志：print collector 超过阈值使用临时文件暂存，按 entry ID 建索引，结束清理，避免无界内存增长。
- stdout 管道提前关闭：解除观察，按平台惯例返回非零；不自动中止服务端 agent。

“本轮”首版明确以一个 runId 的持久化终态为边界。完成后 13 秒 agentFinish 钩子可能另起 run，异步通知也可能唤醒后续 run；默认不无限等待这些运行。若需要一次调用等待整个工作流收敛，应另增有明确定义的 `--wait-idle`，而不是用延迟猜测完成。交互模式继续监听后续 run 并自动接入。

## 架构和必要改动

### ArgumentsHandler 返回调用方执行描述符

不新增 `interfaces.cli`，不增加 CLI capability / Prepare IPC 命令，也不让 run/runas 解析 `--cli`、`--print` 或维护 part 白名单。沿用现有 runpart：服务端 loadPart 后调用 ArgumentsHandler，并通过 IPC 返回 `{ result, outputs }`；调用方在输出 result 之前，识别新增的、带 type 的结果类型。

code ArgumentsHandler 自己解析参数：无终端开关保持打开网页；`--cli` / `--print` 则准备用户与工作区数据，返回客户端执行对象。其他 part 可以在任意自己定义的参数或条件下返回同一类型，不必也使用 --cli。

返回值统一采用带 type 的对象，不增加 version；run-js 为执行模块指令，output 为输出指令：

```js
// ArgumentsHandler 的一种返回值；所有字段都可通过 JSON 序列化
return {
  type: 'run-js',
  module: 'cli/main.mjs', // 相对当前被 loader 选中的 part 根目录
  args: ['--cli', /* 要交给客户端的参数 */],
  data: { /* 用户、工作区及短期认证等准备数据 */ },
}
```

调用方将此对象解析为已安装模块的绝对 file URL，并在当前调用进程中 `await import(...)`，调用模块导出的 `Run(context)`。这里“执行命令”具体定义为执行 mjs 导出入口，不构造 shell 命令字符串，也不新增子进程；保证 stdin、stdout、stderr 和终端控制仍归发起者所有。模块返回整数退出码，finally 清理监听和终端状态。接口核心只提供 args/data、流、cwd、TTY/尺寸信息、AbortSignal 与清理登记，不认识会话、模型、profile 或 agent 日志。

```js
return { type: 'output', content: '要写到 stdout 的文本' }
```

`ArgumentsHandler` 返回类型改为 `void | OutputResult | RunJsResult`；字符串返回路径统一迁移成 output，不保留旧字符串兼容。void 继续展示虚拟 console outputs；output 将 content 写到 stdout，沿用缺少末尾换行时补一个换行的现有输出语义。调用方按 type 分派，不做协议版本协商，也不为本机可信 handler 结果再建立 schema 校验层。

沿用已加载 part 的实际根目录解析 module，复用 `GetPartPath` / `loadPart` 的用户安装覆盖顺序，不在调用方重新猜 public 路径。本机加载的 part 与 IPC 调用方互相信任，返回值直接按契约使用；远程节点若以后提供同类指令，在网络入口单独处理边界。描述符属于内部控制消息，不展示到 stdout 或 console，不将认证 data 混进虚拟 console 输出。

现有 `src/server/index.mjs` 的 runpart 响应处统一改为按 output/run-js 分派；那里接入通用 `dispatchArgumentsResult` 即可形成首个实现。若启动模块图/终端清理互相干扰，再把通用 IPC 调用与返回值分派抽到轻量前端入口；这是对所有 run/runas 的统一调整，不按 part 或 --cli 特判，也不预先要求新增专用 CLI host。客户端只加载独立 cli/main.mjs，不 import part 的服务端 main.mjs。

长运行必须先执行完成再到原来 `already_running` 的退出分支；模块退出码不能被原有 `process.exit(0)` 覆盖。冷启动时需要明确服务归属：一次性客户端退出不能连带关闭它所连接的后台服务；不能在当前进程刚启动服务后又无条件退出。沿用/调整通用启动流程解决这一点，保持所有 part 默认调用兼容。

IPC 描述符自身只需一次往返，TUI 开始后通过现有 HTTP/WS 进行持续业务通信；无需把 readline、鼠标事件或 AI 输出塞进目前的一问一答 IPC 协议。

框架测试采用至少两个无 code 依赖的 fixture part，以及返回 output/void 的 part；覆盖 runas、用户安装覆盖、模块路径解析、参数与退出码。CLI 选择及 TTY/print 自动切换属于 code 自身测试，不属于 run 层能力协商。

### 身份与启动

ArgumentsHandler 在服务端已获得 run/runas 解析后的用户，可直接准备短期身份及业务 data；调用方仅在内存传入模块。code 传输层以 cookie 认证 HTTP/WS，沿用 authenticate；不创建永久 API key，不使用 eval，不将整个 code API 改为 localhost 免认证。长会话续期可以复用 invokepart 的 IPCInvokeHandler，由 part 自己提供刷新操作；不重复调用会创建会话的初始 ArgumentsHandler。

`result` 和 `outputs` 在调用方分开处理：执行描述符不展示，启动诊断走 stderr；print 的 stdout 只容纳本轮日志。需要覆盖 path bootstrap、标题/任务栏序列、冷启动和 server/index 初始化输出的整个启动链。客户端不能读取完整 config 用户私有数据；已有短期 access token 是用户权限，不宣称它天然具有 part 级作用域。

同时抽出 `main.mjs` 的参数与 workspace 准备叶子，修正新工作区注册对 `saveShellData` 的使用：它没有 value 参数，首次 load 返回空对象时要通过 assignShellData 建立缓存后保存。该路径是 CLI 正确落盘的前置条件。

### 客户端层次

框架层只新增通用返回值类型与 `src/scripts/part_invoke_result.mjs` 分派器；IPC 客户端叶子仅在需要时抽取；可复用的 TUI 组件/终端适配器按需放共享 CLI UI 目录，不把 code 业务放进核心。code 接入新增 `code/cli/{main,args,transport,client,commands,transcript,tui}.mjs`：

- args：code 专有参数解析，共享网页相关解析语义；服务端决定是否返回执行对象，客户端按 TTY 决定 tui/print。
- transport：具名 HTTP/WS 方法、bootstrap、认证、重连；不复用依赖浏览器 URL/DOM 的 public/src 模块。
- client：按会话划分 runtime、runId 路由、权威条目归并、草稿、发送/观察/停止/恢复；print 与 TUI 共用。
- commands：内建动作与模板命令 dispatch；UI 不直接拼 API 路径。
- transcript：展示层字段选择、结构化扩展转文本、去重、print 暂存和导出。
- tui：输入、选择器、Markdown/工具区域和状态显示；通过终端适配器隔离具体组件库。

浏览器与 CLI 共用的纯会话工厂、条目归并、模型选择和消息操作规则可提取到 `code/public/shared/`；不能直接导入带 DOM/localStorage 或浏览器绝对路径的 session/submission/messages。仅提取确实重复的规则，不为 CLI 全面重写网页。

### 后端协议补齐

1. 新增默认非取代的提交选项并在 startCodeRun 原子检查：会话忙时返回明确 busy，避免 CLI 无意中止网页生成；仅显式 replace 行为允许沿用 supersede。只在客户端先 GET 检查会有竞态。
2. 已实现：attach 只向新连接回放 run-start、权威条目、最近工具输出与当前 preview。
3. 所有 CLI 可等待的启动失败必须返回带关联 ID 的终态错误，包括服务正在停止、角色无效、准备工作区或开始落盘失败；仅 console.error 会让客户端永久等待。
4. 已实现：CLI 在发送前刷新会话并带 expectedVersion；版本冲突与 busy 分开报告，旧副本不会覆盖较新的落盘版本。
5. 已实现：CLI 草稿按 workspaceId/sessionId 持久化，非空草稿纳入 retention 保护。
6. 已实现：全局事件订阅复用用户事件服务，交互 CLI 可观察无 socket 启动的运行与追加条目；流连接意外断开时按同一 runId 尝试一次 attach，不重复发送 prompt。无法确认终态时返回非零及 sessionId/runId，只输出已确认属于该轮的条目。

## 实施阶段与验收

1. **通用返回值分派与终端验证**：以独立 fixture parts 验证 ArgumentsHandler 执行对象和调用方模块运行；验证 PS/sh/编译 fount.exe 的参数、stdin、TTY、stdout 分离及冷启动、IPC 凭据和重连。并用候选库制作模型点击面板与标题按住动画的交互原型，测中文 IME、拖选、滚轮、resize、焦点恢复及 Deno/Windows 兼容。记录依赖体积/冷启动/闲置 CPU 后决定终端库；两库都不合适则按相同交互验收自研轻量内核。此阶段无需真实 AI。
2. **共享客户端与 print**：会话载入/新建、角色/source/profile、send、日志聚合、退出码；补齐 busy、失败回帧、版本冲突。使用 fixtures 验证整轮日志再进入真实角色测试。
3. **交互主体**：输入与历史、流式文本/工具、会话/模型/角色选择、后台运行和 attach/abort；网页与 CLI 同时观察同一运行。
4. **其余非编辑功能**：按覆盖表完成 workspace/remote、shell、模板、附件/gist、任务详情、消息操作、导出、变更摘要、保留及电源动作。不能将第三阶段核心聊天可用当作全功能完成。
5. **回归与文档**：中文终端文本经 locale 体系，locale JSON 只用 Python 修改；更新 CLI 帮助、code AGENTS 与 llms API 使用说明。定向执行 fount test，保持网页默认行为。

关键自动化验收：

- 无开关打开网页，原 prompt/workspace 行为不变；runas 与所有等价 partpath 一致；空值、引号、Unicode、多行参数在两个平台原样到达。
- 非 TTY 不读取键盘；print stdout 无控制序列/启动噪声，stderr 有会话 ID；省略 ID 新建、给定不存在 ID 新建、同 ID 第二次续接且不重复输入。
- 多轮、并行工具、失败工具、异步系统条目：顺序与权威日志一致；preview 快照/工具实时输出/attach replay 不重复；最后回复之外的日志完整。
- busy 不取代网页运行；切换会话不串流；旧 abort 不停止新 run；断线重连不重复发送 prompt，attach 或读取落盘恢复；服务重启下 resume 保持一致。
- 角色异常、启动失败、持久化失败、Ctrl+C、stdout 关闭均明确收尾；失效 ID 和读取失败不被吞成新会话。
- 终端组件纯测试覆盖键盘/粘贴/宽字符、选择器、状态转换和退出清理；PTTY/实际 Windows Terminal 与 Linux/macOS 终端验证输入和 resize，不能用 DOM shim 测 CLI。
- 鼠标验收覆盖点击模型打开浮层、搜索/滚轮/选择、关闭还原输入，角色/profile/会话同样可点；工具展开、拖选文本、滚动偏移后的命中、浮层遮挡不误触。标题 press/hold/release 动画正确取消，停止后无计时器和鼠标模式泄漏，闲置时不持续绘制。
- 通用 run/runas 验收覆盖非 shell part、用户自装 part、output/void/run-js 返回值、module 路径解析、handler/模块失败及非零退出码；分派器不引用 code shell，不识别 --cli。
- 既有 endpoints / multi_socket / wake_append / reply_failure / entry-extension 回归，网页 frontend 的 session_runtime / stream_render / open_prompt 定向回归。按 manifest 实际套件名运行，不全仓测试。

## 当前实施记录

最后核对：2026-10-07。定向验证包括 12 项 CLI pure、9 项 TUI pure、3 项命令 pure、`multi_socket` integration 10 个步骤、附件 endpoint integration、retention 筛选及 `server:pure` 47 项；改动文件 ESLint 通过。

首版已经接入通用 ArgumentsHandler 返回结果分派：`output` 写入 stdout；`run-js` 按被加载 part 的根目录解析模块并在调用进程执行其 `Run(context)`，未加入版本字段。code 的 CLI 客户端复用既有 HTTP/WS 和会话服务。默认网页入口仍保留。`fount run` / `runas` 现在由 path CLI 先确保后台实例在运行（`Test-FountRunning` / `test_fount_running`，最多等 60 秒），命令型进程只走 IPC 分派、不再顺带 `init()`；无实例时的 `ECONNREFUSED` 仍回到 `fountConsole.ipc.noInstanceRunning` 诊断。

复核时收紧的边界：`DEFAULT_IPC_PORT` 只留在 `src/scripts/part_invoke_result.mjs`（`ipc_server` 再导出），不再在 CLI 里重复字面量，调用方总是把真实端口通过 `Run(context).ipcPort` 传下去；分派器只提供 `AbortSignal`，第二次中断由模块自己处理（print / TUI 依序停止、清空、退出），分派器不再抢装第二个 SIGINT 处理器；`ArgumentsHandler` 在工作区准备阶段拒绝参数时用 `data.usageError` 把用法错误交给 CLI 按 CLI 规则打印（退出码 2），CLI 仍自行解析参数决定退出码；TUI 与 print 共用 `transcript.mjs` 的条目格式化叶子（`entryName` / `entryText` / `formatEntry`），用户消息与生成中占位不进 transcript。

后端协议补齐的落地情况：会话忙时 `send` 默认返回 `code: 'busy'`（只有显式 `replace: true` 才取代旧运行，测试见 `multi_socket.test.mjs` 的 `scenarioCliBusyAndVersion`）；带 `expectedVersion` 的提交在版本不匹配时返回 `code: 'version-conflict'`；`attach` 只向新接入连接回放 `run-start`、权威条目、最近的 `tool-output` 分片与当前 `preview`，不再广播式扰动其它观察者；服务正在停止、准备工作区或落盘失败都会回带 `runId` / `sessionId` 的终态错误帧；会话写入返回自增 `version`（`sessions.mjs` 的 `loadSession` 只把 ENOENT 当“无会话”，其它读失败照常抛出）。

版本校验的两个必须保持的细节：`PUT /sessions/:id` 在磁盘上还没有该文件时按**创建**处理（网页把草稿标签转成会话、`!` 结果写回都只走 PUT，返回 404 会让新会话永不落盘；`shells/code:frontend` 的 `tabs.spec.mjs` 就是这条路径的回归），只有传真 `expectedVersion` 且与磁盘版本不符才 409；WS 落盘的新版本取「磁盘版本 vs 客户端副本」的较大者再自增，避免网页的过期副本把版本写回退。

网页前端 a11y：`shells/code:frontend` 88 项全绿。修掉的三类 `label-content-name-mismatch` 是「aria-label 里没有可见文本」——上下文 chip 拼上工作区/角色名、会话标签的首字母改成 CSS 生成内容（axe 会把 `aria-hidden` 的文本仍算作可见文本）、消息附件 chip 的 label 带上文件名与大小；含用户数据的 label 同时标 `user-content="aria-label"` 跳过语种扫描。经验记在 `shells/code/AGENTS.md` 的 a11y 条目。

已实现命令包括 `/new`、`/sessions [all]`、`/session`、`/rename`、`/delete`、`/chars`、`/char`、`/models`、`/model`、`/profile`、`/commands`、`/command`、`/workspaces`、`/workspace`、`/workspace-add|rename|delete`、`/machines`、`/browse`、`/search`、`/file`、`/shell`、附件操作、`/send`、`/tasks`、`/subagents`、`/stop`、`/attach`、`/retry`、`/regen`、消息操作、`/export [--html]`、`/diff [path]`、`/retention`、`/cleanup`、`/power`、`/exit`，以及 `!<command>`。具体参数和运行语义应以 CLI 帮助、代码为准。

交互客户端订阅用户事件总线（`transport.events` → `client.subscribeServerEvents`，按 `code-<sessionId>` 过滤）：`code-run-started` 让 CLI 接入不是自己发起的运行（后台唤醒、钩子重生成、任务恢复），`code-session-entry` 合并运行外追加的条目，`code-run-settled` 按 `runId` 响一次终端提示音并在空闲时刷新会话。`--attach` 走同一条路径，因此接入后会继续跟随后续运行。`/diff` 输出 `extension.pluginData['file-operations'].edit` 的累计统计（给出路径时附只读 diff），`/export --html` 写出无 CDN 依赖的独立文档（`cli/export_html.mjs` 延迟加载 `marked`，转义原文 HTML）。

TUI 已实现键盘输入、选择器、鼠标交互、工具展开、消息滚动、标题按压动画及清理路径。`fount run code --cli` 在 stdin/stdout 任一非 TTY 时回落 print；print 尊重调用方传入的 `isTTY`，stdout 管道提前关闭按 EPIPE 记 `pipeClosed` 并返回 1，不再抛未捕获流错误。

2026-10-07 本轮定向验证：CLI pure 12 项（含精确 run 重连、stdin UTF-8、关闭管道与 SIGINT 清理）、TUI pure 9 项、命令 pure 3 项、`multi_socket` integration 10 个步骤（含 print 入口、并发 busy 与跨工作区 target）、附件 endpoint integration、retention 筛选和 `server:pure` 47 项通过；改动文件 ESLint 通过。Windows IME、OSC52 及真实终端兼容性未人工验证。

仍未验证或未实现：没有人工验证 Windows 终端中文 IME 与 OSC52 剪贴板；regular 模式不保证 native scrollback，终端输入和鼠标兼容性未在各平台逐项实测。远程工作区、版本冲突提示和断线恢复的边界场景尚未逐项人工核对；`/export --html` 是精简的自包含文档（不含 KaTeX/Shiki/CDN 资源与附件内联之外的网页版特性），与浏览器下载的完整文档不等价。上文中的架构目标、完整覆盖表和验收项仍是后续工作计划，不是当前功能承诺。
