import { renderTemplate } from '../scripts/template.mjs'
import { getCharDetails, getCharList } from '../scripts/chars.mjs'
import { renderMarkdown } from '../scripts/markdown.mjs'

const roleContainer = document.getElementById('role-container')
const characterDescription = document.getElementById('character-description')
const drawerToggle = document.getElementById('my-drawer-2')

// 设置主题
function setTheme() {
	const prefersDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
	document.documentElement.setAttribute('data-theme', prefersDarkMode ? 'dark' : 'light')
}

async function renderCharView(charDetails) {
	const html = await renderTemplate('char_list_view', charDetails)
	const roleElement = document.createElement('div')
	roleElement.innerHTML = html
	roleElement.classList.add('role-card')

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
			console.log(`删除角色 ${charDetails.name}`)
		})
	}
}

async function displayCharacterInfo(charDetails) {
	characterDescription.innerHTML = await renderMarkdown(charDetails.description_markdown) || '无描述信息'
}

// 初始化
async function initializeApp() {
	setTheme()
	try {
		await setLocale(navigator.language || navigator.userLanguage)
	}
	catch (error) {
		// jump to login page
		window.location = '/login'
	}
	displayCharList()
}

initializeApp()
