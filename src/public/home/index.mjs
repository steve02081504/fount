import { renderTemplate } from '../scripts/template.mjs'
import { getCharDetails, getCharList } from '../scripts/chars.mjs'
import { renderMarkdown } from './markdown.mjs'

const roleContainer = document.getElementById('role-container')
const characterDescription = document.getElementById('character-description')

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
	roleElement.dataset.charname = charDetails.name

	// 添加悬浮事件监听
	roleElement.addEventListener('mouseover', () => {
		displayCharacterInfo(charDetails)
	})

	return roleElement
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

function displayCharacterInfo(charDetails) {
	characterDescription.innerHTML = renderMarkdown(charDetails.description_markdown) || '无描述信息'
}

// 初始化
function initializeApp() {
	setTheme()
	displayCharList()
}

initializeApp()
