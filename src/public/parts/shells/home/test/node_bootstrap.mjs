import { config, save_config } from '../../../../../server/server.mjs'

/**
 * Home shell live / 前端测试节点 bootstrap。
 * @param {string} username 测试用户名
 * @returns {Promise<void>} 初始化完成
 */
export default async function bootstrap(username) {
	void username
	config.invitedByNodeHash = null
	save_config()
}
