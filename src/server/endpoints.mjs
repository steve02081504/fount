import { login, register, logout, authenticate, getUserByToken, getUserDictionary } from './auth.mjs'
import { __dirname } from './server.mjs'
import fs from 'node:fs'
import { loadShell } from './shell_manager.mjs'
import { getPartList, getPartDetails, loadPart } from './parts_loader.mjs'
import { LoadChar } from './char_manager.mjs'
import { loadPersona } from './personas_manager.mjs'
import { loadAIsource, loadAIsourceGenerator } from './AIsources_manager.mjs'
import { LoadCharTemplate } from '../public/shells/install/src/server/charTemplate_manager.mjs'
/**
 * @param {import('npm:express').Express} app
 */
export function registerEndpoints(app) {
	// 注册路由
	app.post('/api/login', async (req, res) => {
		const { username, password } = req.body
		const result = await login(username, password)
		res.cookie('token', result.token, { secure: true })
		res.status(result.status).json(result)
	})

	app.post('/api/register', async (req, res) => {
		const { username, password } = req.body
		const result = await register(username, password)
		res.status(result.status).json(result)
	})

	app.post('/api/logout', logout)

	app.post('/api/authenticate', authenticate, (req, res) => {
		res.status(200).json({ message: 'Authenticated' })
	})

	app.post('/api/setlocale', authenticate, (req, res) => {
		const user = getUserByToken(req.cookies.token)
		const { locale } = req.body
		user.locale = locale
		console.log(user.username + ' set locale to ' + locale)
		res.status(200).json({ message: 'setlocale ok' })
	})

	let partsList = [
		'shells', 'chars', 'personas', 'worlds', 'AIsources', 'AIsourceGenerators',
		'charTemplates'
	]
	let loadMethods = {
		'shells': loadShell,
		'chars': LoadChar,
		'personas': loadPersona,
		'worlds': (username, worldname) => loadPart(username, 'worlds', worldname),
		'AIsources': loadAIsource,
		'AIsourceGenerators': loadAIsourceGenerator,
		'charTemplates': LoadCharTemplate
	}

	for (const part of partsList) {
		app.get('/api/getlist/' + part, authenticate, (req, res) => {
			const { username } = getUserByToken(req.cookies.token)
			res.status(200).json(getPartList(username, part))
		})
		app.get('/api/getdetails/' + part, authenticate, async (req, res) => {
			const { username } = getUserByToken(req.cookies.token)
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
			const { username } = getUserByToken(req.cookies.token)
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
		app.get(new RegExp('^/' + part + '/'), authenticate, autoloader, (req, res) => {
			const { username } = getUserByToken(req.cookies.token)
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
