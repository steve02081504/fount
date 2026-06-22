/**
 * Social live / 前端测试节点 bootstrap（由 test_lib node_worker 调用）。
 * @param {string} username 测试用户名
 * @returns {Promise<void>}
 */
export default async function bootstrap(username) {
	const { ensureOperatorPubKey } = await import('../../../../../server/p2p_server/operator_identity.mjs')
	const { ensureOperatorSocialReady } = await import('../src/lib/bootstrap.mjs')
	await ensureOperatorPubKey(username)
	await ensureOperatorSocialReady(username)
}
