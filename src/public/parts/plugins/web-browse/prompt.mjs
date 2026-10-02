/**
 * 网页浏览插件的 GetPrompt：向角色提供浏览网页的调用格式。
 * @returns {Promise<import('../../../../decl/prompt_struct.ts').single_part_prompt_t>} 网页浏览工具说明。
 */
export async function getWebBrowsePrompt() {
	return {
		text: [{
			content: `\
需要阅读某个网页的内容时，可以使用网页浏览工具。由于网页内容较多，请直接提出你想从这个网页得到答案的问题：
<web-browse>
	<url>https://example.com/page</url>
	<question>你想从网页中了解什么？</question>
</web-browse>
工具默认使用当前 AI 源总结网页并回答问题。需要抓取后的 Markdown 原文时使用 <web-browse summarize="false">，其余格式不变。摘要只使用正文和问题，不携带聊天历史。未配置可用 AI 源时会注明并返回原文；抓取或摘要失败时会报告错误。聊天中新提及的链接会在生成前预读元信息并固定到上下文，不会自动调用 AI 总结。`,
			description: '网页浏览工具说明',
			important: 0,
		}],
		additional_chat_log: [],
		extension: {},
	}
}
