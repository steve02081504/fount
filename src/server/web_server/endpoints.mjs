import fs from 'node:fs'

import cors from 'npm:cors'

import { console, getLocaleData, fountLocaleList, geti18n } from '../../scripts/i18n.mjs'
import { ms } from '../../scripts/ms.mjs'
import { pow } from '../../scripts/pow.mjs'
import { get_hosturl_in_local_ip, is_local_ip, is_local_ip_from_req, rateLimit } from '../../scripts/ratelimit.mjs'
import { generateVerificationCode, verifyVerificationCode } from '../../scripts/verifycode.mjs'
import { login, register, logout, authenticate, getUserByReq, getUserDictionary, getUserByUsername, auth_request, generateApiKey, revokeApiKey, verifyApiKey, ACCESS_TOKEN_EXPIRY_DURATION, REFRESH_TOKEN_EXPIRY_DURATION } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { processIPCCommand } from '../ipc_server/index.mjs'
import { partsList } from '../managers/base.mjs'
import { getLoadedPartList, getPartList } from '../managers/index.mjs'
import { getDefaultParts, getPartDetails, setDefaultPart } from '../parts_loader.mjs'
import { skip_report, currentGitCommit, config, save_config } from '../server.mjs'

import { register as registerNotifier } from './event_dispatcher.mjs'

/**
 * @param {import('npm:express').Router} router
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
		if (is_local_ip || await auth_request(req, res)) try { hosturl_in_local_ip = get_hosturl_in_local_ip() } catch { }
		return res.status(200).json({
			message: 'pong',
			client_name: 'fount',
			ver: currentGitCommit,
			uuid: config.uuid,
			is_local_ip,
			hosturl_in_local_ip,
		})
	})

	router.post('/api/pow/challenge', async (req, res) => {
		res.json(await pow.createChallenge())
	})

	router.post('/api/pow/redeem', async (req, res) => {
		const { token, solutions } = req.body
		if (!token || !solutions) return res.status(400).json({ success: false })
		res.json(await pow.redeemChallenge({ token, solutions }))
	})

	router.get('/api/getlocaledata', async (req, res) => {
		const browserLanguages = req.headers['accept-language']?.split?.(',')?.map?.(lang => lang.trim().split(';')[0]) || []
		const userPreferredLanguages = req.query.preferred?.split?.(',')?.map?.(lang => lang.trim()) || []

		// 合并语言列表，用户设置的优先，然后去重
		const preferredLanguages = [...new Set([...userPreferredLanguages, ...browserLanguages])].filter(Boolean)

		if (req.cookies.accessToken) try {
			await authenticate(req, res)
			const user = await getUserByReq(req)
			user.locales = preferredLanguages
			console.logI18n('fountConsole.route.setLanguagePreference', { username: user.username, preferredLanguages: preferredLanguages.join(', ') })
		} catch (error) {
			console.error('Error setting language preference for user:', error)
		}

		return res.status(200).json(await getLocaleData(preferredLanguages))
	})

	router.get('/api/getavailablelocales', async (req, res) => {
		res.status(200).json(fountLocaleList)
	})

	router.post('/api/login', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		if (!is_local_ip_from_req(req)) {
			const { powToken } = req.body
			const { success } = powToken && await pow.validateToken(powToken)
			if (!success) return res.status(401).json({ message: geti18n('auth.error.powTokenInvalid') })
		}
		const { username, password, deviceid } = req.body
		const result = await login(username, password, deviceid, req)
		// 在登录成功时设置 Cookie
		if (result.status === 200) {
			res.cookie('accessToken', result.accessToken, { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax', maxAge: ACCESS_TOKEN_EXPIRY_DURATION }) // 短效
			res.cookie('refreshToken', result.refreshToken, { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https', sameSite: 'Lax', maxAge: REFRESH_TOKEN_EXPIRY_DURATION }) // 长效
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
			const { powToken } = req.body
			const { success } = powToken && await pow.validateToken(powToken)
			if (!success) return res.status(401).json({ message: geti18n('auth.error.powTokenInvalid') })

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
		const { jti } = req.body
		if (!jti) return res.status(400).json({ success: false, error: 'JTI of the key to revoke is required.' })

		const result = await revokeApiKey(user.username, jti)
		res.status(result.success ? 200 : 404).json(result)
	})

	router.post('/api/apikey/verify', async (req, res) => {
		const { apiKey } = req.body
		if (!apiKey) return res.status(400).json({ success: false, error: 'API key is required.' })

		const user = await verifyApiKey(apiKey)
		res.status(200).json({ success: true, valid: !!user })
	})

	router.get('/api/whoami', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json({ username })
	})

	router.post('/api/authenticate', authenticate, (req, res) => {
		res.status(200).json({ message: 'Authenticated' })
	})

	router.get('/api/getparttypelist', authenticate, async (req, res) => {
		res.status(200).json(partsList)
	})

	router.post('/api/runpart', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { parttype, partname, args } = req.body
		await processIPCCommand('runpart', { username, parttype, partname, args })
		res.status(200).json({ message: 'Shell command sent successfully.' })
	})

	for (const part of partsList) {
		router.get('/api/getlist/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByReq(req)
			res.status(200).json(getPartList(username, part))
		})
		router.get('/api/getloadedlist/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByReq(req)
			res.status(200).json(getLoadedPartList(username, part))
		})
		router.get('/api/getdetails/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByReq(req)
			const { name, nocache } = req.query
			const details = await getPartDetails(username, part, name, nocache)
			res.status(200).json(details)
		})
		router.get(new RegExp('^/' + part + '/'), authenticate, async (req, res, next) => {
			const { username } = await getUserByReq(req)
			const oripath = decodeURIComponent(req.path)
			const patharr = oripath.split('/')
			patharr[patharr.length - 1] ||= 'index.html'
			const partName = patharr[2]
			const realPath = part + '/' + partName + '/public/' + patharr.slice(3).join('/')
			const userPath = getUserDictionary(username) + '/' + realPath
			const publicPath = __dirname + '/src/public/' + realPath
			let path
			if (fs.existsSync(userPath)) path = userPath
			else if (fs.existsSync(publicPath)) path = publicPath
			else return next()

			if (fs.statSync(path).isDirectory()) return res.status(301).redirect(req.originalUrl.replace(oripath, oripath + '/'))
			else return res.status(200).sendFile(path)
		})
	}

	router.get('/api/getdefaultparts', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		res.status(200).json(getDefaultParts(user))
	})

	router.post('/api/setdefaultpart', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { parttype, partname } = req.body
		setDefaultPart(user, parttype, partname)
		res.status(200).json({ message: 'success' })
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
