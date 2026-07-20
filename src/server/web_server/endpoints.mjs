import fs from 'node:fs'

import cors from 'npm:cors'

import { debugLog } from '../../scripts/debug_log.mjs'
import { console, getLocaleDataForUser, fountLocaleList } from '../../scripts/i18n/index.mjs'
import { ms } from '../../scripts/ms.mjs'
import { get_hosturl_in_local_ip, is_local_ip, is_local_ip_from_req, rateLimit } from '../../scripts/ratelimit.mjs'
import { generateVerificationCode, verifyVerificationCode } from '../../scripts/verifycode.mjs'
import { login, register, logout, authenticate, getUserByReq, getUserDictionary, auth_request, generateApiKey, revokeApiKeyByJti, verifyApiKey, verifyPassword, ACCESS_TOKEN_EXPIRY_DURATION, REFRESH_TOKEN_EXPIRY_DURATION, getSecureCookieOptions, respondAuthResult } from '../auth/index.mjs'
import { currentGitBranch, currentGitCommit } from '../autoupdate.mjs'
import { __dirname } from '../base.mjs'
import { processIPCCommand } from '../ipc_server/index.mjs'
import { handleNoCors } from '../no_cors.mjs'
import {
	getLoadedPartList,
	getPartList,
	loadPart,
	getDefaultParts,
	getPartDetails,
	setDefaultPart,
	unsetDefaultPart,
	getAnyDefaultPart,
	getAllDefaultParts as getAllDefaultPartsFromLoader,
	getAnyPreferredDefaultPart,
	getAllCachedPartDetails,
	getPartBranches
} from '../parts_loader.mjs'
import { skip_report, config, save_config } from '../server.mjs'
import { webauthnLoginBegin, webauthnLoginComplete } from '../auth/webauthn.mjs'

import { renderDirectoryListingHtml } from './directory_listing.mjs'
import { register as registerNotifier } from './event_dispatcher.mjs'
import { evalServiceWebSocketHandler, logServiceWebSocketHandler } from './log_service/index.mjs'
import { betterSendFile } from './resources.mjs'
import { watchFrontendChanges } from './watcher.mjs'

/**
 * 非本机访问时校验请求体中的 PoW；无效则写入 401 JSON 并返回 false。
 * @param {import('npm:express').Request} req - Express 请求。
 * @param {import('npm:express').Response} res - Express 响应。
 * @returns {Promise<boolean>} 通过校验或本机访问时为 true。
 */
async function ensurePowTokenOr401(req, res) {
	if (is_local_ip_from_req(req)) return true
	const { powToken } = req.body
	if (!powToken) {
		res.status(401).json({ i18nKey: 'auth.error.powValidationFailed' })
		return false
	}
	const { pow } = await import('../../scripts/pow.mjs')
	const { success } = await pow.validateToken(powToken)
	if (!success) {
		res.status(401).json({ i18nKey: 'auth.error.powValidationFailed' })
		return false
	}
	return true
}

/**
 * 为应用程序注册所有 API 端点。
 * @param {import('npm:express').Router} router - 要在其上注册端点的 Express 路由器。
 * @returns {void}
 */
export function registerEndpoints(router) {
	router.ws('/ws/test/echo', (ws, req) => {
		console.log('WebSocket test connection established.')
		ws.on('message', message => {
			console.log('Received from /ws/test/echo:', message.toString())
			ws.send(message.toString())
		})
		ws.on('close', () => {
			console.log('WebSocket test connection closed.')
		})
	})
	router.ws('/ws/test/auth_echo', authenticate, (ws, req) => {
		console.log('WebSocket auth_test connection established.')
		ws.on('message', message => {
			console.log('Received from /ws/test/auth_echo:', message.toString())
			ws.send(message.toString())
		})
		ws.on('close', () => {
			console.log('WebSocket auth_test connection closed.')
		})
	})

	router.ws('/ws/notify', authenticate, async (ws, req) => {
		const { username } = getUserByReq(req)
		registerNotifier(username, ws)
	})

	router.ws('/ws/logs', (req, res, next) => {
		if (is_local_ip_from_req(req)) return next()
		return authenticate(req, res, next)
	}, logServiceWebSocketHandler)

	router.ws('/ws/eval', (req, res, next) => {
		if (is_local_ip_from_req(req)) return next()
		return authenticate(req, res, next)
	}, evalServiceWebSocketHandler)

	router.get('/api/test/error', (req, res) => {
		throw skip_report(new Error('test error'))
	})
	router.get('/api/test/async_error', async (req, res) => {
		throw skip_report(new Error('test error'))
	})
	router.get('/api/test/unhandledRejection', async (req, res) => {
		Promise.reject(skip_report(new Error('test error')))
		return res.status(200).json({ message: 'hell yeah!' })
	})
	router.post('/api/test/debug-log', authenticate, async (req, res) => {
		const { name, data } = req.body
		await debugLog(name, data)
		res.status(204).end()
	})
	router.get('/api/ping', cors(), async (req, res) => {
		const is_local_ip = is_local_ip_from_req(req)
		let hosturl_in_local_ip
		let ver
		let branch
		if (is_local_ip || await auth_request(req, res)) {
			try { hosturl_in_local_ip = get_hosturl_in_local_ip() } catch { }
			ver = currentGitCommit
			branch = currentGitBranch
		}
		return res.status(200).json({
			message: 'pong',
			client_name: 'fount',
			ver,
			branch,
			uuid: config.uuid,
			is_local_ip,
			hosturl_in_local_ip,
		})
	})

	/** 已认证用户通用 no-CORS 中转：双向流式；见 src/server/no_cors.mjs */
	router.all('/api/no-cors', authenticate, handleNoCors)

	router.post('/api/pow/challenge', async (req, res) => {
		const { pow } = await import('../../scripts/pow.mjs')
		res.json(await pow.createChallenge())
	})

	router.post('/api/pow/redeem', async (req, res) => {
		const { pow } = await import('../../scripts/pow.mjs')
		const { token, solutions } = req.body
		if (!token || !solutions) return res.status(400).json({ i18nKey: 'auth.error.tokenAndSolutionsRequired' })
		res.json(await pow.redeemChallenge({ token, solutions }))
	})

	router.get('/api/getlocaledata', async (req, res) => {
		const browserLanguages = req.headers['accept-language']?.split?.(',')?.map?.(lang => lang.trim().split(';')[0]) || []
		const userPreferredLanguages = req.query.preferred?.split?.(',')?.map?.(lang => lang.trim()) || []

		// 合并语言列表，用户设置的优先，然后去重
		const preferredLanguages = [...new Set([...userPreferredLanguages, ...browserLanguages])].filter(Boolean)

		let username
		if (await auth_request(req, res)) try {
			const user = getUserByReq(req)
			user.locales = preferredLanguages
			username = user.username
			console.logI18n('fountConsole.route.setLanguagePreference', { username, preferredLanguages: preferredLanguages.join(', ') })
		} catch (error) {
			console.error('Error setting language preference for user:', error)
		}

		return res.status(200).json(await getLocaleDataForUser(username, preferredLanguages))
	})

	router.get('/api/getavailablelocales', async (req, res) => {
		res.status(200).json(fountLocaleList)
	})

	router.post('/api/login', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		if (!await ensurePowTokenOr401(req, res)) return
		const { username, password, deviceid } = req.body
		const result = await login(username, password, deviceid, req)
		const { status, accessToken, refreshToken, ...json } = result
		if (status === 200 && accessToken) {
			const cookieOptions = getSecureCookieOptions(req)
			res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_DURATION })
			res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_DURATION })
		}
		res.status(status).json(json)
	})

	router.post('/api/webauthn/login/begin', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		if (!await ensurePowTokenOr401(req, res)) return
		respondAuthResult(res, await webauthnLoginBegin(req))
	})

	router.post('/api/webauthn/login/complete', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		if (!await ensurePowTokenOr401(req, res)) return
		const { credential, deviceid, authSessionToken } = req.body
		const token = String(authSessionToken ?? '').trim()
		if (!credential)
			return res.status(400).json({ i18nKey: 'auth.webauthn.errorCredentialRequired' })
		if (!token)
			return res.status(400).json({ i18nKey: 'auth.webauthn.errorAuthSessionRequired' })
		const deviceId = deviceid?.trim?.() || 'unknown'
		const result = await webauthnLoginComplete(credential, token, deviceId, req)
		const { status, accessToken, refreshToken, ...json } = result
		if (status === 200 && accessToken) {
			const cookieOptions = getSecureCookieOptions(req)
			res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_DURATION })
			res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_DURATION })
		}
		res.status(status).json(json)
	})

	router.post('/api/register/generateverificationcode', async (req, res) => {
		// get ip
		const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
		generateVerificationCode(ip)
		res.status(200).json({ message: 'verification code generated' })
	})
	router.post('/api/register', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		const { username, password, verificationcode } = req.body
		const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
		if (!is_local_ip(ip)) {
			if (!await ensurePowTokenOr401(req, res)) return

			if (verifyVerificationCode(verificationcode, ip) === false) {
				res.status(401).json({ i18nKey: 'auth.error.verificationCodeError' })
				return
			}
		}
		respondAuthResult(res, await register(username, password))
	})

	router.post('/api/logout', authenticate, logout)

	router.post('/api/apikey/create', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const { description } = req.body
		const { apiKey, jti } = await generateApiKey(user.username, description)
		res.status(201).json({ apiKey, jti })
	})

	router.get('/api/apikey/list', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const apiKeys = (user.auth.apiKeys || []).map(key => ({
			jti: key.jti,
			prefix: key.prefix,
			description: key.description,
			createdAt: key.createdAt,
			lastUsed: key.lastUsed,
		}))
		res.status(200).json({ apiKeys })
	})

	router.post('/api/apikey/revoke', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const { jti, password } = req.body
		if (!jti) return res.status(400).json({ i18nKey: 'userSettings.apiKeys.revokeMissingJti' })
		if (!password) return res.status(400).json({ i18nKey: 'userSettings.apiKeys.revokeMissingPassword' })
		if (!user?.auth?.apiKeys?.length)
			return res.status(400).json({ i18nKey: 'userSettings.apiKeys.noKeysForUser' })
		if (!await verifyPassword(password, user.auth.password))
			return res.status(401).json({ i18nKey: 'userSettings.apiKeys.revokeWrongPassword' })
		if (!user.auth.apiKeys.some(key => key.jti === jti))
			return res.status(400).json({ i18nKey: 'userSettings.apiKeys.keyNotFound' })

		await revokeApiKeyByJti(user.username, jti)
		res.status(200).json({})
	})

	router.post('/api/apikey/verify', async (req, res) => {
		const { apiKey } = req.body
		if (!apiKey) return res.status(400).json({ i18nKey: 'userSettings.apiKeys.verifyMissingApiKey' })

		const user = await verifyApiKey(apiKey)
		res.status(200).json({ valid: !!user })
	})

	router.get('/api/whoami', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json({ username })
	})

	router.post('/api/authenticate', authenticate, (req, res) => {
		res.status(200).json({ message: 'Authenticated' })
	})

	router.post('/api/runpart', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { partpath, args } = req.body
		await processIPCCommand('runpart', { username, partpath, args })
		res.status(200).json({ message: 'Shell command sent successfully.' })
	})

	router.post('/api/loadpart', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const { partpath } = req.body
		const normalized = partpath?.replace?.(/:/g, '/')
		if (!normalized) return res.status(400).json({ i18nKey: 'fountConsole.ipc.partPathRequired' })
		await loadPart(username, normalized)
		res.status(200).json({ message: `Part ${normalized} loaded successfully.` })
	})

	// Generic path handlers
	// Capture remaining path as request param 0.
	router.get(/^\/api\/getlist\/(.*)/, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const path = req.params[0].replace(/:/g, '/')
		res.status(200).json(getPartList(username, path))
	})
	router.get(/^\/api\/getloadedlist\/(.*)/, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const path = req.params[0].replace(/:/g, '/')
		res.status(200).json(getLoadedPartList(username, path))
	})
	router.get(/^\/api\/getallcacheddetails\/(.*)/, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const path = req.params[0].replace(/:/g, '/')
		const details = await getAllCachedPartDetails(username, path)
		res.status(200).json(details)
	})
	router.get(/^\/api\/getdetails\/(.*)/, authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const path = req.params[0].replace(/:/g, '/')
		// name param from query is optional override? Or should invalid?
		// Usually details are for a specific part path.
		// But previously it was /api/getdetails/SHELLS?name=CHAT
		// Now it is likely /api/getdetails/shells/chat.
		const { nocache } = req.query
		const details = await getPartDetails(username, path, nocache)
		res.status(200).json(details)
	})

	router.get('/api/getpartbranches', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const nocache = req.query.nocache === 'true' || req.query.nocache === '1'
		res.status(200).json(getPartBranches(username, { nocache }))
	})

	// Static files handler: /parts/partpath/filepath (partpath may contain colons)
	router.get(/^\/parts\/([^/]+)(.*)$/, authenticate, async (req, res, next) => {
		const { username } = getUserByReq(req)
		const partpath = req.params[0]
		const filepath = req.params[1].split('?')[0]
		// Convert partpath colons to slashes for filesystem access
		const realPath = partpath.replace(/:/g, '/') + '/public'
		let finalPath
		for (const directory of [
			getUserDictionary(username) + '/' + realPath,
			__dirname + '/src/public/parts/' + realPath,
		]) {
			const path = directory + '/' + filepath
			if (fs.existsSync(path)) {
				finalPath = path
				if (fs.statSync(path).isDirectory())
					if (req.path.endsWith('/')) {
						const indexPath = path + '/index.html'
						if (fs.existsSync(indexPath)) finalPath = indexPath
						else return res.set('Content-Type', 'text/html; charset=utf-8').send(await renderDirectoryListingHtml(req.path, path))
					}
					else
						return res.redirect(301, req.url.replace(req.path, req.path + '/'))

				watchFrontendChanges(`/parts/${partpath}/`, directory)
				break
			}
		}
		if (finalPath) return betterSendFile(res, finalPath)
		return next()
	})

	router.get('/api/defaultpart/getall', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		res.status(200).json(getDefaultParts(user))
	})

	router.post('/api/defaultpart/add', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const { parent, child } = req.body
		setDefaultPart(user, parent, child)
		res.status(200).json({ message: 'success' })
	})

	router.post('/api/defaultpart/unset', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const { parent, child } = req.body
		unsetDefaultPart(user, parent, child)
		res.status(200).json({ message: 'success' })
	})

	router.get(/^\/api\/defaultpart\/getany\/(.*)/, authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const parent = req.params[0]
		res.status(200).json(getAnyDefaultPart(user, parent) || '')
	})

	router.get(/^\/api\/defaultpart\/getallbytype\/(.*)/, authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const parent = req.params[0]
		res.status(200).json(getAllDefaultPartsFromLoader(user, parent))
	})

	router.get(/^\/api\/defaultpart\/getanypreferred\/(.*)/, authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const parent = req.params[0]
		res.status(200).json(getAnyPreferredDefaultPart(user, parent) || '')
	})

	router.get('/api/getusersetting', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const { key } = req.query
		res.status(200).json({ key, value: user[key] })
	})

	router.post('/api/setusersetting', authenticate, async (req, res) => {
		const user = getUserByReq(req)
		const { key, value } = req.body
		if (key === null) delete user[key]
		else user[key] = value
		save_config()
		res.status(200).json({ message: 'success' })
	})
}
