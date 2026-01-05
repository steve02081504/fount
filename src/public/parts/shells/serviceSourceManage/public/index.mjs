/**
 * AI 源编辑器页面的主要逻辑。
 */
import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { initTranslations, i18nElement, console, geti18n, confirmI18n, promptI18n } from '../../scripts/i18n.mjs'
import { createJsonEditor } from '../../scripts/jsonEditor.mjs'
import { unlockAchievement, getPartList, getAllDefaultParts, setDefaultPart, unsetDefaultPart } from '../../scripts/parts.mjs'
import { svgInliner } from '../../scripts/svgInliner.mjs'
import { applyTheme } from '../../scripts/theme.mjs'
import { showToast, showToastI18n } from '../../scripts/toast.mjs'

import { getConfigTemplate, getServiceSourceFile, setServiceSourceFile, deleteServiceSourceFile, addServiceSourceFile, getConfigDisplay } from './src/endpoints.mjs'

const jsonEditorContainer = document.getElementById('jsonEditor')
const generatorDisplayContainer = document.getElementById('generatorDisplay')
const disabledIndicator = document.getElementById('disabledIndicator') // 获取遮罩层元素

const fileListContainer = document.getElementById('fileList')
const generatorSubtypeSelect = document.getElementById('generatorSubtypeSelect')
const generatorSelect = document.getElementById('generatorSelect')
const saveButton = document.getElementById('saveButton')
const saveStatusIcon = document.getElementById('saveStatusIcon')
const deleteButton = document.getElementById('deleteButton')
const addFileButton = document.getElementById('addFileButton')

let activeFile = null
let jsonEditor = null
let fileList = []
let generatorList = []
let isDirty = false // 标记是否有未保存的更改
let defaultParts = {} // Store default parts
let currentServiceSourcePath = 'serviceSources/AI'
let currentSubtype = 'AI'
let partBranches = {}
let desiredGeneratorName = ''
/**
 * 当JSON更新时调用的回调函数。
 * @returns {number} 返回一个数字。
 */
let onJsonUpdate = () => 0

/**
 * 创建一个统一的 fetch 错误处理函数。
 * @param {string} customMessage - 用于本地化的自定义错误消息键。
 * @returns {function(Error): void} - 接收错误对象并处理它的函数。
 */
function handleFetchError(customMessage) {
	return error => {
		console.error(geti18n(customMessage, { error: error.stack }))
		showToastI18n('error', customMessage, { error: error.stack })
		throw error // Re-throw the error to be caught by the caller if needed.
	}
}

/**
 * 拉取部件树。
 */
async function loadPartBranches() {
	try {
		partBranches = await fetch('/api/getpartbranches').then(r => r.json())
	}
	catch (error) {
		handleFetchError('serviceSource_manager.alerts.fetchBranchesFailed')(error)
		partBranches = {}
	}
}

/**
 * 获取指定路径的分支节点。
 * @param {string} path - 要查找的部件树路径
 * @returns {object | undefined} - 路径对应的节点
 */
function getBranchNode(path) {
	if (!path) return undefined
	let node = partBranches
	for (const seg of path.split('/').filter(Boolean)) {
		node = node?.[seg]
		if (!node) return undefined
	}
	return node
}

/**
 * 获取指定路径的子分支。
 * @param {string} path - 父级路径
 * @returns {string[]} - 可用的子分支名称
 */
function getBranchChildren(path) {
	const node = getBranchNode(path)
	if (!node) return []
	return Object.keys(node).sort()
}

/**
 * 路径是否存在。
 * @param {string} path - 要检查的路径
 * @returns {boolean} - 是否存在可用节点
 */
function pathExists(path) {
	return !!getBranchNode(path)
}

/**
 * 找到一个可用的路径。
 * @param {string} desired - 希望使用的路径
 * @param {string} root - 根路径前缀
 * @returns {string} - 已验证的可用路径
 */
function resolvePath(desired, root) {
	const candidate = desired && desired.startsWith(root) ? desired : ''
	if (candidate && pathExists(candidate)) return candidate
	if (pathExists(root)) {
		const [firstChild] = getBranchChildren(root)
		return firstChild ? `${root}/${firstChild}` : root
	}
	return candidate || root
}

/**
 * 根据可用分支计算有效子类型。
 * @param {string} desiredSubtype - 希望使用的子类型
 * @returns {string} - 校验后的子类型名称
 */
function resolveSubtype(desiredSubtype) {
	const subtypes = getBranchChildren('serviceGenerators')
	if (desiredSubtype && subtypes.includes(desiredSubtype)) return desiredSubtype
	if (subtypes.includes(currentSubtype)) return currentSubtype
	return subtypes[0] || desiredSubtype
}
/**
 * 从服务源路径中提取子类型。
 * @param {string} path - 待解析的路径
 * @returns {string} - 从路径中提取出的子类型
 */
function getSubtypeFromPath(path) {
	if (!path) return ''
	const segments = path.split('/').filter(Boolean)
	if (segments[0] === 'serviceSources')
		return segments[1] || ''
	return ''
}
/**
 * 渲染子类型选择器。
 * @param {string} selectedSubtype - 当前选中的子类型
 * @returns {void} - 无返回值
 */
function renderSubtypeSelect(selectedSubtype = currentSubtype) {
	const placeholder = document.createElement('option')
	placeholder.disabled = true
	placeholder.dataset.i18n = 'serviceSource_manager.subtypeSelect.placeholder'
	placeholder.selected = !selectedSubtype

	generatorSubtypeSelect.innerHTML = ''
	generatorSubtypeSelect.appendChild(placeholder)

	const subtypes = getBranchChildren('serviceGenerators')
	subtypes.forEach(subtype => {
		const option = document.createElement('option')
		option.value = subtype
		option.textContent = subtype
		if (subtype === selectedSubtype) option.selected = true
		generatorSubtypeSelect.appendChild(option)
	})

	if (!generatorSubtypeSelect.value && subtypes.length)
		generatorSubtypeSelect.value = resolveSubtype(selectedSubtype)
	i18nElement(generatorSubtypeSelect, { skip_report: true })
}

/**
 * 设置当前子类型并刷新依赖数据。
 * @param {string} nextSubtype - 希望切换的子类型
 * @returns {Promise<void>} - 刷新完成后的 Promise
 */
async function setSubtype(nextSubtype) {
	const resolved = resolveSubtype(nextSubtype)
	if (currentSubtype !== resolved) {
		activeFile = null
		isDirty = false
	}
	currentSubtype = resolved
	currentServiceSourcePath = resolvePath(`serviceSources/${resolved}`, 'serviceSources')
	renderSubtypeSelect(resolved)
	generatorSelect.value = ''
	desiredGeneratorName = ''
	generatorDisplayContainer.innerHTML = ''
	disableEditor()
	await fetchGeneratorList()
	await fetchFileList()
	await fetchDefaultParts()
}

/**
 * 从服务器获取 AI 源文件列表并渲染它们。
 * @returns {Promise<void>}
 */
async function fetchFileList() {
	fileList = await getPartList(currentServiceSourcePath).catch(handleFetchError('serviceSource_manager.alerts.fetchFileListFailed'))
	renderFileList()
}

/**
 * 从服务器获取可用的生成器列表并渲染到选择框中。
 * @returns {Promise<void>}
 */
async function fetchGeneratorList() {
	const generatorPath = resolvePath(`serviceGenerators/${currentSubtype}`, 'serviceGenerators')
	generatorList = await getPartList(generatorPath).catch(handleFetchError('serviceSource_manager.alerts.fetchGeneratorListFailed'))
	renderGeneratorSelect()
}

/**
 * 获取默认的 parts 设置并更新 UI。
 * @returns {Promise<void>}
 */
async function fetchDefaultParts() {
	defaultParts = await getAllDefaultParts().catch(handleFetchError('serviceSource_manager.alerts.fetchDefaultsFailed'))
	if (!defaultParts?.[currentServiceSourcePath] && defaultParts?.AIsources)
		defaultParts[currentServiceSourcePath] = [...defaultParts.AIsources]
	updateDefaultPartDisplay()
}

/**
 * 根据 `fileList` 变量渲染文件列表 UI。
 */
function renderFileList() {
	fileListContainer.innerHTML = ''
	fileList.forEach(fileName => {
		const listItem = document.createElement('div')
		listItem.classList.add('file-list-item')
		listItem.dataset.name = fileName // Add data-name attribute

		const p = document.createElement('p')
		p.textContent = fileName
		p.classList.add('flex-grow') // Allow text to take up space
		listItem.appendChild(p)

		// Default item checkbox
		const checkboxContainer = document.createElement('div')
		checkboxContainer.classList.add('tooltip', 'tooltip-left')
		checkboxContainer.dataset.i18n = 'serviceSource_manager.buttons.setDefault'

		const checkbox = document.createElement('input')
		checkbox.type = 'checkbox'
		checkbox.classList.add('default-checkbox', 'checkbox', 'checkbox-primary')
		Object.assign(checkbox.dataset, { fileName }) // for i18n
		i18nElement(checkboxContainer)
		checkboxContainer.appendChild(checkbox)
		listItem.appendChild(checkboxContainer)

		checkbox.addEventListener('change', async event => {
			event.stopPropagation() // Prevent click from triggering loadEditor
			const isChecked = event.target.checked

			try {
				await (isChecked ? setDefaultPart : unsetDefaultPart)(currentServiceSourcePath, fileName)

				if (isChecked) {
					(defaultParts[currentServiceSourcePath] ||= []).push(fileName)
					unlockAchievement('shells/serviceSourceManage', 'set_default_aisource')
				}
				else {
					const list = defaultParts[currentServiceSourcePath]
					const index = list?.indexOf(fileName) ?? -1
					if (index > -1) list.splice(index, 1)
				}
				updateDefaultPartDisplay()
			}
			catch (error) {
				handleFetchError('serviceSource_manager.alerts.setDefaultFailed')(error)
				event.target.checked = !isChecked
			}
		})

		// Prevent checkbox click from triggering list item click
		checkboxContainer.addEventListener('click', event => event.stopPropagation())
		listItem.addEventListener('click', () => loadEditor(fileName))
		fileListContainer.appendChild(listItem)
	})

	updateDefaultPartDisplay() // Apply styles for default item

	const urlParams = new URLSearchParams(window.location.search)
	const fileFromURL = urlParams.get('file')

	let fileToLoad = null
	if (fileFromURL && fileList.includes(fileFromURL))
		fileToLoad = fileFromURL
	else if (fileList.length)
		fileToLoad = activeFile && fileList.includes(activeFile) ? activeFile : fileList[0]

	if (fileToLoad)
		loadEditor(fileToLoad)
}

/**
 * 更新文件列表 UI 以反映哪个文件是默认文件。
 */
function updateDefaultPartDisplay() {
	const defaultPartNames = defaultParts[currentServiceSourcePath] || []
	fileListContainer.querySelectorAll('.file-list-item').forEach(el => {
		const isDefault = defaultPartNames.includes(el.dataset.name)
		el.classList.toggle('selected-item', isDefault)
		const checkbox = el.querySelector('.default-checkbox')
		if (checkbox) checkbox.checked = isDefault
	})
}

/**
 * 根据 `generatorList` 变量渲染生成器选择下拉列表。
 */
function renderGeneratorSelect() {
	const previous = generatorSelect.value
	generatorSelect.innerHTML = '<option disabled value="" data-i18n="serviceSource_manager.generatorSelect.placeholder"></option>'
	/**
	 * 确保下拉框存在指定选项。
	 * @param {string} name - 生成器名称
	 * @param {{ selected?: boolean }} [options] - 选项配置
	 * @param {boolean} [options.selected] - 是否预选该项
	 */
	const ensureOption = (name, { selected = false } = {}) => {
		if (!name) return
		if ([...generatorSelect.options].some(opt => opt.value === name)) return
		const option = document.createElement('option')
		option.value = name
		option.textContent = name
		if (selected) option.selected = true
		generatorSelect.appendChild(option)
	}

	generatorList.forEach(generator => ensureOption(generator))
	ensureOption(previous, { selected: !generatorList.length && previous })
	ensureOption(desiredGeneratorName, { selected: true })
	if (!generatorSelect.value && generatorSelect.options.length)
		generatorSelect.options[0].selected = true
}

/**
 * 从服务器获取指定生成器的配置模板。
 * @param {string} generatorName - 生成器的名称。
 * @returns {Promise<object|null>} - 配置模板对象，如果名称为空则返回 null。
 */
async function fetchConfigTemplate(generatorName) {
	if (!generatorName) return null
	return await getConfigTemplate(generatorName, activeFile, currentServiceSourcePath).catch(handleFetchError('serviceSource_manager.alerts.fetchConfigTemplateFailed'))
}

/**
 * 加载并显示指定生成器的附加 UI 和脚本。
 * @param {string} generatorName - 生成器的名称。
 * @returns {Promise<void>}
 */
async function loadGeneratorAddons(generatorName) {
	generatorDisplayContainer.innerHTML = ''
	/**
	 * 当JSON更新时调用的回调函数。
	 * @returns {number} 返回一个数字。
	 */
	onJsonUpdate = () => 0

	if (!generatorName) return

	try {
		const { html, js: displayScript } = await getConfigDisplay(generatorName, activeFile, currentServiceSourcePath)
		await initTranslations() // refresh translations for dynamic content maybe used in part i18n data
		generatorDisplayContainer.innerHTML = html
		await svgInliner(i18nElement(generatorDisplayContainer, { skip_report: true }))
		if (displayScript) {
			const partpath = 'serviceGenerators/' + currentSubtype + '/' + generatorName
			const eval_result = await async_eval(displayScript, {
				geti18n,
				partpath,
				parturl: '/parts/' + encodeURIComponent(partpath).replaceAll('%2F', ':'),
				element: generatorDisplayContainer
			})
			if (eval_result.error) throw eval_result.error
			onJsonUpdate = eval_result.result || (() => 0)
		}
	}
	catch (e) {
		console.error('Error loading or evaluating generator addons:', e)
		generatorDisplayContainer.innerHTML = /* html */ `<div class="text-error">Error loading generator display: ${e.message}</div>`
	}
}

/**
 * 禁用 JSON 编辑器并显示遮罩层。
 */
function disableEditor() {
	if (jsonEditor) jsonEditor.updateProps({ readOnly: true })
	disabledIndicator.classList.remove('hidden') // 显示遮罩
}

/**
 * 启用 JSON 编辑器并隐藏遮罩层。
 */
function enableEditor() {
	if (jsonEditor) jsonEditor.updateProps({ readOnly: false })
	disabledIndicator.classList.add('hidden') // 隐藏遮罩
}

/**
 * 更新 JSON 编辑器的内容并触发更新回调。
 * @param {object} data - 要设置到编辑器中的 JSON 数据。
 * @returns {Promise<void>}
 */
async function updateEditorContent(data) {
	if (jsonEditor) {
		jsonEditor.set({ json: data || {} })
		onJsonUpdate({
			data: data || {},
			containers: {
				generatorDisplay: generatorDisplayContainer,
				jsonEditor: jsonEditorContainer
			},
			editors: {
				json: jsonEditor
			}
		})
	}
}

/**
 * 加载指定文件的内容到编辑器中。
 * @param {string} fileName - 要加载的文件名。
 * @returns {Promise<void>}
 */
async function loadEditor(fileName) {
	if (!fileName) return

	if (isDirty && !confirmI18n('serviceSource_manager.confirm.unsavedChanges'))
		return

	const urlParams = new URLSearchParams()
	urlParams.set('file', fileName)
	urlParams.set('sourcePath', currentServiceSourcePath)
	const newURL = `${window.location.pathname}?${urlParams.toString()}`
	window.history.replaceState(null, null, newURL)

	document.querySelectorAll('.file-list-item').forEach(item => item.classList.remove('active'))
	const activeItem = fileListContainer.querySelector(`.file-list-item[data-name="${fileName}"]`)
	if (activeItem) activeItem.classList.add('active')

	activeFile = fileName
	const data = await getServiceSourceFile(fileName, currentServiceSourcePath).catch(handleFetchError('serviceSource_manager.alerts.fetchFileDataFailed'))
	const subtypeFromData = getSubtypeFromPath(currentServiceSourcePath)
	if (subtypeFromData && subtypeFromData !== currentSubtype) {
		await setSubtype(subtypeFromData)
		return loadEditor(fileName)
	}

	desiredGeneratorName = data?.generator || ''
	renderSubtypeSelect()
	renderGeneratorSelect()
	generatorSelect.value = desiredGeneratorName

	await loadGeneratorAddons(generatorSelect.value)
	if (!jsonEditor)
		jsonEditor = createJsonEditor(jsonEditorContainer, {
			label: geti18n('serviceSource_manager.configTitle'),
			/**
			 * @param {any} updatedContent - 更新后的内容。
			 * @param {any} previousContent - 之前的内容。
			 * @param {object} root0 - 根对象。
			 * @param {any} root0.error - 错误。
			 * @param {any} root0.patchResult - 补丁结果。
			 */
			onChange: (updatedContent, previousContent, { error, patchResult }) => {
				if (error) return
				isDirty = true
				let data
				try { data = jsonEditor.get() || JSON.parse(jsonEditor.get().text) } catch (e) { return }
				onJsonUpdate({
					data,
					containers: {
						generatorDisplay: generatorDisplayContainer,
						jsonEditor: jsonEditorContainer
					},
					editors: {
						json: jsonEditor
					}
				})
			},
			onSave: saveFile
		})

	if (!generatorSelect.value) {
		await updateEditorContent(data.config)
		disableEditor()
	}
	else {
		enableEditor()
		await updateEditorContent(data.config || await fetchConfigTemplate(generatorSelect.value))
	}
	isDirty = false
}


/**
 * 保存当前活动文件的更改。
 * @returns {Promise<void>}
 */
async function saveFile() {
	if (!activeFile) {
		showToastI18n('error', 'serviceSource_manager.alerts.noFileSelectedSave')
		return
	}
	if (!generatorSelect.value) {
		showToastI18n('error', 'serviceSource_manager.alerts.noGeneratorSelectedSave')
		return
	}
	// Show loading icon and disable button
	saveStatusIcon.src = 'https://api.iconify.design/line-md/loading-loop.svg'
	saveStatusIcon.classList.remove('hidden')
	saveButton.disabled = true

	try {
		const config = jsonEditor.get().json || JSON.parse(jsonEditor.get().text)
		const generator = generatorSelect.value

		await setServiceSourceFile(activeFile, {
			generator,
			config
		}, currentServiceSourcePath).catch(handleFetchError('serviceSource_manager.alerts.saveFileFailed'))
		isDirty = false

		saveStatusIcon.src = 'https://api.iconify.design/line-md/confirm-circle.svg'
	}
	catch (error) {
		showToast('error', error.message + '\n' + error.error || error.errors?.join('\n') || '')
		console.error(error)

		saveStatusIcon.src = 'https://api.iconify.design/line-md/emoji-frown.svg'
	}

	// Hide icon and re-enable button after a delay
	setTimeout(() => {
		saveStatusIcon.classList.add('hidden')
		saveButton.disabled = false
	}, 2000) // 2 seconds delay
}

/**
 * 删除当前活动文件。
 * @returns {Promise<void>}
 */
async function deleteFile() {
	if (!activeFile) {
		showToastI18n('error', 'serviceSource_manager.alerts.noFileSelectedDelete')
		return
	}
	if (!confirmI18n('serviceSource_manager.confirm.deleteFile')) return

	await deleteServiceSourceFile(activeFile, currentServiceSourcePath).catch(handleFetchError('serviceSource_manager.alerts.deleteFileFailed'))
	activeFile = null
	await fetchFileList()

	//  不清空 jsonEditor，而是禁用并清空
	if (!fileList.length) {
		updateEditorContent({})
		disableEditor()
	}
}

/**
 * 添加一个新的 AI 源文件。
 * @returns {Promise<void>}
 */
async function addFile() {
	const newFileName = promptI18n('serviceSource_manager.prompts.newFileName')
	if (!newFileName) return

	if (!isValidFileName(newFileName)) {
		showToastI18n('error', 'serviceSource_manager.alerts.invalidFileName')
		return
	}

	await addServiceSourceFile(newFileName, currentServiceSourcePath).catch(handleFetchError('serviceSource_manager.alerts.addFileFailed'))
	await fetchFileList()

	await loadEditor(newFileName)
}

/**
 * 验证文件名是否有效。
 * @param {string} fileName - 要验证的文件名。
 * @returns {boolean} - 如果文件名有效则返回 true，否则返回 false。
 */
function isValidFileName(fileName) {
	const invalidChars = /["*/:<>?\\|]/
	return !invalidChars.test(fileName)
}

// Initialization
applyTheme()
await initTranslations('serviceSource_manager')
disableEditor()
await loadPartBranches()

const urlParamsInit = new URLSearchParams(window.location.search)
await setSubtype(resolveSubtype(
	getSubtypeFromPath(urlParamsInit.get('sourcePath'))
	|| currentSubtype
))
const initialFile = urlParamsInit.get('file')
if (initialFile && fileList.includes(initialFile))
	await loadEditor(initialFile)

saveButton.addEventListener('click', saveFile)
deleteButton.addEventListener('click', deleteFile)
addFileButton.addEventListener('click', addFile)

generatorSubtypeSelect.addEventListener('change', async () => {
	await setSubtype(generatorSubtypeSelect.value)
	const url = new URL(window.location.toString())
	url.searchParams.set('sourcePath', currentServiceSourcePath)
	window.history.replaceState(null, null, url.toString())
})

generatorSelect.addEventListener('change', async () => {
	const selectedGenerator = generatorSelect.value
	desiredGeneratorName = selectedGenerator
	await loadGeneratorAddons(selectedGenerator)
	if (selectedGenerator) {
		const template = await fetchConfigTemplate(selectedGenerator)
		updateEditorContent(template)
		enableEditor()
	}
	else
		disableEditor()
})

window.addEventListener('beforeunload', event => {
	if (isDirty) {
		event.preventDefault()
		event.returnValue = geti18n('serviceSource_manager.confirm.unsavedChangesBeforeUnload')
	}
})

window.addEventListener('popstate', async () => {
	const urlParams = new URLSearchParams(window.location.search)
	const nextSubtype = resolveSubtype(
		getSubtypeFromPath(urlParams.get('sourcePath'))
		|| currentSubtype
	)
	await setSubtype(nextSubtype)
	const fileFromURL = urlParams.get('file')
	if (fileFromURL && fileList.includes(fileFromURL))
		loadEditor(fileFromURL)
})
