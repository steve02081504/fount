import { WebSocketServer } from 'npm:ws';
import { parse as parseCookie } from 'npm:cookie';
import { getUserByToken } from "./auth.mjs";

const wsss = {}

export function handleUpgrade(request, socket, head) {
	const cookies = parseCookie(request.headers.cookie || '');
	request.user = getUserByToken(cookies.accessToken)
	if (!request.user) {
		socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
		socket.destroy();
		return
	}
	const { username } = request.user
	if (!request.url.startsWith('/ws/shells/')) {
		socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
		socket.destroy();
		return
	}
	const shellName = request.url.split('/')[3]
	const wss = wsss?.[username]?.[shellName]
	if (!wss) {
		socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
		socket.destroy();
		return
	}
	console.log(`WebSocket upgrade for user ${username} shell ${shellName}`)
	wss.handleUpgrade(request, socket, head, (ws) => {
		wss.emit('connection', ws, request)
	})
}

export function getShellsWssRouter(username, shellName) {
	wsss[username] ??= {}
	return wsss[username][shellName] ??= new WebSocketServer({ noServer: true })
}

export function deleteShellsWssRouter(username, shellName) {
	wsss[username][shellName].close()
	delete wsss[username][shellName]
}
