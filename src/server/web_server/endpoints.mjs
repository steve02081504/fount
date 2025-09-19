import fs from 'node:fs'
import { Readable } from 'node:stream'

import cors from 'npm:cors'

import { console, getLocaleData, fountLocaleList } from '../../scripts/i18n.mjs'
import { ms } from '../../scripts/ms.mjs'
import { get_hosturl_in_local_ip, is_local_ip, is_local_ip_from_req, rateLimit } from '../../scripts/ratelimit.mjs'
import { generateVerificationCode, verifyVerificationCode } from '../../scripts/verifycode.mjs'
import { login, register, logout, authenticate, getUserByReq, getUserDictionary, generateAccessToken, auth_request, generateApiKey, revokeApiKey } from '../auth.mjs'
import { __dirname } from '../base.mjs'
import { processIPCCommand } from '../ipc_server/index.mjs'
import { partsList } from '../managers/base.mjs'
import { getLoadedPartList, getPartList } from '../managers/index.mjs'
import { getDefaultParts, getPartDetails, setDefaultPart } from '../parts_loader.mjs'
import { hosturl, skip_report, currentGitCommit, config, save_config } from '../server.mjs'

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

	router.get('/api/getlocaledata', async (req, res) => {
		const browserLanguages = req.headers['accept-language']?.split?.(',')?.map?.(lang => lang.trim().split(';')[0]) || []
		const userPreferredLanguages = req.query.preferred?.split?.(',')?.map?.(lang => lang.trim()) || []

		// 合并语言列表，用户设置的优先，然后去重
		const preferredLanguages = [...new Set([...userPreferredLanguages, ...browserLanguages])].filter(Boolean)

		if (req.cookies.accessToken) try {
			const user = await getUserByReq(req)
			user.locales = preferredLanguages
			console.logI18n('fountConsole.route.setLanguagePreference', { username: user.username, preferredLanguages: preferredLanguages.join(', ') })
		} catch { }

		return res.status(200).json(await getLocaleData(preferredLanguages))
	})

	router.get('/api/getavailablelocales', async (req, res) => {
		res.status(200).json(fountLocaleList)
	})

	router.post('/api/login', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		const { username, password, deviceid } = req.body
		const result = await login(username, password, deviceid, req)
		// 在登录成功时设置 Cookie
		if (result.status === 200) {
			res.cookie('accessToken', result.accessToken, { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https' }) // 短效
			res.cookie('refreshToken', result.refreshToken, { httpOnly: true, secure: req.secure || req.headers['x-forwarded-proto'] === 'https' }) // 长效
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
		if (!is_local_ip(ip))
			if (verifyVerificationCode(verificationcode, ip) === false) {
				res.status(401).json({ message: 'verification code incorrect' })
				return
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
		res.status(200).json(user.auth.apiKeys || [])
	})

	router.post('/api/apikey/revoke', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { jti } = req.body
		if (!jti) return res.status(400).json({ success: false, error: 'JTI of the key to revoke is required.' })

		const result = await revokeApiKey(user.username, jti)
		res.status(result.success ? 200 : 404).json(result)
	})

	router.get('/api/whoami', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json({ username })
	})

	router.all(/asuser\/([^/]*)\/(.*)/, async (req, res) => {
		if (!is_local_ip_from_req(req))
			return res.status(403).send('Access allowed only from local IP.')
		try {
			const username = req.params[0]
			const targetPathAndQuery = req.params[1]
			const targetUrl = hosturl + '/' + targetPathAndQuery

			console.log(`AsUser: Forwarding request for user '${username}' to: ${targetUrl}`)

			const accessToken = await generateAccessToken({ username })

			const forwardedHeaders = {
				...req.headers,
				'cookie': `accessToken=${accessToken}; ${Object.entries(req.cookies || {}).map(([k, v]) => `${k}=${v}`).join('; ')}`,
				'x-forwarded-for': req.headers['x-forwarded-for'] || req.socket.remoteAddress,
			}
			delete forwardedHeaders.host

			const response = await fetch(targetUrl, {
				method: req.method,
				headers: forwardedHeaders,
				body: req.method == 'GET' ? undefined : req.body && JSON.stringify(req.body),
				redirect: 'manual'
			})

			response.headers.forEach((value, name) => {
				res.setHeader(name, value)
			})

			res.status(response.status)
			if (response.body) {
				const nodeReadableStream = Readable.fromWeb(response.body)
				nodeReadableStream.pipe(res)
			}
			else
				res.end()
		} catch (error) {
			console.error(`AsUser: Proxy Error for ${req.method} ${req.originalUrl}:`, error)
			if (!res.headersSent)
				res.status(502).send('Bad Gateway: Error forwarding request.')
			else
				res.socket.destroy()
		}
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
