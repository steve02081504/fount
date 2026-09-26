import util from 'node:util'

/**
 * 默认按需加载浏览器集成 shell 的 API。
 * @returns {Promise<object>} 浏览器集成 API 模块。
 */
function defaultGetApi() {
	return import('../../shells/browserIntegration/src/api.mjs')
}

/**
 * 收集当前浏览器状态描述。
 * @param {object} args - 聊天回复请求。
 * @param {object} api - 浏览器集成 API 模块。
 * @returns {string} 浏览器状态文本。
 */
function describeBrowserState(args, api) {
	let result = '当前浏览器状态：\n'
	let connectedPages
	try {
		connectedPages = api.getConnectedPages(args.username)
		if (connectedPages?.length) {
			result += '用户已连接的浏览器页面：\n'
			result += util.inspect(connectedPages.map(page => ({ id: page.id, url: page.url, title: page.title, focused: page.hasFocus })), { depth: 2 })
		}
		else result += '无已连接页面\n'
	}
	catch (error) {
		console.warn('browser-integration: 获取已连接页面失败', error)
		result += `获取已连接页面出错：${error?.stack ?? error?.message}\n`
	}

	if (!connectedPages?.some(page => page.hasFocus)) try {
		const mostRecentPage = api.getMostRecentPageInfo(args.username)
		if (mostRecentPage) {
			result += '最近访问的页面：\n'
			result += util.inspect({ id: mostRecentPage.id, url: mostRecentPage.url, title: mostRecentPage.title }, { depth: 2 })
			result += '\n'
		}
	}
	catch (error) {
		console.warn('browser-integration: 获取最近页面失败', error)
	}
	return result
}

/**
 * 创建浏览器集成插件的 GetPrompt。
 * @param {object} [options] - 依赖项。
 * @param {() => Promise<object>} [options.getApi] - 获取浏览器集成 API 模块。
 * @returns {(args: object) => Promise<import('../../../../decl/prompt_struct.ts').single_part_prompt_t>} GetPrompt 函数。
 */
export function createBrowserIntegrationPrompt({ getApi = defaultGetApi } = {}) {
	return async function getBrowserIntegrationPrompt(args) {
		let result = `\
你拥有与用户浏览器交互的能力：可以理解页面内容，并在页面上执行操作。
`
		try {
			const api = await getApi()
			result += describeBrowserState(args, api)
		}
		catch (error) {
			console.warn('browser-integration: 加载浏览器集成 API 失败', error)
			result += '浏览器集成当前不可用（未找到浏览器集成 shell）。\n'
		}

		result += `\
---
通过返回以下 XML 指令触发相应功能：

1. 获取页面信息（操作前先获取所需信息）：
获取页面可见部分 HTML（首选，信息密度更高）：
<browser-get-visible-html><pageId>页面 ID</pageId></browser-get-visible-html>
获取页面完整 HTML：
<browser-get-page-html><pageId>页面 ID</pageId></browser-get-page-html>
获取浏览历史：
<browser-get-browse-history></browser-get-browse-history>

2. 在页面上执行操作：
<browser-run-js-on-page>
	<pageId>页面 ID</pageId>
	<script>
		// 支持顶层 await 与 import；最后一条语句的返回值会被返回
	</script>
</browser-run-js-on-page>
可用 callback(data) 异步回传数据，回调会作为系统消息送达你。

3. 管理自动运行脚本：
列出：<browser-list-autorun-scripts></browser-list-autorun-scripts>
添加：<browser-add-autorun-script><urlRegex>URL 正则</urlRegex><script>JS 代码</script><comment>描述</comment></browser-add-autorun-script>
更新：<browser-update-autorun-script><id>脚本 ID</id>...</browser-update-autorun-script>
删除：<browser-remove-autorun-script><id>脚本 ID</id></browser-remove-autorun-script>

4. 发送弹幕：
<browser-send-danmaku-to-page>
	<pageId>页面 ID</pageId>
	<content>弹幕内容（必需）</content>
	<speed>速度（可选）</speed>
	<color>颜色（可选）</color>
	<fontSize>字号（可选）</fontSize>
	<yPos>垂直位置（可选，0-1）</yPos>
</browser-send-danmaku-to-page>

---
流程建议：用 pageId 定位页面（也可用 focused 指代焦点页、mostRecent 指代最近页）→ 优先用 <browser-get-visible-html> 分析内容 → 用 <browser-run-js-on-page> 执行操作 → 向用户汇报结果。
`
		return {
			text: [{
				content: result,
				description: '浏览器集成工具说明',
				important: 0,
			}],
			additional_chat_log: [],
			extension: {},
		}
	}
}
