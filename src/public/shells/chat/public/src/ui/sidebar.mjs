import { geti18n } from '../../../../../scripts/i18n.mjs'
import { renderMarkdown } from '../../../../../scripts/markdown.mjs'
import {
	getCharList as getAllCharsList,
	getCharDetails,
	getWorldList,
	getWorldDetails,
	getPersonaList,
	getPersonaDetails,
	getPluginList as getAllPluginsList,
	getPluginDetails,
} from '../../../../../scripts/parts.mjs'
import { renderTemplate } from '../../../../../scripts/template.mjs'
import { charList, worldName, personaName, setCharList, setWorldName, setPersonaName, pluginList, setPluginList } from '../chat.mjs'
import { addCharacter, setPersona, setWorld, removeCharacter, triggerCharacterReply, setCharReplyFrequency, addPlugin, removePlugin } from '../endpoints.mjs'

const worldSelect = document.getElementById('world-select')
const worldDetailsContainer = document.getElementById('world-details')
const personaSelect = document.getElementById('persona-select')
const personaDetailsContainer = document.getElementById('persona-details')
const charSelect = document.getElementById('char-select')
const charDetailsContainer = document.getElementById('char-details')
const addCharButton = document.getElementById('add-char-button')
const pluginSelect = document.getElementById('plugin-select')
const pluginDetailsContainer = document.getElementById('plugin-details')
const addPluginButton = document.getElementById('add-plugin-button')
const itemDescription = document.getElementById('item-description')
const rightSidebarContainer = document.getElementById('right-sidebar-container')
const leftDrawerCheckbox = document.getElementById('left-drawer')

// 缓存DOM
const cachedDom = {
	world: {},
	persona: {},
	character: {},
	plugin: {},
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
async function updateSelectList(selectElement, currentName, listGetter, detailsRenderer, { forceUpdate = false } = {}) {
	const newList = await listGetter()
	newList.unshift('') // 添加一个空选项

	const oldList = Array.from(selectElement.options).map(option => option.value)
	const { added, removed } = compareLists(oldList, newList)

	// 删除已移除的选项
	removed.forEach(name => {
		const optionToRemove = selectElement.querySelector(`option[value="${name}"]`)
		if (optionToRemove) selectElement.removeChild(optionToRemove)
	})

	// 添加新增的选项
	added.forEach(name => {
		const option = document.createElement('option')
		option.value = name || ''
		option.text = name || geti18n('chat.sidebar.noSelection')
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
	await updateSelectList(worldSelect, worldName, getWorldList, renderWorldDetails, { forceUpdate: true })
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
		if (!worldData) return // Don't throw error, just ignore.
		const worldCard = cachedDom.world[worldName] = await renderTemplate('world_info_chat_view', {
			avatar: '',
			...worldData.info
		})
		addCardEventListeners(worldCard, worldData)
	}

	if (cachedDom.world[worldName])
		worldDetailsContainer.appendChild(cachedDom.world[worldName])
}

/**
 * 渲染角色信息列表
 */
async function renderPersonaList() {
	await updateSelectList(personaSelect, personaName, getPersonaList, renderPersonaDetails, { forceUpdate: true })
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
		if (!personaData) return
		const personaCard = cachedDom.persona[personaName] = await renderTemplate('persona_info_chat_view', personaData.info)
		addCardEventListeners(personaCard, personaData)
	}

	if (cachedDom.persona[personaName])
		personaDetailsContainer.appendChild(cachedDom.persona[personaName])
}

/**
 * 渲染聊天角色列表
 * @param {object} data - 包含角色列表和频率数据的对象。
 */
async function renderCharList(data) {
	if (!data) return
	const allChars = await getAllCharsList()
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
		if (!charCard) continue
		const frequencySlider = charCard.querySelector('.frequency-slider')
		const currentFrequency = parseInt(frequencySlider.value)
		const newFrequency = Math.round((data.frequency_data[char] ?? 0.5) * 100)

		if (currentFrequency !== newFrequency)
			frequencySlider.value = newFrequency
	}

	// 更新可用角色列表
	const availableChars = allChars.filter(char => !charList.includes(char))
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
 * @param {number} frequency_num - 角色回复频率的数值。
 */
async function renderCharDetails(charName, frequency_num) {
	let charData
	if (!cachedDom.character[charName]) {
		charData = await getCharDetails(charName)
		if (!charData) return
		const charCard = cachedDom.character[charName] = await renderTemplate('char_info_chat_view', {
			...charData.info,
			frequency_num
		})
		charCard.setAttribute('data-char-name', charName)
		addCardEventListeners(charCard, charData)
		// 添加滑动条的事件监听
		const frequencySlider = charCard.querySelector('.frequency-slider')
		frequencySlider.value = Math.round((frequency_num ?? 0.5) * 100)
		frequencySlider.addEventListener('input', event => {
			const frequency = event.target.value / 100
			setCharReplyFrequency(charName, frequency)
		})

		// 添加移除按钮的事件监听
		const removeCharButton = charCard.querySelector('.remove-char-button')
		removeCharButton.addEventListener('click', async () => {
			await removeCharacter(charName)
		})

		// 添加强制回复按钮的事件监听
		const forceReplyButton = charCard.querySelector('.force-reply-button')
		forceReplyButton.addEventListener('click', async () => {
			await triggerCharacterReply(charName)
		})
	}

	if (cachedDom.character[charName] && !charDetailsContainer.querySelector(`[data-char-name="${charName}"]`))
		charDetailsContainer.appendChild(cachedDom.character[charName])
}

/**
 * 渲染插件列表
 * @param {object} data - 包含插件列表的对象。
 */
async function renderPluginList(data) {
	if (!data) return
	const allPlugins = await getAllPluginsList()
	const currentPluginsRendered = Array.from(pluginDetailsContainer.children).map(child => child.getAttribute('data-plugin-name'))
	const { added, removed, unchanged } = compareLists(currentPluginsRendered, pluginList)

	// 删除已经移除的插件
	removed.forEach(plugin => {
		const pluginCardToRemove = pluginDetailsContainer.querySelector(`[data-plugin-name="${plugin}"]`)
		if (pluginCardToRemove) {
			pluginDetailsContainer.removeChild(pluginCardToRemove)
			delete cachedDom.plugin[plugin] // 清理缓存
		}
	})

	// 添加新的插件
	for (const plugin of added)
		await renderPluginDetails(plugin)

	// 更新可用插件列表
	const availablePlugins = allPlugins.filter(plugin => !pluginList.includes(plugin))
	const pluginSelectOldList = Array.from(pluginSelect.options).map(option => option.value)
	const { added: pluginSelectAdded, removed: pluginSelectRemoved } = compareLists(pluginSelectOldList, availablePlugins)

	pluginSelectRemoved.forEach(name => {
		const optionToRemove = pluginSelect.querySelector(`option[value="${name}"]`)
		if (optionToRemove) pluginSelect.removeChild(optionToRemove)
	})

	pluginSelectAdded.forEach(name => {
		const option = document.createElement('option')
		option.value = name
		option.text = name
		pluginSelect.add(option)
	})
}

/**
 * 渲染插件详情
 * @param {string} pluginName 插件名称
 */
async function renderPluginDetails(pluginName) {
	let pluginData
	if (!cachedDom.plugin[pluginName]) {
		pluginData = await getPluginDetails(pluginName)
		if (!pluginData) return
		const pluginCard = cachedDom.plugin[pluginName] = await renderTemplate('plugin_info_chat_view', {
			...pluginData.info
		})
		pluginCard.setAttribute('data-plugin-name', pluginName)
		addCardEventListeners(pluginCard, pluginData)

		// 添加移除按钮的事件监听
		const removePluginButton = pluginCard.querySelector('.remove-plugin-button')
		removePluginButton.addEventListener('click', async () => {
			await removePlugin(pluginName)
		})
	}

	if (cachedDom.plugin[pluginName] && !pluginDetailsContainer.querySelector(`[data-plugin-name="${pluginName}"]`))
		pluginDetailsContainer.appendChild(cachedDom.plugin[pluginName])
}

/**
 * 为卡片添加事件监听器
 * @param {HTMLElement} card 卡片元素
 * @param {object} data 卡片数据
 */
function addCardEventListeners(card, data) {
	card.addEventListener('mouseenter', () => {
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
	if (!markdown) {
		itemDescription.innerHTML = geti18n('chat.sidebar.noDescription')
		return
	}
	itemDescription.innerHTML = ''
	itemDescription.appendChild(await renderMarkdown(markdown))
}

/**
 * 显示右侧边栏
 */
function showRightSidebar() {
	rightSidebarContainer.classList.remove('sidebar-hidden')
}

/**
 * 隐藏右侧边栏
 */
function hideRightSidebar() {
	rightSidebarContainer.classList.add('sidebar-hidden')
}

/**
 * 初始化侧边栏
 */
export async function setupSidebar() {
	worldSelect.addEventListener('change', async () => {
		const newWorldName = worldSelect.value === '' ? null : worldSelect.value
		await setWorld(newWorldName)
	})

	personaSelect.addEventListener('change', async () => {
		const newPersonaName = personaSelect.value === '' ? null : personaSelect.value
		await setPersona(newPersonaName)
	})

	addCharButton.addEventListener('click', async () => {
		const charName = charSelect.value
		if (charName && !charList.includes(charName))
			await addCharacter(charName)
	})

	addPluginButton.addEventListener('click', async () => {
		const pluginName = pluginSelect.value
		if (pluginName && !pluginList.includes(pluginName))
			await addPlugin(pluginName)
	})

	// 点击非右侧边栏关闭右侧边栏
	document.addEventListener('click', event => {
		if (!rightSidebarContainer.contains(event.target))
			hideRightSidebar()
	})

	// 鼠标移出右侧边栏区域隐藏右侧边栏
	rightSidebarContainer.addEventListener('mouseleave', () => {
		hideRightSidebar()
	})
}

/**
 * 更新侧边栏显示。
 * @param {object} data - 包含世界名称、角色名称和角色列表的数据对象。
 */
export async function updateSidebar(data) {
	setCharList(data.charlist)
	setPluginList(data.pluginlist)
	setWorldName(data.worldname)
	setPersonaName(data.personaname)

	// 尝试更新数据
	await renderWorldList()
	await renderPersonaList()
	await renderCharList(data)
	await renderPluginList(data)
}

/**
 * 处理世界设置。
 * @param {string} worldname - 世界的名称。
 */
export async function handleWorldSet(worldname) {
	setWorldName(worldname)
	worldSelect.value = worldname || ''
	await renderWorldDetails(worldname)
}

/**
 * 处理角色设置。
 * @param {string} personaname - 角色的名称。
 */
export async function handlePersonaSet(personaname) {
	setPersonaName(personaname)
	personaSelect.value = personaname || ''
	await renderPersonaDetails(personaname)
}

/**
 * 处理角色添加。
 * @param {string} charname - 要添加的角色的名称。
 */
export async function handleCharAdded(charname) {
	if (charList.includes(charname)) return // Already there

	charList.push(charname)
	setCharList(charList)

	// Add to UI
	await renderCharDetails(charname, 0.5) // Assume default frequency 0.5

	// Remove from select dropdown
	const optionToRemove = charSelect.querySelector(`option[value="${charname}"]`)
	if (optionToRemove) charSelect.removeChild(optionToRemove)
}

/**
 * 处理角色移除。
 * @param {string} charname - 要移除的角色的名称。
 */
export async function handleCharRemoved(charname) {
	const index = charList.indexOf(charname)
	if (index === -1) return // Not there

	charList.splice(index, 1)
	setCharList(charList)

	// Remove from UI
	const charCardToRemove = charDetailsContainer.querySelector(`[data-char-name="${charname}"]`)
	if (charCardToRemove) {
		charDetailsContainer.removeChild(charCardToRemove)
		delete cachedDom.character[charname]
	}

	// Add back to select dropdown
	if (!charSelect.querySelector(`option[value="${charname}"]`)) {
		const option = document.createElement('option')
		option.value = charname
		option.text = charname
		charSelect.add(option)
	}
}

/**
 * 处理角色频率设置。
 * @param {string} charname - 角色的名称。
 * @param {number} frequency - 角色的回复频率。
 */
export async function handleCharFrequencySet(charname, frequency) {
	const charCard = charDetailsContainer.querySelector(`[data-char-name="${charname}"]`)
	if (!charCard) return

	const frequencySlider = charCard.querySelector('.frequency-slider')
	const newFrequency = Math.round(frequency * 100)
	if (frequencySlider.value != newFrequency)
		frequencySlider.value = newFrequency
}

/**
 * 处理插件添加。
 * @param {string} pluginname - 要添加的插件的名称。
 */
export async function handlePluginAdded(pluginname) {
	if (pluginList.includes(pluginname)) return // Already there

	pluginList.push(pluginname)
	setPluginList(pluginList)

	// Add to UI
	await renderPluginDetails(pluginname)

	// Remove from select dropdown
	const optionToRemove = pluginSelect.querySelector(`option[value="${pluginname}"]`)
	if (optionToRemove) pluginSelect.removeChild(optionToRemove)
}

/**
 * 处理插件移除。
 * @param {string} pluginname - 要移除的插件的名称。
 */
export async function handlePluginRemoved(pluginname) {
	const index = pluginList.indexOf(pluginname)
	if (index === -1) return // Not there

	pluginList.splice(index, 1)
	setPluginList(pluginList)

	// Remove from UI
	const pluginCardToRemove = pluginDetailsContainer.querySelector(`[data-plugin-name="${pluginname}"]`)
	if (pluginCardToRemove) {
		pluginDetailsContainer.removeChild(pluginCardToRemove)
		delete cachedDom.plugin[pluginname]
	}

	// Add back to select dropdown
	if (!pluginSelect.querySelector(`option[value="${pluginname}"]`)) {
		const option = document.createElement('option')
		option.value = pluginname
		option.text = pluginname
		pluginSelect.add(option)
	}
}

/**
 * Adds a part to the relevant select list in the sidebar.
 * @param {string} parttype - The type of the part (e.g., 'worlds', 'personas', 'chars').
 * @param {string} partname - The name of the part.
 */
export function addPartToSelect(parttype, partname) {
	let selectElement
	switch (parttype) {
		case 'worlds':
			selectElement = worldSelect
			break
		case 'personas':
			selectElement = personaSelect
			break
		case 'chars':
			selectElement = charSelect
			break
		case 'plugins':
			selectElement = pluginSelect
			break
		default:
			return
	}

	if (!selectElement || selectElement.querySelector(`option[value="${partname}"]`)) return

	const option = document.createElement('option')
	option.value = partname
	option.text = partname
	selectElement.add(option)
}

/**
 * Removes a part from the relevant select list and active UI in the sidebar.
 * @param {string} parttype - The type of the part (e.g., 'worlds', 'personas', 'chars').
 * @param {string} partname - The name of the part.
 */
export function removePartFromSelect(parttype, partname) {
	let selectElement
	let cacheType
	switch (parttype) {
		case 'worlds':
			selectElement = worldSelect
			cacheType = 'world'
			break
		case 'personas':
			selectElement = personaSelect
			cacheType = 'persona'
			break
		case 'chars':
			selectElement = charSelect
			cacheType = 'character'
			break
		case 'plugins':
			selectElement = pluginSelect
			cacheType = 'plugin'
			break
		default:
			return
	}

	// Remove from dropdown
	if (selectElement) {
		const optionToRemove = selectElement.querySelector(`option[value="${partname}"]`)
		if (optionToRemove) selectElement.removeChild(optionToRemove)
	}

	// If it's a char, also remove from the active list in the chat
	if (parttype === 'chars') {
		const charCardToRemove = charDetailsContainer.querySelector(`[data-char-name="${partname}"]`)
		if (charCardToRemove) charDetailsContainer.removeChild(charCardToRemove)
	}

	// Clean up cache
	if (cacheType && cachedDom[cacheType]?.[partname])
		delete cachedDom[cacheType][partname]
}
