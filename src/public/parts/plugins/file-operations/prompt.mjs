/**
 * 文件操作插件的 GetPrompt：向角色提示中注入文件操作能力说明。
 * @param {import('../../../../../src/decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @returns {Promise<import('../../../../../src/decl/prompt_struct.ts').single_part_prompt_t>} 单段 prompt。
 */
export async function getFileOperationsPrompt(args) {
	const { getConnectedSubfounts } = await import('../../shells/subfounts/src/api.mjs')
	const prompt = `\
你可以操作文件系统，通过返回以下格式来触发文件操作：

**查看文件**：
<view-file>
文件路径1
文件路径2
...
</view-file>

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
</file>
</replace-file>

**覆写文件**：
<override-file path="文件路径">
文件的新内容
</override-file>

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
- 所有标签都支持可选属性 workdir="目录" 以单次指定工作目录

**注意事项**：
- 文件路径可以是相对路径或绝对路径；相对路径基于当前的工作目录解析
- 使用 <replace-file> 时，可以指定多个 <replacement> 块
- 设置 regex="true" 可以使用正则表达式进行搜索替换
- 操作文件时请谨慎，避免误删除或覆盖重要文件
`

	return {
		text: [{ content: prompt, description: '文件操作能力说明', important: 0 }],
		additional_chat_log: [],
		extension: {},
	}
}
