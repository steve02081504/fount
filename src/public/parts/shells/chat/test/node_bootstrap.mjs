/**
 * Chat live / 联邦测试节点 bootstrap（由 test_lib node_worker 调用）。
 * @param {string} username 测试用户名
 * @returns {Promise<void>}
 */
export default async function bootstrap(username) {
	const { ensureOperatorPubKey } = await import('../../../../../server/p2p_server/operator_identity.mjs')
	await ensureOperatorPubKey(username)
}
