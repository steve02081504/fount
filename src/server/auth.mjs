import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { config, save_config } from './server.mjs';

/**
 * 通过用户名获取用户信息
 */
function getUserByUsername(username) {
	return config.data.users[username];
}

/**
 * 创建新用户
 */
function createUser(username, hashedPassword) {
	config.data.users[username] = {
		username,
		password: hashedPassword,
		loginAttempts: 0, // 初始化登录尝试次数
		lockedUntil: null // 初始化锁定时间
	};
	save_config();
	return config.data.users[username];
}

/**
 * 验证密码
 */
async function verifyPassword(password, hashedPassword) {
	return await bcrypt.compare(password, hashedPassword);
}

/**
 * 生成 JWT
 */
function generateToken(payload) {
	return jwt.sign(payload, config.secretKey);
}

export function getUserByToken(token) {
	if (!token) {
		return null;
	}
	try {
		const decoded = jwt.verify(token, config.secretKey);
		return config.data.users[decoded.username];
	} catch (error) {
		console.error(error);
		return null;
	}
}

/**
 * 用户登录
 */
async function login(username, password) {
	try {
		const user = getUserByUsername(username);
		if (!user) {
			return { status: 404, message: 'User not found' };
		}

		// 检查账户是否被锁定
		if (user.lockedUntil && user.lockedUntil > Date.now()) {
			return { status: 403, message: 'Account locked' };
		}

		const isValidPassword = await verifyPassword(password, user.password);
		if (!isValidPassword) {
			// 登录失败，增加登录尝试次数
			user.loginAttempts++;
			if (user.loginAttempts >= 3) {
				// 超过 3 次锁定账户 10 分钟
				user.lockedUntil = Date.now() + 10 * 60 * 1000;
			}
			return { status: 401, message: 'Invalid password' };
		}

		// 登录成功，重置登录尝试次数
		user.loginAttempts = 0;

		const token = generateToken({ username: user.username });
		return { status: 200, message: 'Login successful', token };
	} catch (error) {
		console.error(error);
		return { status: 500, message: 'Internal server error' };
	}
}

/**
 * 用户注册
 */
async function register(username, password) {
	try {
		const existingUser = getUserByUsername(username);
		if (existingUser) {
			return { status: 409, message: 'Username already exists' };
		}

		// 对密码进行加密
		const saltRounds = 10;
		const hashedPassword = await bcrypt.hash(password, saltRounds);

		const newUser = createUser(username, hashedPassword);

		return { status: 201, user: newUser };
	} catch (error) {
		console.error(error);
		return { status: 500, message: 'Internal server error' };
	}
}

/**
 * 用户登出
 */
function logout(req, res) {
	res.clearCookie('token');
	res.status(200).json({ message: 'Logout successful' });
}

/**
 * 身份验证中间件
 */
function authenticate(req, res, next) {
	const token = req.cookies.token;
	if (!token) {
		return res.status(401).json({ message: 'Unauthorized' });
	}

	return jwt.verify(token, config.secretKey, (err, decoded) => {
		if (err) {
			return res.status(401).json({ message: 'Invalid token' });
		}
		req.user = decoded; // 将用户信息存储在 req 对象中
		next();
	});
}

// 导出函数
export { login, register, logout, authenticate };
