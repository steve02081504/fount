import { applyTheme } from '../public/scripts/theme.mjs'

async function handleProtocol() {
	const urlParams = new URL(window.location.href)
	const protocol = urlParams.searchParams.get('url')

	if (!protocol || !protocol.startsWith('fount://')) {
		document.getElementById('message').textContent = '无效的协议'
		return
	}

	const parts = protocol.substring(8).split('/') // Remove "fount://" and split
	const command = parts[0]

	if (document.cookie.includes('accessToken')) {
		const authResponse = await fetch('/api/authenticate', {
			method: 'POST'
		})
		if (!authResponse.ok) {
			window.location.href = `/login?redirect=${encodeURIComponent(protocol)}`
			return
		}
	} else {
		window.location.href = `/login?redirect=${encodeURIComponent(protocol)}`
		return
	}

	if (command === 'runshell')
		handleRunShell(parts)
	else if (command === 'page')
		handlePage(parts)
	else
		document.getElementById('message').textContent = '未知的命令'

}

async function handleRunShell(parts) {
	if (parts.length < 3) {
		document.getElementById('message').textContent = '参数不足'
		return
	}
	const shellname = parts[1]
	const args = parts[2].split(';').map(decodeURIComponent)
	try {
		const response = await fetch('/api/runshell', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ shellname, args }),
		})

		if (response.ok)
			document.getElementById('message').textContent = 'Shell 命令已发送'
		else
			document.getElementById('message').textContent = '发送 Shell 命令失败'

	} catch (error) {
		console.error('Error sending shell command:', error)
		document.getElementById('message').textContent = '发送 Shell 命令时出错'
	}
	setTimeout(() => {
		window.location.href = '/home'
	}, 1000)
}

function handlePage(parts) {
	if (parts.length < 2) {
		document.getElementById('message').textContent = '参数不足'
		return
	}
	parts.shift()
	window.location.href = `/${parts.join('/')}`
}

applyTheme()
handleProtocol()
