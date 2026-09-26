import { httpError } from '../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'
import { getServiceSourceFile, saveServiceSourceFile } from '../../serviceSourceManage/src/manager.mjs'

import { cancelLogin, completePkceLogin, loginStatus, startCopilotLogin, startPkceLogin } from './login.mjs'
import { ANTHROPIC, CODEX, ensureOAuthCredentials, fetchCodexModels } from './providers.mjs'

const PREFIX = '/api/parts/shells\\:oauth_handler'

/**
 * 注册 oauth_handler HTTP 路由。
 * @param {import('npm:express').Router} router - 部件路由器。
 * @returns {void}
 */
export function setEndpoints(router) {
	router.get(`${PREFIX}/codex/models`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { sourceName } = req.query
		if (typeof sourceName !== 'string' || !sourceName) throw httpError(400, 'Codex source name is required')
		const sourcePath = 'serviceSources/AI'
		const source = await getServiceSourceFile(username, sourceName, sourcePath)
		if (source.generator !== 'codex') throw httpError(400, 'Not a Codex service source')
		if (!source.config?.oauth?.access) throw httpError(409, 'Codex OAuth login required')
		const config = { ...source.config }
		const credentials = await ensureOAuthCredentials(config, CODEX.id, async () => {
			await saveServiceSourceFile(username, sourceName, { ...source, config }, sourcePath)
		})
		res.status(200).json({ models: await fetchCodexModels(credentials) })
	})

	router.post(`${PREFIX}/start`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { provider, sourceName, serviceSourcePath } = req.body || {}
		if (provider === 'github-copilot') {
			res.status(200).json(await startCopilotLogin({ username, sourceName, serviceSourcePath }))
			return
		}
		const spec = provider === 'openai-codex' ? CODEX : provider === 'anthropic' ? ANTHROPIC : undefined
		if (!spec) throw httpError(400, `Unknown OAuth provider: ${provider}`)
		res.status(200).json(await startPkceLogin({
			username, provider: spec, sourceName, serviceSourcePath,
			requestOrigin: req.get('origin'), requestHost: req.get('host'),
		}))
	})

	router.post(`${PREFIX}/complete`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { state, code } = req.body || {}
		if (!state || !code) throw httpError(400, 'state and code are required')
		await completePkceLogin({ username, state, code })
		res.status(200).json({ status: 'completed' })
	})

	router.get(`${PREFIX}/status/:state`, authenticate, (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(loginStatus(username, req.params.state))
	})

	router.post(`${PREFIX}/cancel`, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		await cancelLogin(username, req.body?.state)
		res.status(200).json({})
	})
}
