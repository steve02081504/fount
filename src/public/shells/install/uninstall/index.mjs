// 获取 URL 参数
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

// API 请求函数
async function uninstallPart(type, name) {
	const response = await fetch(`/api/shells/install/uninstall?type=${type}&name=${name}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ type, name }),
	})

	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || `HTTP error! status: ${response.status}`)
	}

	return await response.json()
}

// 显示信息
function showMessage(message, type = 'info') {
	const messageElement = document.getElementById('message-content')
	const infoMessage = document.getElementById('info-message')
	const errorElement = document.getElementById('error-content')
	const errorMessage = document.getElementById('error-message')
	if (type === 'info') {
		messageElement.textContent = message
		infoMessage.style.display = 'flex'
		errorMessage.style.display = 'none'
	}
	else if (type === 'error') {
		errorElement.textContent = message
		errorMessage.style.display = 'flex'
		infoMessage.style.display = 'none'
	}
}
// 隐藏信息
function hideMessage() {
	document.getElementById('info-message').style.display = 'none'
	document.getElementById('error-message').style.display = 'none'
}

document.addEventListener('DOMContentLoaded', async () => {
	const urlParams = getURLParams()
	const type = urlParams.get('type')
	const name = urlParams.get('name')
	const uninstallMessage = document.getElementById('uninstall-message')
	const title = document.getElementById('title')
	const confirmButton = document.getElementById('confirm-uninstall')

	if (type && name) {
		title.textContent = `卸载 ${type}/${name}`
		uninstallMessage.textContent = `您确定要卸载 ${type}: ${name} 吗？`

		confirmButton.addEventListener('click', async () => {
			hideMessage()
			try {
				const result = await uninstallPart(type, name)
				showMessage(result.message || `成功卸载 ${type}: ${name}`, 'info')
				confirmButton.disabled = true // 卸载成功后禁用按钮
			} catch (error) {
				showMessage(`卸载失败: ${error.message}`, 'error')
			}
		})
	} else {
		title.textContent = '参数无效'
		showMessage('无效的请求参数。', 'error')
	}
})
