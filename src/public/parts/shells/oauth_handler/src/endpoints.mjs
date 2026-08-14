import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'

import { cancelLogin, completePkceLogin, loginStatus, startCopilotLogin, startPkceLogin } from './login.mjs'
import { ANTHROPIC, CODEX } from './providers.mjs'

const PREFIX = '/api/parts/shells\\:oauth_handler'

/**
 * 注册 oauth_handler HTTP 路由。
 * @param {import('npm:express').Router} router - 部件路由器。
 * @returns {void}
 */
export function setEndpoints(router) {
	router.post(`${PREFIX}/start`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { provider, sourceName, serviceSourcePath, enterpriseUrl } = req.body || {}
		if (provider === 'github-copilot') {
			res.status(200).json(await startCopilotLogin({ username, sourceName, serviceSourcePath, enterpriseUrl }))
			return
		}
		const spec = provider === 'openai-codex' ? CODEX : provider === 'anthropic' ? ANTHROPIC : undefined
		if (!spec) throw httpError(400, `Unknown OAuth provider: ${provider}`)
		res.status(200).json(await startPkceLogin({ username, provider: spec, sourceName, serviceSourcePath }))
	})

	router.post(`${PREFIX}/complete`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { state, code } = req.body || {}
		if (!state || !code) throw httpError(400, 'state and code are required')
		res.status(200).json(await completePkceLogin({ username, state, code }))
	})

	router.get(`${PREFIX}/status/:state`, authenticate, (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(loginStatus(username, req.params.state))
	})

	router.post(`${PREFIX}/cancel`, authenticate, (req, res) => {
		const { username } = getUserByReq(req)
		cancelLogin(username, req.body?.state)
		res.status(200).json({})
	})
}
