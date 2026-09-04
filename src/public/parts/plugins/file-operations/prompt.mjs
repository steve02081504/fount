/**
 * 文件操作插件的 GetPrompt：向角色提示中注入文件操作能力说明。
 * @param {import('../../../../../src/decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @returns {Promise<import('../../../../../src/decl/prompt_struct.ts').single_part_prompt_t>} 单段 prompt。
 */
export async function getFileOperationsPrompt(args) {
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

**列出可用机器**：
<list-machines></list-machines>

**注意事项**：
- 文件路径可以是相对路径或绝对路径；相对路径基于当前请求的默认工作目录（args.workdir）解析
- 所有标签都支持可选属性 machine="机器id" 与 workdir="目录" 以指定目标机器和工作目录；未指定时使用请求默认值，workdir 相对路径基于默认工作目录解析
- 机器 id "0" 为本机；需要确认可用的目标机器（id、备注、系统信息）时，使用 <list-machines> 查询
- 读取文件时会自动向上查找并加载各级 AGENTS.md，以及触发（yaml 头 glob 匹配）的 .agents/docs/*.md 文档
- 使用 <replace-file> 时，可以指定多个 <replacement> 块
- 设置 regex="true" 可以使用正则表达式进行搜索替换
- 文本文件会直接显示内容，二进制文件会作为附件提供
- 操作文件时请谨慎，避免误删除或覆盖重要文件
`

	return {
		text: [{ content: prompt, description: '文件操作能力说明', important: 0 }],
		additional_chat_log: [],
		extension: {},
	}
}
