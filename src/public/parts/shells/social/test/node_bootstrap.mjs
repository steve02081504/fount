/**
 * Social live / 前端测试节点 bootstrap（由 src/scripts/test node_worker 调用）。
 * @param {string} username 测试用户名
 * @returns {Promise<void>}
 */
import { ensureSocialTestReady } from './after_init.mjs'

/** @param {string} username */
export default async function bootstrap(username) {
	await ensureSocialTestReady(username)
}
