import { renderTemplate } from '../../../../../scripts/template.mjs'
import {
	getCharList,
	getCharDetails,
	getWorldList,
	getWorldDetails,
	getPersonaList,
	getPersonaDetails,
} from '../../../../../scripts/parts.mjs'
import { charList, worldName, personaName } from '../chat.mjs'
import { addCharacter, setPersona, setWorld, removeCharacter, triggerCharacterReply, setCharReplyFrequency } from '../endpoints.mjs'
import { appendMessage } from './messageList.mjs'
import { renderMarkdown } from '../../../../../scripts/markdown.mjs'

const worldSelect = document.getElementById('world-select')
const worldDetailsContainer = document.getElementById('world-details')
const personaSelect = document.getElementById('persona-select')
const personaDetailsContainer = document.getElementById('persona-details')
const charSelect = document.getElementById('char-select')
const charDetailsContainer = document.getElementById('char-details')
const addCharButton = document.getElementById('add-char-button')
const itemDescription = document.getElementById('item-description')
const rightSidebar = document.getElementById('right-sidebar')
const rightSidebarContainer = document.getElementById('right-sidebar-container')
const leftDrawerCheckbox = document.getElementById('left-drawer')
const leftSidebarContainer = document.getElementById('left-sidebar-container')
const chatContainer = document.querySelector('.chat-container')

// 缓存DOM
const cachedDom = {
	world: {},
	persona: {},
	character: {},
}

/**
 * 渲染世界信息列表
 */
async function renderWorldList() {
	const worlds = await getWorldList()
	worlds.unshift('') // 添加一个空选项
	worldSelect.innerHTML = worlds
		.map((world) => `<option value="${world ?? ''}" ${world === worldName ? 'selected' : ''}>${world || '无'}</option>`)
		.join('')

	await renderWorldDetails(worldName)
}

/**
 * 渲染世界信息详情
 * @param {string} worldName 世界名称
 */
async function renderWorldDetails(worldName) {
	worldDetailsContainer.innerHTML = ''
	if (!worldName) return

	let worldData
	if (!cachedDom.world[worldName]) {
		worldData = await getWorldDetails(worldName)
		if (!worldData) throw new Error(`世界 ${worldName} 不存在`)
		const worldCard = cachedDom.world[worldName] = await renderTemplate('world_info_chat_view', worldData)
		addCardEventListeners(worldCard, worldData)
	}

	if (cachedDom.world[worldName])
		worldDetailsContainer.appendChild(cachedDom.world[worldName])
}

/**
 * 渲染角色信息列表
 */
async function renderPersonaList() {
	const personas = await getPersonaList()
	personas.unshift('') // 添加一个空选项
	personaSelect.innerHTML = personas
		.map((persona) => `<option value="${persona ?? ''}" ${persona === personaName ? 'selected' : ''}>${persona || '无'}</option>`)
		.join('')

	await renderPersonaDetails(personaName)
}

/**
 * 渲染角色信息详情
 * @param {string} personaName 角色名称
 */
async function renderPersonaDetails(personaName) {
	personaDetailsContainer.innerHTML = ''
	if (!personaName) return

	let personaData
	if (!cachedDom.persona[personaName]) {
		personaData = await getPersonaDetails(personaName)
		if (!personaData) throw new Error(`用户角色 ${personaName} 不存在`)
		const personaCard = cachedDom.persona[personaName] = await renderTemplate('persona_info_chat_view', personaData)
		addCardEventListeners(personaCard, personaData)
	}

	if (cachedDom.persona[personaName])
		personaDetailsContainer.appendChild(cachedDom.persona[personaName])
}

/**
 * 渲染聊天角色列表
 */
async function renderCharList(data) {
	const allChars = await getCharList()
	const availableChars = allChars.filter((char) => !charList.includes(char))
	charSelect.innerHTML = availableChars
		.map((char) => `<option value="${char}">${char}</option>`)
		.join('')

	// 处理角色详情
	const currentCharsRendered = Array.from(charDetailsContainer.children).map(child => child.getAttribute('data-char-name'))
	// 删除已经移除的角色
	currentCharsRendered.forEach(char => {
		if (!charList.includes(char)) {
			const charCardToRemove = charDetailsContainer.querySelector(`[data-char-name="${char}"]`)
			if (charCardToRemove)
				charDetailsContainer.removeChild(charCardToRemove)
		}
	})

	// 添加新的角色
	for (const char of charList)
		if (!currentCharsRendered.includes(char))
			await renderCharDetails(char, data.frequency_data[char])

}

/**
 * 渲染聊天角色详情
 * @param {string} charName 角色名称
 */
async function renderCharDetails(charName, frequency_num) {
	let charData
	if (!cachedDom.character[charName]) {
		charData = await getCharDetails(charName)
		if (!charData) throw new Error(`角色 ${charName} 不存在`)
		const charCard = cachedDom.character[charName] = await renderTemplate('char_info_chat_view', {
			...charData.info,
			frequency_num
		})
		charCard.setAttribute('data-char-name', charName)
		addCardEventListeners(charCard, charData)
		// 添加滑动条的事件监听
		const frequencySlider = charCard.querySelector('.frequency-slider')
		frequencySlider.addEventListener('input', (event) => {
			const frequency = event.target.value / 100
			setCharReplyFrequency(charName, frequency)
		})

		// 添加移除按钮的事件监听
		const removeCharButton = charCard.querySelector('.remove-char-button')
		removeCharButton.addEventListener('click', async () => {
			await appendMessage(await removeCharacter(charName))
			charList.splice(charList.indexOf(charName), 1)
			delete cachedDom.character[charName]
			const charCardToRemove = charDetailsContainer.querySelector(`[data-char-name="${charName}"]`)
			if (charCardToRemove)
				charDetailsContainer.removeChild(charCardToRemove)
			await renderCharList()
		})

		// 添加强制回复按钮的事件监听
		const forceReplyButton = charCard.querySelector('.force-reply-button')
		forceReplyButton.addEventListener('click', async () => {
			appendMessage(await triggerCharacterReply(charName))
		})
	}

	if (cachedDom.character[charName] && !charDetailsContainer.querySelector(`[data-char-name="${charName}"]`))
		charDetailsContainer.appendChild(cachedDom.character[charName])
}

/**
 * 为卡片添加事件监听器
 * @param {HTMLElement} card 卡片元素
 * @param {object} data 卡片数据
 */
function addCardEventListeners(card, data) {
	card.addEventListener('mouseover', () => {
		displayItemDescription(data.info.description_markdown)
		showRightSidebar()
	})

	card.addEventListener('click', () => {
		displayItemDescription(data.info.description_markdown)
		showRightSidebar()
	})
}

/**
 * 显示条目描述
 * @param {string} markdown 描述的markdown内容
 */
async function displayItemDescription(markdown) {
	itemDescription.innerHTML = await renderMarkdown(markdown) || '无描述信息'
}

/**
 * 显示右侧边栏
 */
function showRightSidebar() {
	rightSidebarContainer.classList.remove('hidden')
}

/**
 * 隐藏右侧边栏
 */
function hideRightSidebar() {
	rightSidebarContainer.classList.add('hidden')
}

/**
 * 初始化侧边栏
 */
export async function setupSidebar() {
	worldSelect.addEventListener('change', async () => {
		const newWorldName = worldSelect.value === '' ? null : worldSelect.value
		await appendMessage(await setWorld(newWorldName))
		await renderWorldDetails(worldName = newWorldName)
	})

	personaSelect.addEventListener('change', async () => {
		const newPersonaName = personaSelect.value === '' ? null : personaSelect.value
		await appendMessage(await setPersona(newPersonaName))
		await renderPersonaDetails(personaName = newPersonaName)
	})

	addCharButton.addEventListener('click', async () => {
		const charName = charSelect.value
		if (charName && !charList.includes(charName)) {
			await appendMessage(await addCharacter(charName))
			charList.push(charName)
			await renderCharDetails(charName)
			await renderCharList()
		}
	})

	// 点击非右侧边栏关闭右侧边栏
	document.addEventListener('click', (event) => {
		if (!rightSidebarContainer.contains(event.target))
			hideRightSidebar()
	})

	// 鼠标移出右侧边栏区域隐藏右侧边栏
	rightSidebarContainer.addEventListener('mouseleave', () => {
		hideRightSidebar()
	})
}

export async function triggerSidebarHeartbeat(data) {
	if (!leftDrawerCheckbox.checked) return
	await renderWorldList()
	await renderPersonaList()
	await renderCharList(data)
}
