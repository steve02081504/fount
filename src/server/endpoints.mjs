import { login, register, logout, authenticate, getUserByToken, getUserDictionary } from './auth.mjs'
import { __dirname } from './server.mjs'
import fs from 'node:fs'
import { getPartDetails } from './parts_loader.mjs'
import { generateVerificationCode, verifyVerificationCode } from '../scripts/verifycode.mjs'
import { ms } from '../scripts/ms.mjs'
import { getPartList, loadPart, partsList } from './managers/index.mjs'
import { IPCManager } from './ipc_server.mjs'
import { is_local_ip, rateLimit } from '../scripts/ratelimit.mjs'
import { loadJsonFile } from '../scripts/json_loader.mjs'

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
	router.post('/api/setlocale', authenticate, async (req, res) => {
		const user = await getUserByToken(req.cookies.accessToken)
		const { locale } = req.body
		user.locale = locale
		console.log(user.username + ' set locale to ' + locale)
		res.status(200).json({ message: 'setlocale ok' })
	})
	const localeCache = {}
	router.get('/api/getlocaledata', async (req, res) => {
		let locale
		try {
			const user = await getUserByToken(req.cookies.accessToken)
			locale = user?.locale
		} catch (e) { }
		locale ??= 'en-UK'

		// if (localeCache[locale]) return res.status(200).json(localeCache[locale])

		const localeList = fs.readdirSync(__dirname + '/src/locale').filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5))
		let result

		if (localeList.includes(locale)) result = locale
		result ??= localeList.find((name) => name.startsWith(locale.split('-')[0])) // 确保 locale 不是 undefined
		result ??= 'en-UK'

		res.status(200).json(localeCache[locale] = loadJsonFile(__dirname + `/src/locale/${result}.json`))
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

	router.post('/api/authenticate', authenticate, (req, res) => {
		res.status(200).json({ message: 'Authenticated' })
	})

	router.get('/api/getparttypelist', authenticate, async (req, res) => {
		res.status(200).json(partsList)
	})

	router.post('/api/runshell', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { shellname, args } = req.body
		await IPCManager.sendCommand('runshell', { username, shellname, args })
		res.status(200).json({ message: 'Shell command sent successfully.' })
	})

	for (const part of partsList) {
		router.get('/api/getlist/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByToken(req.cookies.accessToken)
			res.status(200).json(getPartList(username, part))
		})
		router.get('/api/getdetails/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByToken(req.cookies.accessToken)
			const { name, nocache } = req.query
			const details = await getPartDetails(username, part, name, nocache)
			res.status(200).json(details)
		})
		const autoloader = async (req, res, next) => {
			const path = decodeURIComponent(req.path)
			{
				const pathext = path.split('.').pop()
				if (pathext != path && !['js', 'html'].includes(pathext)) return next() // 跳过纯资源路径
			}
			const { username } = await getUserByToken(req.cookies.accessToken)
			const partName = (() => {
				let patharr = path.split('/')
				const partIndex = patharr.indexOf(part)
				patharr = patharr.slice(partIndex + 1)
				return patharr[0]
			})()

			await loadPart(username, part, partName)

			next()
		}
		router.post(new RegExp('^/api/' + part + '/'), authenticate, autoloader)
		router.get(new RegExp('^/' + part + '/'), authenticate, autoloader, async (req, res) => {
			const { username } = await getUserByToken(req.cookies.accessToken)
			let path = decodeURIComponent(req.path)
			if (path.endsWith('/')) path += '/index.html'
			if (fs.existsSync(getUserDictionary(username) + '/' + path))
				res.sendFile(getUserDictionary(username) + '/' + path)

			else if (fs.existsSync(getUserDictionary(username) + '/chars/' + path))
				res.sendFile(getUserDictionary(username) + '/chars/' + path)

			else if (fs.existsSync(__dirname + '/src/public/' + path))
				res.sendFile(__dirname + '/src/public/' + path)
		})
	}
}
