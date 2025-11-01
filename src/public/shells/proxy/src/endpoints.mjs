import { setOpenAIAPIEndpoints } from './openai.mjs'

/**
 * 设置API端点。
 * @param {object} router - 路由。
 */
export function setEndpoints(router) {
	setOpenAIAPIEndpoints(router)
}
