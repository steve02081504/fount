import fs from 'node:fs'

import cors from 'npm:cors'

import { console, getLocaleData, fountLocaleList } from '../../scripts/i18n.mjs'
import { ms } from '../../scripts/ms.mjs'
import { get_hosturl_in_local_ip, is_local_ip, is_local_ip_from_req, rateLimit } from '../../scripts/ratelimit.mjs'
import { generateVerificationCode, verifyVerificationCode } from '../../scripts/verifycode.mjs'
import { login, register, logout, authenticate, getUserByReq, getUserDictionary, getUserByUsername, auth_request, generateApiKey, revokeApiKey, verifyApiKey, setApiCookieResponse, ACCESS_TOKEN_EXPIRY_DURATION, REFRESH_TOKEN_EXPIRY_DURATION, getSecureCookieOptions } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { processIPCCommand } from '../ipc_server/index.mjs'
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
import { skip_report, currentGitCommit, config, save_config } from '../server.mjs'

import { register as registerNotifier } from './event_dispatcher.mjs'
import { betterSendFile } from './resources.mjs'
import { watchFrontendChanges } from './watcher.mjs'

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
		const { username } = await getUserByReq(req)
		registerNotifier(username, ws)
	})

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
	router.get('/api/ping', cors(), async (req, res) => {
		const is_local_ip = is_local_ip_from_req(req)
		let hosturl_in_local_ip
		let ver
		if (is_local_ip || await auth_request(req, res)) {
			try { hosturl_in_local_ip = get_hosturl_in_local_ip() } catch { }
			ver = currentGitCommit
		}
		return res.status(200).json({
			message: 'pong',
			client_name: 'fount',
			ver,
			uuid: config.uuid,
			is_local_ip,
			hosturl_in_local_ip,
		})
	})

	router.post('/api/pow/challenge', async (req, res) => {
		const { pow } = await import('../../scripts/pow.mjs')
		res.json(await pow.createChallenge())
	})

	router.post('/api/pow/redeem', async (req, res) => {
		const { pow } = await import('../../scripts/pow.mjs')
		const { token, solutions } = req.body
		if (!token || !solutions) return res.status(400).json({ success: false })
		res.json(await pow.redeemChallenge({ token, solutions }))
	})

	router.get('/api/getlocaledata', async (req, res) => {
		const browserLanguages = req.headers['accept-language']?.split?.(',')?.map?.(lang => lang.trim().split(';')[0]) || []
		const userPreferredLanguages = req.query.preferred?.split?.(',')?.map?.(lang => lang.trim()) || []

		// 合并语言列表，用户设置的优先，然后去重
		const preferredLanguages = [...new Set([...userPreferredLanguages, ...browserLanguages])].filter(Boolean)

		let username
		if (req.cookies.accessToken) try {
			await authenticate(req, res)
			const user = await getUserByReq(req)
			user.locales = preferredLanguages
			username = user.username
			console.logI18n('fountConsole.route.setLanguagePreference', { username, preferredLanguages: preferredLanguages.join(', ') })
		} catch (error) {
			console.error('Error setting language preference for user:', error)
		}

		return res.status(200).json(await getLocaleData(username, preferredLanguages))
	})

	router.get('/api/getavailablelocales', async (req, res) => {
		res.status(200).json(fountLocaleList)
	})

	router.post('/api/login', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		if (!is_local_ip_from_req(req)) {
			const { pow } = await import('../../scripts/pow.mjs')
			const { powToken } = req.body
			const { success } = powToken && await pow.validateToken(powToken)
			if (!success) return res.status(401).json({ message: 'PoW validation failed' })
		}
		const { username, password, deviceid } = req.body
		const result = await login(username, password, deviceid, req, res)
		if (result.status === 114514) return
		// 在登录成功时设置 Cookie
		if (result.status === 200) {
			const cookieOptions = getSecureCookieOptions(req)
			res.cookie('accessToken', result.accessToken, { ...cookieOptions, maxAge: ACCESS_TOKEN_EXPIRY_DURATION }) // 短效
			res.cookie('refreshToken', result.refreshToken, { ...cookieOptions, maxAge: REFRESH_TOKEN_EXPIRY_DURATION }) // 长效
		}
		res.status(result.status).json(result)
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
			const { pow } = await import('../../scripts/pow.mjs')
			const { powToken } = req.body
			const { success } = powToken && await pow.validateToken(powToken)
			if (!success) return res.status(401).json({ message: 'PoW validation failed' })

			if (verifyVerificationCode(verificationcode, ip) === false) {
				res.status(401).json({ message: 'verification code incorrect' })
				return
			}
		}
		const result = await register(username, password)
		res.status(result.status).json(result)
	})

	router.post('/api/logout', logout)

	router.post('/api/apikey/create', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { description } = req.body
		const { apiKey, jti } = await generateApiKey(user.username, description)
		res.status(201).json({ success: true, apiKey, jti, message: 'API Key created successfully. Store it securely, it will not be shown again.' })
	})

	router.get('/api/apikey/list', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const userConfig = getUserByUsername(user.username)
		const apiKeys = (userConfig.auth.apiKeys || []).map(key => ({
			jti: key.jti,
			prefix: key.prefix,
			description: key.description,
			createdAt: key.createdAt,
			lastUsed: key.lastUsed,
		}))
		res.status(200).json({ success: true, apiKeys })
	})

	router.post('/api/apikey/revoke', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { jti, password } = req.body
		if (!jti) return res.status(400).json({ success: false, error: 'JTI of the key to revoke is required.' })
		if (!password) return res.status(400).json({ success: false, error: 'Password is required to revoke API key.' })

		const result = await revokeApiKey(user.username, jti, password)
		res.status(result.success ? 200 : 400).json(result)
	})

	router.post('/api/apikey/verify', async (req, res) => {
		const { apiKey } = req.body
		if (!apiKey) return res.status(400).json({ success: false, error: 'API key is required.' })

		const user = await verifyApiKey(apiKey)
		res.status(200).json({ success: true, valid: !!user })
	})

	router.post('/api/get-api-cookie', async (req, res) => {
		const { apiKey } = req.body
		const result = await setApiCookieResponse(apiKey, req, res)
		res.status(result.status).json(result)
	})

	router.get('/api/whoami', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json({ username })
	})

	router.post('/api/authenticate', authenticate, (req, res) => {
		res.status(200).json({ message: 'Authenticated' })
	})

	router.post('/api/runpart', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partpath, args } = req.body
		await processIPCCommand('runpart', { username, partpath, args })
		res.status(200).json({ message: 'Shell command sent successfully.' })
	})

	router.post('/api/loadpart', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partpath } = req.body
		const normalized = partpath?.replace?.(/:/g, '/')
		if (!normalized) return res.status(400).json({ success: false, error: 'Part path is required.' })
		await loadPart(username, normalized)
		res.status(200).json({ success: true, message: `Part ${normalized} loaded successfully.` })
	})

	// Generic path handlers
	// Capture remaining path as request param 0.
	router.get(/^\/api\/getlist\/(.*)/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const path = req.params[0].replace(/:/g, '/')
		res.status(200).json(getPartList(username, path))
	})
	router.get(/^\/api\/getloadedlist\/(.*)/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const path = req.params[0].replace(/:/g, '/')
		res.status(200).json(getLoadedPartList(username, path))
	})
	router.get(/^\/api\/getallcacheddetails\/(.*)/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const path = req.params[0].replace(/:/g, '/')
		const details = await getAllCachedPartDetails(username, path)
		res.status(200).json(details)
	})
	router.get(/^\/api\/getdetails\/(.*)/, authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
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
		const { username } = await getUserByReq(req)
		const nocache = req.query.nocache === 'true' || req.query.nocache === '1'
		res.status(200).json(getPartBranches(username, { nocache }))
	})

	// Static files handler: /parts/partpath/filepath (partpath may contain colons)
	router.get(/^\/parts\/([^/]+)(.*)$/, authenticate, async (req, res, next) => {
		const { username } = await getUserByReq(req)
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
					if (req.path.endsWith('/')) finalPath += '/index.html'
					else return res.redirect(301, req.url.replace(req.path, req.path + '/'))
				watchFrontendChanges(`/parts/${partpath}/`, directory)
				break
			}
		}
		if (finalPath) return betterSendFile(res, finalPath)
		return next()
	})

	router.get('/api/defaultpart/getall', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		res.status(200).json(getDefaultParts(user))
	})

	router.post('/api/defaultpart/add', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { parent, child } = req.body
		setDefaultPart(user, parent, child)
		res.status(200).json({ message: 'success' })
	})

	router.post('/api/defaultpart/unset', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { parent, child } = req.body
		unsetDefaultPart(user, parent, child)
		res.status(200).json({ message: 'success' })
	})

	router.get(/^\/api\/defaultpart\/getany\/(.*)/, authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const parent = req.params[0]
		res.status(200).json(getAnyDefaultPart(user, parent) || '')
	})

	router.get(/^\/api\/defaultpart\/getallbytype\/(.*)/, authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const parent = req.params[0]
		res.status(200).json(getAllDefaultPartsFromLoader(user, parent))
	})

	router.get(/^\/api\/defaultpart\/getanypreferred\/(.*)/, authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const parent = req.params[0]
		res.status(200).json(getAnyPreferredDefaultPart(user, parent) || '')
	})

	router.get('/api/getusersetting', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { key } = req.query
		res.status(200).json({ key, value: user[key] })
	})

	router.post('/api/setusersetting', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { key, value } = req.body
		user[key] = value
		save_config()
		res.status(200).json({ message: 'success' })
	})
}
