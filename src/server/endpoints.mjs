import { login, register, logout, authenticate, getUserByToken, getUserDictionary } from './auth.mjs'
import { __dirname } from './server.mjs'
import fs from 'fs'
import { loadShell } from './shell_manager.mjs'
import { getCharDetails } from './char_manager.mjs'
/**
 * @param {import('express').Express} app
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

	let get_list_of_load_able_part = partname => (req, res) => {
		const { username } = getUserByToken(req.cookies.token)
		const char_dir = getUserDictionary(username) + '/' + partname
		const charlist = fs.readdirSync(char_dir)
			.filter(file => fs.existsSync(char_dir + '/' + file + '/main.mjs'))
		res.status(200).json(charlist)
	}
	let match_user_files = (req, res) => {
		const { username } = getUserByToken(req.cookies.token)
		if (fs.existsSync(getUserDictionary(username) + '/' + req.path))
			res.sendFile(getUserDictionary(username) + '/' + req.path)

		else if (fs.existsSync(getUserDictionary(username) + '/chars/' + req.path))
			res.sendFile(getUserDictionary(username) + '/chars/' + req.path)

		else if (fs.existsSync(__dirname + '/src/public/' + req.path))
			res.sendFile(__dirname + '/src/public/' + req.path)
	}

	app.get('/api/shelllist', authenticate, get_list_of_load_able_part('shells'))
	app.get(/^\/shells\//, authenticate, async (req, res, next) => {
		const { username } = getUserByToken(req.cookies.token)
		const shellName = (() => {
			let patharr = req.path.split('/')
			let usershellpath = patharr[2] + '/' + patharr[3]
			if (fs.existsSync(getUserDictionary(username) + '/shells/' + usershellpath + '/main.mjs'))
				return usershellpath
			return patharr[2]
		})()

		try {
			await loadShell(username, shellName)
		} catch (error) {
			console.error(`Failed to load shell ${shellName}:`, error)
			return res.status(500).send('Internal Server Error')
		}

		next()
	}, match_user_files)

	app.get('/api/charlist', authenticate, get_list_of_load_able_part('chars'))
	app.post('/api/chardetails', authenticate, async (req, res) => {
		const { username } = getUserByToken(req.cookies.token)
		const charname = req.query.charname
		const details = await getCharDetails(username, charname)
		res.status(200).json(details)
	})
	app.get(/^\/chars\//, authenticate, match_user_files)

	app.get('/api/personalist', authenticate, get_list_of_load_able_part('personas'))
	app.get(/^\/personas\//, authenticate, match_user_files)

	app.get('/api/worldslist', authenticate, get_list_of_load_able_part('worlds'))
	app.get(/^\/worlds\//, authenticate, match_user_files)

	app.get('/api/AIsourceslist', authenticate, get_list_of_load_able_part('AIsources'))
	app.get(/^\/AIsources\//, authenticate, match_user_files)
}
