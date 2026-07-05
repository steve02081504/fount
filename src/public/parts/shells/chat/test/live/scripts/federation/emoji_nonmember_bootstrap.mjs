import chatBootstrap from '../../../node_bootstrap.mjs'
import socialBootstrap from '../../../../../social/test/node_bootstrap.mjs'

/**
 * fed_emoji_nonmember 双 shell 节点 bootstrap。
 * @param {string} username 测试用户名
 * @returns {Promise<void>}
 */
export default async function bootstrap(username) {
	await chatBootstrap(username)
	await socialBootstrap(username)
}
