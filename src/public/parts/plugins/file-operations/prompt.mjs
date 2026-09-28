import { getConnectedSubfounts } from '../../shells/subfounts/src/api.mjs'

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
- 单行超过 \`max-line-chars\`（默认 2000）会被截断；整体超过 \`max-chars\`（默认 50000）会提前停止并提示续读；连续的相似行会折叠。
- 结果被截断时按提示用 \`offset\`/\`limit\` 续读；避免反复读取同样的小片段，编辑请用 <replace-file> 而不是重复查看
- 最新用户消息中提及的、能按当前工作目录解析的本地文件会被自动预读并注入，无需再次 <view-file>

**查找文件（glob）**：
<glob path="可选起始目录，默认当前工作目录">
**/*.mjs
**/*.ts
</glob>

- 每行一个 glob 模式（\`**\` 递归、\`*\` 通配、\`{a,b}\` 多选）；内容留空则列出起始目录下所有文件
- 多行取并集；含 / 的模式匹配相对起始目录的路径，裸文件名递归匹配同名文件；末尾 / 匹配目录（如 \`*/\` 列出一级目录，含空目录）
- 多模式中 0 命中的模式会在结果里单独提示，便于发现写法错误（如误写成相对仓库根的路径）
- 返回相对起始目录的路径，最多 100 条

**搜索文件内容（grep）**：
<grep path="可选起始目录" include="可选的文件名过滤，如 *.mjs，多个用空格分隔" mode="可选，填 files 时只列出命中的文件">
要搜索的正则表达式
</grep>

- 自动递归、遵守 .gitignore，使用 ripgrep 正则语法（不支持反向引用与环视）
- 返回按文件分组的行号与匹配行，最多 200 处
- 找文件用 <glob>、找代码用 <grep>，比用 shell 的 find/rg/Get-ChildItem 更省上下文
- 搜索结果过多时，请缩小 path 或收窄模式

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

- \`<search>\` 必须唯一命中：命中多处会被拒绝以避免误改。确认需替换全部时使用 \`replaceAll="true"\`
- \`<search>\` / \`<replace>\` 的正文是无需xml转义的字面量：行首、行尾的tab和空格、内部空行都会原样参与匹配与写入。正文若另起一行书写，只会去掉紧贴标签的首尾各一个换行。
- 忽略行尾空白的模糊匹配会自动兜底并在结果中标注匹配方式；\`regex="true"\` 时按你给的正则（\`$1\` 反向引用可用）
- 行尾（CRLF/LF）与 BOM 会自动保持，无需自行适配

**覆写文件**：
<override-file path="文件路径">
文件的新内容
</override-file>

- 覆写与原文差异超过 70%（或新内容为空）会被拒绝以避免误清空；确认整体重写时加 \`force="true"\`
- 正文是无需xml转义的字面量：行首、行尾的tab和空格；正文若另起一行书写，只会去掉紧贴标签的首尾各一个换行。

${getConnectedSubfounts(args.username).length !== 1 ? `\
**列出可用机器**：
<list-machines></list-machines>

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
文件读写与搜索标签支持 machine="机器id"、workdir="目录" 单次指定目标；相对路径基于目标工作目录解析。
**设置默认工作目录**：
<set-workdir machine="机器id" path="目录"></set-workdir>
- 该设置持续有效，影响任何操作机器内容的插件

**注意事项**：
- 操作文件时请谨慎，避免误删除或覆盖重要文件
`

	return {
		text: [{ content: prompt, description: '文件操作能力说明', important: 0 }],
		additional_chat_log: [],
		extension: {},
	}
}
