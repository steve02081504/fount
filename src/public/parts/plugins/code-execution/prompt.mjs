import { getPluginOwnerPrompt } from '../../../../scripts/plugin_context.mjs'
import { SHELL_DEFAULT_TIMEOUT_MS } from '../../../../scripts/shell_guard.mjs'
import { getConnectedSubfounts } from '../../shells/subfounts/src/api.mjs'
import { getAsyncTaskPrompt } from '../async-task/prompt.mjs'
import { isAsyncToolingEnabled } from '../async-task/registry.mjs'

import { isShellUsable, pickDefaultShell, registeredShellNames, resolveAvailableShells, resolveDefaultShell } from './availability.mjs'

/**
 * 代码执行插件的 GetPrompt：向角色提示中注入代码执行能力说明。
 *
 * 与 `getCodeExecutionReplyHandlers` 共用同一套目标机器可用性判断，保证提示词里出现的
 * 每个 shell 标签都确实有处理器认领，避免标签原样穿透到消息里。
 * @param {import('../../../../../src/decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @param {object} [options] - 选项。
 * @param {(args: object) => Promise<string[]>} [options.resolveShells] - 覆盖可用 shell 解析函数（测试注入）。
 * @param {(args: object) => Promise<string>} [options.resolveDefault] - 覆盖默认 shell 解析函数。
 * @returns {Promise<import('../../../../../src/decl/prompt_struct.ts').single_part_prompt_t>} 单段 prompt。
 */
export async function getCodeExecutionPrompt(args, { resolveShells = resolveAvailableShells, resolveDefault = resolveDefaultShell } = {}) {
	const shells = await resolveShells(args)
	const availableShells = registeredShellNames().filter(name => isShellUsable(name, shells))
	const defaultShell = pickDefaultShell(availableShells, await resolveDefault(args))
	const hasPowerShellFamily = availableShells.some(name => name === 'pwsh' || name === 'powershell')

	// 从其他插件获取 JS 代码提示（排除自己以避免无限递归）
	const codePluginPrompts = (
		await Promise.all(
			Object.values(args.plugins || {}).map(plugin =>
				plugin.interfaces?.code_execution?.GetJSCodePrompt?.(args)
			)
		)
	).filter(Boolean).join('\n')

	const prompt = `\
${await getPluginOwnerPrompt(args, 'code-execution')}
你可以运行js或${availableShells.join('、')}代码，通过返回以下格式来触发执行并获取结果：
<run-js>code</run-js>
或
<run-${defaultShell}>code</run-${defaultShell}>
${shells.includes('pwsh') && shells.includes('powershell') ? `**注意：<run-powershell> 调用 Windows PowerShell，<run-pwsh> 调用已安装的 PowerShell Core，二者不同。**
` : shells.includes('powershell') ? `**注意：<run-powershell> 调用 Windows PowerShell，<run-pwsh> 在未安装 PowerShell Core 时回退到它。**
` : ''}如：
<run-js>(await import('npm:robotjs')).getScreenSize()</run-js>
你还可以使用<inline-js>来运行js代码，返回结果会作为string直接插入到消息中。
对于${defaultShell}，你也可以使用<inline-${defaultShell}>来达到同样的效果。
如：[
${args.UserCharname}: 一字不差地输出10^308的数值。
${args.Charname}: 1<inline-js>'0'.repeat(308)</inline-js>
${args.UserCharname}: 反向输出\`never gonna give you up\`。
${args.Charname}: 好哒，<inline-js>'never gonna give you up'.split('').reverse().join('')</inline-js>！
${hasPowerShellFamily ? `\
${args.UserCharname}: 我系统盘是哪个？
${args.Charname}: 是<inline-${defaultShell}>$env:SystemDrive</inline-${defaultShell}>。
` : availableShells.includes('bash') ? `\
${args.UserCharname}: 我家目录在哪？
${args.Charname}: 在<inline-bash>echo $HOME</inline-bash>。
` : availableShells.includes('sh') ? `\
${args.UserCharname}: 我家目录在哪？
${args.Charname}: 在<inline-sh>echo $HOME</inline-sh>。
` : ''}\
${args.UserCharname}: 用英语从0数到200，完整，不允许省略，放在代码块里。
${args.Charname}: 好的：
\`\`\`
<inline-js>
function toEnglishWord(n) {
	//...
}
return Array.from({ length: 201 }, (_, i) => toEnglishWord(i)).join(', ')
</inline-js>
\`\`\`
这样可以吗？
]
运行限制（所有 <run-*> 标签均支持）：
参数：
- 超时：默认 ${Math.round(SHELL_DEFAULT_TIMEOUT_MS / 60000)} 分钟；expect="时长" + tolerance="时长" 生效（只给 tolerance 时基于默认值累加）；wait="forever" 干等不超时。时长支持 30s / 5m / 1h 或纯秒数，如 <run-${defaultShell} expect="5m" tolerance="1m">。达到等待时限后，自动将同一次执行转为异步后台任务（不会停止或重新执行），回执会给出已等待时长、任务 id、查看进展及等待结果的方法。
- 目标：machine="机器id"、workdir="目录" 单次覆盖，未指定时用当前目标。
- 返回：<run-js> 给 \`output\`（console 文本）+ \`result\`（返回值），出错时为 \`output\` + \`error\`；正常结束会标注耗时。
- 大输出：连续的相似行会折叠；压缩后仍超限时只保留头尾，完整内容写入临时文件并给出路径，可用 <view-file> 分页 / <grep> 搜索。
使用约定：
- 一次回复里的多个工具调用按顺序执行；若其中某个调用失败，后续调用会被自动跳过。
- 简单问题用 <inline-js> 并优先用大数类型；复杂数学用 <run-js>；操作电脑/查看文件/更改设置/播放音乐用 <run-${defaultShell}>。
${getConnectedSubfounts(args.username).length === 1 ? `\
- 用户对接其他 subfount 后，你也可以在其他机器上运行代码。
` : `\
- 需要在其他机器上执行时，先用 <list-machines> 查询目标id。
- 远程机器上的js代码没有workspace/chat_log/callback等本地上下文，需要这些能力时请在本机执行。
`}
- 尽量不要直接删除文件/文件夹，作为替代，考虑移动到回收站。
  * 尤其软件文件夹很可能有用户数据在其中，删除前至少通过命令检查下文件夹架构。
- 覆写数据时也一样，在用程序删除部分数据或覆写可能的重要文件时考虑进行原文件的备份，以防误操作。

异步执行：
- 给 <run-js> / <run-${defaultShell}> 等加 async="true" 可后台运行；任务列表与等待（<list-async/>、<await-async>）见 async-task 插件说明。
- 注意：JS 在进程内无法强制终止，异步执行也不会改变这一点。

屏幕观察：<wait-screen seconds="2" monitor="0" machine="0"/> 等待后获取目标机器的屏幕附件，仅供你查看。也可用 <wait-screen>2</wait-screen>。seconds 默认 0，范围 0–3600；monitor 是从 0 开始的屏幕序号；machine 未给时继承当前目标。目标必须有可用显示会话。

js代码相关：
- 复杂情况下，考虑有什么npm包可以满足你的需求，参照例子使用<run-js>+import。
  * 导入包需要符合deno的包名规范（追加\`npm|node|jsr:\`前缀），如\`npm:mathjs\`或\`node:fs\`。
- 鼓励你在复杂情况下用workspace变量来存储工作数据，便于后续使用。
  * \`workspace.data = ...\` 会跨 <run-js> 和 <inline-js> 调用保留；开始新任务时可用 \`workspace.clear()\` 清空。
- JS 在 fount 进程内运行，\`process.cwd()\` 是 fount 进程自身的工作目录，可能与 shell 的 workdir 不一致，且无法按请求切换（切换会影响整个进程）。需要操作工作区文件时，用本机执行时提供的绝对路径变量 \`workdir\` 自行拼路径，如 \`(await import('node:path')).join(workdir, 'deno.json')\`；\`view_files\`/\`add_files\` 的相对路径同样按进程 cwd 解析，请传绝对路径。
${args.supported_functions?.add_message ? `\
- 长任务可不用 await，改用 \`callback(reason: string, promise: Promise)\` 在异步完成后反馈，如 <run-js>callback('unzip result', super_slow_async_function())</run-js>。
  * callback 是异步的，你无法在 <run-js> 的当场看到 callback 结果。
`: ''}\
- 你可以通过chat_log访问对话记录来获取/操作你无法直接查看的文件，其结构如下：
{
	name: string;
	role: 'system' | 'user' | 'char' | 'tool';
	content: string;
	files: { name: string; mime_type: string; buffer: global.Buffer<ArrayBufferLike>; description?: string; }[];
}[]
如：[
${args.UserCharname}: 帮我把这个zip文件解压到D盘
（附件：a.zip）
${args.Charname}: <run-js>
const zip_buffer = chat_log.findLast(entry => entry.files?.length).files[0].buffer
// ...
</run-js>
]
- \`await view_files(file1, file2, ...)\` 只让你查看，不发送给用户；参数可为本地路径、URL 或 \`{ name, mime_type, buffer, description? }\`。
${args.supported_functions?.files ? `\
- \`await add_files(file1, file2, ...)\` 用相同格式把文件发送给用户；例如 \`await add_files('~/Desktop/report.pdf')\`。仅需自己查看截图等内容时用 \`view_files\`。
`: ''}
${codePluginPrompts}
执行代码后若没得到想要的结果，鼓励反思原因并给出不同的解决方案。
已有成功运行结果时不要返回以上格式（如<run-js>...</run-js>），那会陷入死循环。
系统输出不会显示在回复中，需要你总结。
鼓励在回答输出较多时用<inline-js>以避免大段复述。
**只是解释说明或举例时使用普通代码块（如\`\`\`js）而不是执行代码。**
需要注意的是run-js执行的是后端代码而不是前端代码，若需要执行前端代码请使用浏览器相关插件${args.supported_functions?.unsafe_html ? '或直接输出script标签' : ''}。
`

	// async-task 插件没加载时，工具本身仍可用（生产者共用它的注册表），因此由 code-execution 补上工具说明与待注入通知。
	const asyncPrompt = isAsyncToolingEnabled() ? null : getAsyncTaskPrompt(args)
	return {
		text: [{ content: prompt, description: '代码执行能力说明', important: 0 }, ...asyncPrompt?.text ?? []],
		additional_chat_log: asyncPrompt?.additional_chat_log ?? [],
		extension: {},
	}
}
