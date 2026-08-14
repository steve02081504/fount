import open from 'npm:open'

import { hosturl } from '../../../../../server/server.mjs'

import { deletePending, getPending, putPending } from './pending.mjs'
import { persistOAuthToSource } from './persist.mjs'
import { generatePKCE, randomState } from './pkce.mjs'
import { canonicalCallbackUrl, startPortHook } from './portHook.mjs'
import {
	ANTHROPIC,
	CODEX,
	exchangeAnthropicCode,
	exchangeCodexCode,
	pollCopilotGithubToken,
	refreshCopilotToken,
	startCopilotDevice,
} from './providers.mjs'

/**
 * 开始 PKCE 登录并打开浏览器。
 * @param {object} args - 参数。
 * @param {string} args.username - 用户名。
 * @param {object} args.provider - CODEX 或 ANTHROPIC 常量。
 * @param {string} [args.sourceName] - 服务源名。
 * @param {string} [args.serviceSourcePath] - 服务源路径。
 * @returns {Promise<object>} start 响应。
 */
export async function startPkceLogin({ username, provider, sourceName, serviceSourcePath }) {
	const { verifier, challenge } = generatePKCE()
	const state = provider === ANTHROPIC ? verifier : randomState()
	const hook = await startPortHook({
		port: provider.hookPort,
		pathname: provider.hookPath,
		targetUrl: canonicalCallbackUrl(hosturl),
	})
	putPending(state, {
		username,
		providerId: provider.id,
		verifier,
		sourceName,
		serviceSourcePath,
		hook,
	})
	const url = new URL(provider.authorizeUrl)
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('client_id', provider.clientId)
	url.searchParams.set('redirect_uri', provider.redirectUri)
	url.searchParams.set('scope', provider.scope)
	url.searchParams.set('code_challenge', challenge)
	url.searchParams.set('code_challenge_method', 'S256')
	url.searchParams.set('state', state)
	if (provider === CODEX) {
		url.searchParams.set('id_token_add_organizations', 'true')
		url.searchParams.set('codex_cli_simplified_flow', 'true')
		url.searchParams.set('originator', 'fount')
	}
	if (provider === ANTHROPIC)
		url.searchParams.set('code', 'true')
	await open(url.href)
	return { mode: 'pkce', state, authorizeUrl: url.href }
}

/**
 * 开始 Copilot device flow。
 * @param {object} args - 参数。
 * @param {string} args.username - 用户名。
 * @param {string} [args.sourceName] - 服务源名。
 * @param {string} [args.serviceSourcePath] - 服务源路径。
 * @param {string} [args.enterpriseUrl] - GitHub Enterprise。
 * @returns {Promise<object>} start 响应。
 */
export async function startCopilotLogin({ username, sourceName, serviceSourcePath, enterpriseUrl }) {
	const device = await startCopilotDevice(enterpriseUrl)
	const state = randomState()
	const abort = new AbortController()
	const session = putPending(state, {
		username,
		providerId: 'github-copilot',
		sourceName,
		serviceSourcePath,
		abort,
	})
	session.poll = (async () => {
		try {
			const githubToken = await pollCopilotGithubToken(device, abort.signal)
			const oauth = await refreshCopilotToken(githubToken, device.domain === 'github.com' ? undefined : device.domain)
			session.status = 'completed'
			session.oauth = oauth
			await persistOAuthToSource(username, sourceName, serviceSourcePath, oauth)
		}
		catch (error) {
			session.status = 'failed'
			session.error = error.message
		}
	})()
	return {
		mode: 'device',
		state,
		verificationUri: device.verification_uri,
		userCode: device.user_code,
	}
}

/**
 * 用 callback 的 code 完成 PKCE 换票。
 * @param {object} args - 参数。
 * @param {string} args.username - 当前用户。
 * @param {string} args.state - OAuth state。
 * @param {string} args.code - 授权码。
 * @returns {Promise<object>} 凭证。
 */
export async function completePkceLogin({ username, state, code }) {
	const session = getPending(state)
	if (!session) throw new Error('Unknown or expired OAuth state')
	if (session.username !== username) throw new Error('OAuth session user mismatch')
	let oauth
	if (session.providerId === CODEX.id)
		oauth = await exchangeCodexCode(code, session.verifier)
	else if (session.providerId === ANTHROPIC.id)
		oauth = await exchangeAnthropicCode(code, state, session.verifier)
	else
		throw new Error(`Provider ${session.providerId} is not PKCE`)
	session.status = 'completed'
	session.oauth = oauth
	await persistOAuthToSource(session.username, session.sourceName, session.serviceSourcePath, oauth)
	await session.hook?.close?.()
	session.hook = undefined
	return oauth
}

/**
 * 读取登录进度。
 * @param {string} username - 当前用户。
 * @param {string} state - OAuth state。
 * @returns {object} 状态快照。
 */
export function loginStatus(username, state) {
	const session = getPending(state)
	if (!session || session.username !== username)
		return { status: 'unknown' }
	return {
		status: session.status,
		error: session.error,
		oauth: session.oauth,
	}
}

/**
 * 取消 pending 登录。
 * @param {string} username - 当前用户。
 * @param {string} state - OAuth state。
 * @returns {void}
 */
export function cancelLogin(username, state) {
	const session = getPending(state)
	if (!session || session.username !== username) return
	session.abort?.abort()
	deletePending(state)
}
