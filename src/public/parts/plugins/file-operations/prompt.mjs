/**
 * 文件操作插件的 GetPrompt：向角色提示中注入文件操作能力说明。
 * @param {import('../../../../decl/pluginAPI.ts').chatReplyRequest_t} args - 聊天回复请求参数。
 * @returns {Promise<import('../../../../decl/prompt_struct.ts').single_part_prompt_t>} 单段 prompt。
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

**注意事项**：
- 文件路径可以是相对路径或绝对路径
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
