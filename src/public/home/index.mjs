import { renderTemplate } from '../scripts/template.mjs'
import { getCharDetails, getCharList } from '../scripts/chars.mjs'

async function renderCharView(charDetails) {
	const html = await renderTemplate('char_list_view', charDetails)
	const roleElement = document.createElement('div')
	roleElement.innerHTML = html

	return roleElement
}
export async function displayCharList() {
	const charList = await getCharList()
	const roleContainer = document.querySelector('.role-container')
	roleContainer.innerHTML = '' // 清空容器

	for (const char of charList) {
		const charDetails = await getCharDetails(char)
		const roleElement = await renderCharView(charDetails)
		roleContainer.appendChild(roleElement)

		// 添加按钮事件监听
		const chatButton = roleElement.querySelector('.role-btns button:first-of-type')
		chatButton.addEventListener('click', () => {
			console.log(`开始与 ${charDetails.name} 聊天`)
			window.location = `/shells/chat/new?charname=${char}`
		})

		const deleteButton = roleElement.querySelector('.role-btns button:last-of-type')
		deleteButton.addEventListener('click', () => {
			// TODO: 发送删除角色请求
			console.log(`删除角色 ${charDetails.name}`)
		})
	}
}

displayCharList()
