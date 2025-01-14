import { login, register, logout, authenticate, getUserByToken, getUserDictionary } from './auth.mjs'
import { __dirname } from './server.mjs'
import fs from 'node:fs'
import { loadShell } from './managers/shell_manager.mjs'
import { getPartList, getPartDetails } from './parts_loader.mjs'
import { LoadChar } from './managers/char_manager.mjs'
import { loadPersona } from './managers/personas_manager.mjs'
import { loadAIsource, loadAIsourceGenerator } from './managers/AIsources_manager.mjs'
import { LoadImportHanlder } from '../public/shells/install/src/server/importHanlder_manager.mjs'
import { loadWorld } from "./managers/world_manager.mjs"
import { generateVerificationCode, verifyVerificationCode } from "../scripts/verifycode.mjs"
import { ms } from "../scripts/ms.mjs"
/**
 * @param {import('npm:express').Express} app
 */
export function registerEndpoints(app) {
	// 注册路由
	app.post('/api/login', async (req, res) => {
		const { username, password, deviceid } = req.body
		const result = await login(username, password, deviceid)
		// 在登录成功时设置 Cookie
		if (result.status === 200) {
			res.cookie('accessToken', result.accessToken, { httpOnly: true, secure: false }) // 短效
			res.cookie('refreshToken', result.refreshToken, { httpOnly: true, secure: false }) // 长效
		}
		res.status(result.status).json(result)
	})

	app.post('/api/register/generateverificationcode', async (req, res) => {
		// get ip
		const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
		generateVerificationCode(ip)
		res.status(200).json({ message: 'verification code generated' })
	})
	let regrquesttimes = []
	const registerRequestLimit = 5
	const registerRequestInterval = ms('1m')
	app.post('/api/register', async (req, res) => {
		const { username, password, verificationcode } = req.body
		const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress
		regrquesttimes = regrquesttimes.filter(entry => entry.time > Date.now())
		regrquesttimes.push({ ip, time: Date.now() + registerRequestInterval })
		if (regrquesttimes.filter(entry => entry.ip === ip).length > registerRequestLimit) {
			res.status(429).json({ message: 'Too many requests' })
			return
		}
		if (verifyVerificationCode(verificationcode, ip) === false) {
			res.status(401).json({ message: 'verification code incorrect' })
			return
		}
		const result = await register(username, password)
		res.status(result.status).json(result)
	})

	app.post('/api/logout', logout)

	app.post('/api/authenticate', authenticate, (req, res) => {
		res.status(200).json({ message: 'Authenticated' })
	})

	app.post('/api/setlocale', authenticate, async (req, res) => {
		const user = await getUserByToken(req.cookies.accessToken)
		const { locale } = req.body
		user.locale = locale
		console.log(user.username + ' set locale to ' + locale)
		res.status(200).json({ message: 'setlocale ok' })
	})

	let partsList = [
		'shells', 'chars', 'personas', 'worlds', 'AIsources', 'AIsourceGenerators',
		'ImportHanlders'
	]
	let loadMethods = {
		'shells': loadShell,
		'chars': LoadChar,
		'personas': loadPersona,
		'worlds': loadWorld,
		'AIsources': loadAIsource,
		'AIsourceGenerators': loadAIsourceGenerator,
		'ImportHanlders': LoadImportHanlder
	}

	for (const part of partsList) {
		app.get('/api/getlist/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByToken(req.cookies.accessToken)
			res.status(200).json(getPartList(username, part))
		})
		app.get('/api/getdetails/' + part, authenticate, async (req, res) => {
			const { username } = await getUserByToken(req.cookies.accessToken)
			const name = req.query.name
			const details = await getPartDetails(username, part, name)
			res.status(200).json(details)
		})
		let autoloader = async (req, res, next) => {
			// skip if path is just png/jpg etc
			{
				let pathext = req.path.split('.').pop()
				if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'css'].includes(pathext)) return next()
			}
			const { username } = await getUserByToken(req.cookies.accessToken)
			const partName = (() => {
				let patharr = req.path.split('/')
				let partIndex = patharr.indexOf(part)
				patharr = patharr.slice(partIndex + 1)
				return patharr[0]
			})()

			try {
				await loadMethods[part](username, partName)
			} catch (error) {
				console.error(`Failed to load part ${partName}:`, error)
				return res.status(500).send('Internal Server Error')
			}

			next()
		}
		app.post(new RegExp('^/api/' + part + '/'), authenticate, autoloader)
		app.get(new RegExp('^/' + part + '/'), authenticate, autoloader, async (req, res) => {
			const { username } = await getUserByToken(req.cookies.accessToken)
			let path = req.path
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
