import { inferCodeLanguageFromPath, renderMarkdownCodeBlock } from '../../shells/chat/src/streaming/index.mjs'
import { getConnectedSubfounts } from '../../shells/subfounts/src/api.mjs'

import { collectMentionedFiles } from './src/mentioned_files.mjs'
import { createArgsExecutorResolver, resolveTarget } from './src/target.mjs'

/** 预读扫描的最近聊天记录条数。 */
const PRELOAD_LOG_WINDOW = 6
/** 单次预读的文件数上限。 */
const PRELOAD_MAX_FILES = 5

/**
 * 预读对话中提及的、按当前工作目录可解析的本地文件，生成附加聊天日志条目。
 * @param {import('../../../../../src/decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @returns {Promise<import('../../../../../src/decl/chatLog.ts').chatLogEntry_t[]>} 附加日志条目。
 */
async function preloadMentionedFiles(args) {
	const target = resolveTarget(args)
	if (!target.workdir) return []
	const recent = (args.chat_log || [])
		.filter(entry => entry.role === 'user' || entry.role === 'char')
		.slice(-PRELOAD_LOG_WINDOW)
	const text = recent.map(entry => entry.content || '').join('\n')
	if (!text.trim()) return []

	const executor = createArgsExecutorResolver(args)()
	const { textFiles, binaryFiles, dirs } = await collectMentionedFiles(executor, text, { maxFiles: PRELOAD_MAX_FILES })
	const entries = []
	if (textFiles.length) {
		let content = '以下对话中提及的文件已按当前工作目录自动预读：\n'
		for (const file of textFiles)
			content += `文件：${file.path}\n${renderMarkdownCodeBlock(file.content, { lang: inferCodeLanguageFromPath(file.path) })}\n`
		entries.push({ name: 'file-operations.preload', role: 'tool', content, files: [] })
	}
	if (binaryFiles.length)
		entries.push({
			name: 'file-operations.preload',
			role: 'tool',
			content: `以下对话中提及的二进制文件已作为附件预读：\n${binaryFiles.map(file => `- ${file.name}`).join('\n')}\n`,
			files: binaryFiles,
		})
	for (const dir of dirs)
		entries.push({
			name: 'file-operations.preload',
			role: 'tool',
			content: `以下对话中提及的目录内容：\n目录：${dir.path}\n${dir.entries.map(name => `- ${name}`).join('\n')}\n`,
			files: [],
		})
	return entries
}

/**
 * 文件操作插件的 GetPrompt：向角色提示中注入文件操作能力说明。
 * @param {import('../../../../../src/decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @returns {Promise<import('../../../../../src/decl/prompt_struct.ts').single_part_prompt_t>} 单段 prompt。
 */
export async function getFileOperationsPrompt(args) {
	const prompt = `\
你可以操作文件系统，通过返回以下格式来触发文件操作：

**查看文件**：
<view-file offset="1" limit="2000" max-line-chars="2000" max-chars="50000">
文件路径1
文件路径2
...
</view-file>

- 大文件分页读取：\`offset\` 为起始行（默认 1），\`limit\` 为最多读取行数（默认 2000）
- 单行超过 \`max-line-chars\`（默认 2000 字符）会被截断；整体超过 \`max-chars\`（默认 50000 字符）会提前停止并提示续读
- 结果被截断时按提示用 \`offset\`/\`limit\` 续读；避免反复读取同样的小片段，编辑请用 <replace-file> 而不是重复查看
- 对话中提及的、能按当前工作目录解析的本地文件会被自动预读并注入，无需再次 <view-file>

**查找文件（glob）**：
<glob path="可选起始目录，默认当前工作目录">
**/*.mjs
**/*.ts
</glob>

- 每行一个 glob 模式（\`**\` 递归、\`*\` 通配、\`{a,b}\` 多选）；内容留空则列出起始目录下所有文件
- 返回相对起始目录的路径，最多 100 条；结果过多时用更精确的模式或更小的 path

**搜索文件内容（grep）**：
<grep path="可选起始目录" include="可选的文件名过滤，如 *.mjs，多个用空格分隔" mode="可选，填 files 时只列出命中的文件">
要搜索的正则表达式
</grep>

- 自动递归、遵守 .gitignore，使用 ripgrep 正则语法（不支持反向引用与环视）
- 返回按文件分组的行号与匹配行，最多 200 处；结果过多时用更精确的模式或 include
- 找文件用 <glob>、找代码用 <grep>，比用 shell 的 find/rg/Get-ChildItem 更省上下文

**替换文件内容**：
<replace-file>
<file path="文件路径">
<replacement>
<search>要搜索的内容</search>
<replace>替换为的内容</replace>
</replacement>
<replacement regex="true">
<search>正则表达式模式</search>
<replace>替换为的内容</replace>
</replacement>
<replacement replaceAll="true">
<search>会多处出现的固定文本</search>
<replace>替换为的内容</replace>
</replacement>
</file>
</replace-file>

- \`<search>\` 必须唯一命中：命中多处会被拒绝以避免误改，请补充上下文使其唯一；确需替换全部时使用 \`replaceAll="true"\`
- 忽略行尾空白的模糊匹配会自动兜底并在结果中标注匹配方式；\`regex="true"\` 时按你给的正则（\`$1\` 反向引用可用）
- 行尾（CRLF/LF）与 BOM 会自动保持，无需自行适配

**覆写文件**：
<override-file path="文件路径">
文件的新内容
</override-file>

- 覆写与原文差异超过 70%（或新内容为空）会被拒绝以避免误清空；确认整体重写时加 \`force="true"\`：\`<override-file path="..." force="true">\`

${getConnectedSubfounts(args.username).length !== 1 ? `\
**列出可用机器**：
<list-machines></list-machines>

- 所有标签都支持可选属性 machine="机器id" 以单次指定目标机器
- 需要操作其他机器时，先用 <list-machines> 查询目标id。
- 如：
[
${args.UserCharname}: 看看我办公室电脑上的桌面上的\`新建文本文件.txt\`。
${args.Charname}: <list-machines></list-machines>
file-operations: 可用机器列表：
\`\`\`json
[{id: 0, description: "localhost"}, {id: 1, description: "办公室电脑"}]
\`\`\`
${args.Charname}: <view-file machine="1">~/Desktop/新建文本文件.txt</view-file>
]` : `\
- 用户对接其他 subfount 后，你也可以操作其他机器里的数据。
`
}
**设置默认工作目录**：
<set-workdir machine="机器id" path="目录"></set-workdir>
- 该设置持续有效，影响任何操作机器内容的插件

**注意事项**：
- 文件路径可以是相对路径或绝对路径；相对路径基于当前的工作目录解析
- 使用 <replace-file> 时，可以指定多个 <replacement> 块；\`<search>\` 不能为空且默认须唯一命中
- 设置 regex="true" 可以使用正则表达式进行搜索替换
- 覆写文件的改动幅度过大（>70%）会被拒绝，确认整体重写时使用 force="true"
- 操作文件时请谨慎，避免误删除或覆盖重要文件
`

	const additional_chat_log = await preloadMentionedFiles(args).catch(err => {
		console.warn('预读对话提及文件失败：', err)
		return []
	})

	return {
		text: [{ content: prompt, description: '文件操作能力说明', important: 0 }],
		additional_chat_log,
		extension: {},
	}
}
