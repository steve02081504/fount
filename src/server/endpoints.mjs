import { login, register, logout, authenticate, getUserByToken } from './auth.mjs';
import fs from 'fs';
import { __dirname } from './server.mjs';
/**
 * @param {import('express').Express} app
 */
export function registerEndpoints(app) {
	// 注册路由
	app.post('/api/login', async (req, res) => {
		const { username, password } = req.body;
		const result = await login(username, password);
		res.cookie('token', result.token, { secure: true });
		res.status(result.status).json(result);
	});

	app.post('/api/register', async (req, res) => {
		const { username, password } = req.body;
		const result = await register(username, password);
		res.status(result.status).json(result);
	});

	app.post('/api/logout', logout);

	app.post('/api/authenticate', authenticate, (req, res) => {
		res.status(200).json({ message: 'Authenticated' });
	});

	let get_list_of_load_able_part = partname => (req, res) => {
		const { username } = getUserByToken(req.cookies.token);
		const char_dir = __dirname + '/data/users/' + username + '/' + partname
		const charlist = fs.readdirSync(char_dir)
			.filter(file => fs.existsSync(char_dir + '/' + file + '/main.mjs'));
		res.status(200).json(charlist);
	}
	let match_user_files = (req, res) => {
		const { username } = getUserByToken(req.cookies.token);
		if (fs.existsSync(__dirname + '/data/users/' + username + '/' + req.path)) {
			res.sendFile(__dirname + '/data/users/' + username + '/' + req.path);
		}
		else if (fs.existsSync(__dirname + '/src/public/' + req.path)) {
			res.sendFile(__dirname + '/src/public/' + req.path);
		}
	}

	app.get('/api/shelllist', authenticate, get_list_of_load_able_part('shells'));
	app.get(/^\/shells\//, authenticate, match_user_files);

	app.get('/api/charlist', authenticate, get_list_of_load_able_part('chars'));
	app.get(/^\/chars\//, authenticate, match_user_files);

	app.get('/api/personalist', authenticate, get_list_of_load_able_part('personas'));
	app.get(/^\/personas\//, authenticate, match_user_files);

	app.get('/api/worldslist', authenticate, get_list_of_load_able_part('worlds'));
	app.get(/^\/worlds\//, authenticate, match_user_files);

	app.post(/^\/api\/AI\//, authenticate, (req, res) => {
		const { username } = getUserByToken(req.cookies.token);
		const ai_name = req.path.split('/')[2];
		const ai_code = __dirname + '/data/users/' + username + '/AIsources/' + ai_name + '/main.mjs';
		if (fs.existsSync(ai_code)) {
			import(ai_code).then((module) => {
				module.default(req.body);
			})
		}
	});
}