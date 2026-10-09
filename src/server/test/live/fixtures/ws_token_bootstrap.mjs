/**
 * live 探针 bootstrap：为「已不存在的用户」签一个签名合法、但查不到用户的 accessToken。
 *
 * 用于覆盖 `try_auth_request` 的放行漏洞：token 验签通过、`config.data.users[username]` 却是
 * undefined 时，旧实现会 `req.user = undefined` 并 `next()`，于是 WebSocket 升级「成功」、
 * 随后路由处理器才抛 401（客户端只看到握手成功后 1006）。
 * 测试进程拿不到节点私钥，因此只能在节点进程内签。
 */
import fs from 'node:fs'
import process from 'node:process'

import { generateAccessToken } from 'fount/server/auth/index.mjs'

/** 用于签 token 的幽灵用户名（故意不在 config.data.users 里）。 */
const MISSING_USERNAME = 'ws-upgrade-probe-missing-user'

/**
 * 写入幽灵用户的 accessToken 到 `FOUNT_TEST_WS_TOKEN_OUT` 指定的文件。
 * @returns {Promise<void>} 写入完成
 */
export default async function bootstrap() {
	const tokenPath = process.env.FOUNT_TEST_WS_TOKEN_OUT
	if (!tokenPath) throw new Error('FOUNT_TEST_WS_TOKEN_OUT is required for the ws auth bootstrap')
	const token = await generateAccessToken({ username: MISSING_USERNAME, userId: `${MISSING_USERNAME}-id` })
	fs.writeFileSync(tokenPath, token, 'utf8')
}
