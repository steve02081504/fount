/**
 * 网络搜索插件的 GetPrompt：向角色提供搜索工具的调用格式。
 * @returns {Promise<import('../../../../decl/prompt_struct.ts').single_part_prompt_t>} 搜索工具说明。
 */
export async function getWebSearchPrompt() {
	return {
		text: [{
			content: `\
需要获取最新信息、核实事实或查找资料时，可以使用网络搜索。每行写一个搜索关键词：
<web-search>
关键词1
关键词2
</web-search>
工具会逐个搜索并返回每个关键词最多 5 条结果。搜索依赖用户配置的默认搜索服务源；若不可用，请告知用户需要配置搜索服务源。`,
			description: '网络搜索工具说明',
			important: 0,
		}],
		additional_chat_log: [],
		extension: {},
	}
}
