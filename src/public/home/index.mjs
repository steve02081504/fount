import { renderTemplate } from '../scripts/template.mjs'
import { getCharDetails, getCharList } from '../scripts/parts.mjs'
import { renderMarkdown } from '../scripts/markdown.mjs'
import { applyTheme } from "../scripts/theme.mjs"

const roleContainer = document.getElementById('role-container')
const characterDescription = document.getElementById('character-description')
const drawerToggle = document.getElementById('my-drawer-2')
const importButton = document.getElementById('import-button')

async function renderCharView(charDetails) {
	const roleElement = await renderTemplate('char_list_view', charDetails)

	// 移动端点击卡片非按钮区域时显示侧边栏
	roleElement.addEventListener('click', (event) => {
		if (window.innerWidth < 1024 && !event.target.closest('button')) {
			displayCharacterInfo(charDetails)
			drawerToggle.checked = true
		}
	})

	// 桌面端添加悬浮事件监听
	roleElement.addEventListener('mouseover', () => {
		if (window.innerWidth >= 1024)
			displayCharacterInfo(charDetails)

	})

	return roleElement
}

async function displayCharacterInfo(charDetails) {
	characterDescription.innerHTML = await renderMarkdown(charDetails.description_markdown) || '无描述信息'
}

async function setLocale(locale) {
	const response = await fetch('/api/setlocale', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ locale }),
	})

	const data = await response.json()

	if (response.ok)
		console.log(data.message)
	else
		throw new Error(data.message)
}

async function displayCharList() {
	const charList = await getCharList()
	roleContainer.innerHTML = ''

	for (const char of charList) {
		const charDetails = await getCharDetails(char)
		const roleElement = await renderCharView(charDetails)
		roleContainer.appendChild(roleElement)

		const chatButton = roleElement.querySelector('.chat-button')
		chatButton.addEventListener('click', () => {
			console.log(`开始与 ${charDetails.name} 聊天`)
			window.location = `/shells/chat/new?charname=${char}`
		})

		const deleteButton = roleElement.querySelector('.delete-button')
		deleteButton.addEventListener('click', () => {
			// TODO: 发送删除角色请求
			if (confirm(`确定要删除角色 ${charDetails.name} 吗?`))
				alert('逻辑未完成')
		})
	}
}

// 初始化
async function initializeApp() {
	applyTheme()
	try {
		await setLocale(navigator.language || navigator.userLanguage)
	}
	catch (error) {
		// jump to login page
		window.location = '/login'
	}
	displayCharList()
	importButton.addEventListener('click', () => {
		window.location = '/shells/install'
	})
}

initializeApp()
