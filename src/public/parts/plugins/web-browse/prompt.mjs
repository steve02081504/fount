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
工具会抓取网页正文并返回结果；请根据返回内容回答问题。若网页抓取失败，请如实告知用户。`,
			description: '网页浏览工具说明',
			important: 0,
		}],
		additional_chat_log: [],
		extension: {},
	}
}
