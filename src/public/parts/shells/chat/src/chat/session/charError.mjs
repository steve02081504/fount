/**
 * char 顶层 OnError 路由。
 * @param {import('../../../../../../../decl/charAPI.ts').CharAPI_t} char 角色 API
 * @param {Error} error 错误
 * @param {{ username: string, source: string, groupId?: string, channelId?: string, charname?: string, event?: object }} context 上下文
 * @returns {Promise<boolean>} char 是否已处理
 */
export async function dispatchCharError(char, error, context) {
	if (char.OnError) try {
		const handled = await char.OnError(error, context)
		if (handled !== false) return true
	}
	catch (handlerError) {
		console.error('char OnError failed:', handlerError)
	}
	console.error(`char error [${context.source}]:`, error)
	return false
}
