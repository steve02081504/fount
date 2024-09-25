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

	app.get(/^\/shells\//, authenticate, (req, res) => {
		const { username } = getUserByToken(req.cookies.token);
		if (fs.existsSync(__dirname + '/data/users/' + username + '/' + req.path)) {
			res.sendFile(__dirname + '/data/users/' + username + '/' + req.path);
		}
		else if (fs.existsSync(__dirname + '/src/public/' + req.path)) {
			res.sendFile(__dirname + '/src/public/' + req.path);
		}
	});
}
