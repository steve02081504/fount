import { login, register, logout, authenticate, getUserByReq, getUserDictionary, generateAccessToken } from './auth.mjs'
import { getPartDetails } from './parts_loader.mjs'
import { generateVerificationCode, verifyVerificationCode } from '../scripts/verifycode.mjs'
import { ms } from '../scripts/ms.mjs'
import { getPartList, loadPart, partsList } from './managers/index.mjs'
import { processIPCCommand } from './ipc_server.mjs'
import { is_local_ip, is_local_ip_from_req, rateLimit } from '../scripts/ratelimit.mjs'
import { hosturl } from './server.mjs'
import express from 'npm:express@^5.0.1'
import cors from 'npm:cors'
import { Readable } from 'node:stream'
import { geti18n, getLocaleData } from '../scripts/i18n.mjs'

/**
 * @param {import('npm:express').Router} router
 */
export function registerEndpoints(router) {
	// 注册路由
	router.get('/api/test/error', (req, res) => {
		throw new Error('test error')
	})
	router.get('/api/test/async_error', async (req, res) => {
		throw new Error('test error')
	})
	router.get('/api/ping', cors(), (req, res) => {
		return res.status(200).json({ message: 'pong', cilent_name: 'fount', is_local_ip: is_local_ip_from_req(req) })
	})
	router.get('/api/getlocaledata', async (req, res) => {
		const preferredLanguages = req.headers['accept-language']?.split?.(',')?.map?.((lang) => lang.trim().split(';')[0])
		if (req.cookies.accessToken) try {
			const user = await getUserByReq(req)
			user.locales = preferredLanguages
			console.log(await geti18n('fountConsole.route.setLanguagePreference', { username: user.username, preferredLanguages }))
		} catch { }

		return res.status(200).json(await getLocaleData(preferredLanguages))
	})
	router.post('/api/login', rateLimit({ maxRequests: 5, windowMs: ms('1m') }), async (req, res) => {
		const { username, password, deviceid } = req.body
		const result = await login(username, password, deviceid)
		// 在登录成功时设置 Cookie
		if (result.status === 200) {
			res.cookie('accessToken', result.accessToken, { httpOnly: true, secure: false }) // 短效
			res.cookie('refreshToken', result.refreshToken, { httpOnly: true, secure: false }) // 长效
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
				body: req.body && JSON.stringify(req.body),
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

	router.post('/api/runshell', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { shellname, args } = req.body
		await processIPCCommand('runshell', { username, shellname, args })
		res.status(200).json({ message: 'Shell command sent successfully.' })
	})

	const user_static = {}
	for (const part of partsList) {
		router.get('/api/getlist/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByReq(req)
			res.status(200).json(getPartList(username, part))
		})
		router.get('/api/getdetails/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByReq(req)
			const { name, nocache } = req.query
			const details = await getPartDetails(username, part, name, nocache)
			res.status(200).json(details)
		})
		const autoloader = async (req, res, next) => {
			const path = decodeURIComponent(req.path)
			const partName = (() => {
				let patharr = path.split('/')
				const partIndex = patharr.indexOf(part)
				patharr = patharr.slice(partIndex + 1)
				return patharr[0]
			})()
			if (!partName) return next()
			const pathext = path.split('.').pop()
			if (pathext != path && !['html', 'js', 'mjs', ''].includes(pathext)) return next() // 跳过纯资源路径
			try {
				const { username } = await getUserByReq(req)
				const loader = loadPart(username, part, partName)
				if (path.startsWith('/api/')) await loader
				else if (path.startsWith('/ws/')) await loader
			} catch (e) { }

			return next()
		}
		for (const method of ['get', 'post', 'delete', 'patch', 'put'])
			router[method](new RegExp('^/(api|ws)/' + part + '/'), authenticate, autoloader)
		router.get(new RegExp('^/' + part + '/'), authenticate, autoloader, async (req, res, next) => {
			const { username } = await getUserByReq(req)
			user_static[username] ??= express.static(getUserDictionary(username))
			return user_static[username](req, res, next)
		})
	}
}
