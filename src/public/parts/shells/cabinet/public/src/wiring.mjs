/**
 * DOM 接线（工具栏、上传、快捷键、属性保存）。
 */
import { promptText } from '/scripts/features/promptDialog.mjs'

import { matchCabinetShortcut } from '../shared/keyboard.mjs'

import { api } from './api.mjs'
import { runCommand } from './commands.mjs'
import { hideContextMenu, showContextMenu } from './contextMenu.mjs'
import { uploadFiles } from './entryActions.mjs'
import { refreshCabinets, openCabinet, refreshEntries } from './navigation.mjs'
import { saveProps } from './properties.mjs'
import { cabinetStore } from './state.mjs'

/**
 * @returns {void}
 */
export function wireBootstrap() {
	/**
	 * @returns {Promise<void>} 创建个人柜并打开
	 */
	const createCabinet = async () => {
		const name = await promptText('cabinet.newCabinetPrompt')
		if (!name) return
		const visibility = await promptText('cabinet.visibilityPrompt', 'private') || 'private'
		const { cabinet } = await api('POST', '/cabinets', { name, visibility: { visibility }, type: 'personal' })
		await refreshCabinets()
		if (cabinet?.cabinet_id) await openCabinet(cabinet.cabinet_id)
	}
	for (const el of document.querySelectorAll('[data-action="new-cabinet"]'))
		el.onclick = createCabinet
	/**
	 * @param {Event} event 文件/文件夹选择变更
	 * @returns {Promise<void>}
	 */
	const onUploadChange = async event => {
		const input = /** @type {HTMLInputElement} */ event.target
		if (input.files?.length) await uploadFiles(input.files)
		input.value = ''
	}
	document.getElementById('fileInput').onchange = onUploadChange
	document.getElementById('folderInput').onchange = onUploadChange
	/**
	 * @returns {void} 切换显示隐藏项后刷新列表
	 */
	const onShowHiddenChange = () => { void refreshEntries() }
	document.getElementById('showHidden').onchange = onShowHiddenChange
	/**
	 * @returns {void} 保存属性面板
	 */
	const onPropSave = () => { void saveProps() }
	document.getElementById('propSave').onclick = onPropSave
	document.getElementById('entryGrid').addEventListener('contextmenu', event => showContextMenu(event))
	document.getElementById('statusBar').setAttribute('aria-live', 'polite')
	document.addEventListener('keydown', event => {
		if (event.key === 'Escape') hideContextMenu()
		const command = matchCabinetShortcut(event)
		if (!command) return
		event.preventDefault()
		void runCommand(command)
	})
	window.addEventListener('blur', hideContextMenu)
	window.addEventListener('pagehide', () => {
		void cabinetStore.history.dispose()
	})
}
