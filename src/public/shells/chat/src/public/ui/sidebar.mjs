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
 * 比较两个数组的差异
 * @param {Array} oldList 旧数组
 * @param {Array} newList 新数组
 * @returns {{ added: Array, removed: Array, unchanged: Array }} 包含 added, removed, unchanged 三个数组的对象
 */
function compareLists(oldList, newList) {
	const added = newList.filter(item => !oldList.includes(item))
	const removed = oldList.filter(item => !newList.includes(item))
	const unchanged = newList.filter(item => oldList.includes(item))

	return { added, removed, unchanged }
}

/**
 * 更新选择列表
 * @param {HTMLSelectElement} selectElement 选择列表元素
 * @param {string} currentName 当前选中项的名称
 * @param {Function} listGetter 获取列表数据的函数
 * @param {Function} detailsRenderer 渲染详情的函数
 * @param {boolean} forceUpdate 是否强制更新详情, 为 true 时强制更新
 */
async function updateSelectList(selectElement, currentName, listGetter, detailsRenderer, forceUpdate = false) {
	const newList = await listGetter()
	newList.unshift('') // 添加一个空选项

	const oldList = Array.from(selectElement.options).map(option => option.value)
	const { added, removed, unchanged } = compareLists(oldList, newList)

	// 删除已移除的选项
	removed.forEach(name => {
		const optionToRemove = selectElement.querySelector(`option[value="${name}"]`)
		if (optionToRemove) selectElement.removeChild(optionToRemove)
	})

	// 添加新增的选项
	added.forEach(name => {
		const option = document.createElement('option')
		option.value = name || ''
		option.text = name || '无'
		selectElement.add(option)
	})

	// 更新当前选中项 (如果需要)
	if (currentName !== selectElement.value)
		selectElement.value = currentName || ''


	// 更新详情 (仅当选中项改变或强制更新时)
	if (selectElement.value !== (selectElement.previousValue || '') || forceUpdate)
		await detailsRenderer(selectElement.value)


	selectElement.previousValue = selectElement.value
}

/**
 * 渲染世界信息列表
 */
async function renderWorldList() {
	await updateSelectList(worldSelect, worldName, getWorldList, renderWorldDetails)
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
	await updateSelectList(personaSelect, personaName, getPersonaList, renderPersonaDetails)
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
	const currentCharsRendered = Array.from(charDetailsContainer.children).map(child => child.getAttribute('data-char-name'))
	const { added, removed, unchanged } = compareLists(currentCharsRendered, charList)

	// 删除已经移除的角色
	removed.forEach(char => {
		const charCardToRemove = charDetailsContainer.querySelector(`[data-char-name="${char}"]`)
		if (charCardToRemove) {
			charDetailsContainer.removeChild(charCardToRemove)
			delete cachedDom.character[char] // 清理缓存
		}
	})

	// 添加新的角色
	for (const char of added)
		await renderCharDetails(char, data.frequency_data[char])

	// 更新已存在的角色 (如果频率数据有更新)
	for (const char of unchanged) {
		const charCard = charDetailsContainer.querySelector(`[data-char-name="${char}"]`)
		const frequencySlider = charCard.querySelector('.frequency-slider')
		const currentFrequency = parseInt(frequencySlider.value)
		const newFrequency = Math.round(data.frequency_data[char] * 100)

		if (currentFrequency !== newFrequency)
			frequencySlider.value = newFrequency
	}

	// 更新可用角色列表
	const availableChars = allChars.filter((char) => !charList.includes(char))
	const charSelectOldList = Array.from(charSelect.options).map(option => option.value)
	const { added: charSelectAdded, removed: charSelectRemoved } = compareLists(charSelectOldList, availableChars)

	charSelectRemoved.forEach(name => {
		const optionToRemove = charSelect.querySelector(`option[value="${name}"]`)
		if (optionToRemove) charSelect.removeChild(optionToRemove)
	})

	charSelectAdded.forEach(name => {
		const option = document.createElement('option')
		option.value = name
		option.text = name
		charSelect.add(option)
	})
}

/**
 * 渲染聊天角色详情
 * @param {string} charName 角色名称
 * @param {number} frequency_num
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

	// 尝试更新数据
	await renderWorldList()
	await renderPersonaList()
	await renderCharList(data)
}
