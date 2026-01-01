import { setOpenAIAPIEndpoints } from './openai.mjs'

/**
 * 为代理功能设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	setOpenAIAPIEndpoints(router)
}
