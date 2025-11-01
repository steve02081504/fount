/**
 * 桌面宠物 shell 的客户端逻辑。
 */
import { initTranslations, i18nElement } from '/scripts/i18n.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { createSearchableDropdown } from '/scripts/search.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { onServerEvent } from '/scripts/server_events.mjs'
import { getPartList } from '/scripts/parts.mjs'

import {
	getRunningPetList,
	startPet,
	stopPet
} from './src/endpoints.mjs'

const charSelectDropdown = document.getElementById('char-select-dropdown')
const startPetButton = document.getElementById('start-pet-btn')
const runningPetsList = document.getElementById('running-pets-list')

let charList = []
let selectedChar = null
let runningPets = []

/**
 * 渲染角色下拉列表。
 * @returns {Promise<void>}
 */
async function renderCharDropdown() {
	i18nElement(charSelectDropdown.parentElement)
	const disabled = !charList || !charList.length
	const dataList = disabled ? [] : charList.map(name => ({ name, value: name }))

	if (selectedChar)
		charSelectDropdown.dataset.value = selectedChar
	else
		delete charSelectDropdown.dataset.value

	await createSearchableDropdown({
		dropdownElement: charSelectDropdown,
		dataList,
		textKey: 'name',
		valueKey: 'value',
		disabled,
		/**
		 * @param {object} selectedItem - 选定的项目。
		 */
		onSelect: (selectedItem) => {
			selectedChar = selectedItem ? selectedItem.value : null
			startPetButton.disabled = !selectedChar
		}
	})
}

/**
 * 渲染正在运行的宠物列表。
 * @returns {Promise<void>}
 */
async function renderRunningPets() {
	const runningPetItems = await Promise.all(runningPets.map(async (petName) => {
		const element = await renderTemplate('running_pet_item', { name: petName })
		element.querySelector('.stop-btn').addEventListener('click', () => handleStopPet(petName))
		return element
	}))

	runningPetsList.innerHTML = ''
	if (runningPetItems.length)
		runningPetItems.forEach(item => runningPetsList.appendChild(item))
	else {
		runningPetsList.innerHTML = /* html */ '<p data-i18n="deskpet.runningCard.noPets">No pets are currently running.</p>'
		i18nElement(runningPetsList)
	}
}

/**
 * 处理启动宠物的逻辑。
 * @returns {Promise<void>}
 */
async function handleStartPet() {
	if (!selectedChar) return

	startPetButton.classList.add('loading')
	startPetButton.disabled = true

	try {
		await startPet(selectedChar)
		showToastI18n('success', 'deskpet.toasts.started', { charname: selectedChar })
		await refreshRunningPets() // Keep for immediate feedback
	} catch (error) {
		console.error(error)
		showToastI18n('error', 'deskpet.toasts.start_failed', { charname: selectedChar, message: error.message })
	}

	startPetButton.classList.remove('loading')
	startPetButton.disabled = !selectedChar
}

/**
 * 处理停止宠物的逻辑。
 * @param {string} charname - 角色名称。
 * @returns {Promise<void>}
 */
async function handleStopPet(charname) {
	try {
		await stopPet(charname)
		showToastI18n('info', 'deskpet.toasts.stopped', { charname })
		await refreshRunningPets() // Keep for immediate feedback
	} catch (error) {
		console.error(error)
		showToastI18n('error', 'deskpet.toasts.stop_failed', { charname, message: error.message })
	}
}

/**
 * 刷新正在运行的宠物列表。
 * @returns {Promise<void>}
 */
async function refreshRunningPets() {
	runningPets = await getRunningPetList()
	await renderRunningPets()
}

/**
 * 获取 URL 参数。
 * @returns {URLSearchParams} - URL 参数。
 */
function getURLParams() {
	return new URLSearchParams(window.location.search)
}

/**
 * 从 URL 参数初始化。
 * @returns {Promise<void>}
 */
async function initializeFromURLParams() {
	const urlParams = getURLParams()
	const charName = urlParams.get('char')

	if (charName) {
		selectedChar = charName
		charSelectDropdown.dataset.value = charName
	}
}

/**
 * 初始化应用程序。
 * @returns {Promise<void>}
 */
async function init() {
	await applyTheme()
	await initTranslations('deskpet')
	usingTemplates('/shells/deskpet/templates')

	charList = await getPartList('chars')
	await renderCharDropdown()

	await refreshRunningPets()
	// Replace polling with event-driven updates
	onServerEvent('deskpet-list-updated', refreshRunningPets)

	await initializeFromURLParams()

	startPetButton.addEventListener('click', handleStartPet)
	startPetButton.disabled = !selectedChar
}

init()
