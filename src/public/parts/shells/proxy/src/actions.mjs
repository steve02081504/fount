import { hosturl } from '../../../../../server/server.mjs'

/**
 * 定义了可用于代理功能的各种操作。
 */
export const actions = {
	/**
	 * 获取与OpenAI兼容的API端点URL。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @returns {string} - API端点的URL。
	 */
	default: ({ user }) => `${hosturl}/api/parts/shells:proxy/calling/openai`
}
