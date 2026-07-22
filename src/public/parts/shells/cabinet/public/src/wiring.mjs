/**
 * DOM 接线（工具栏、上传、快捷键、属性保存）。
 */
import { promptI18n } from '/scripts/i18n/index.mjs'

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
	/* eslint-disable jsdoc/require-jsdoc -- DOM onclick/onchange wiring */
	const createCabinet = async () => {
		const name = await promptI18n('cabinet.newCabinetPrompt')
		if (!name) return
		const visibility = await promptI18n('cabinet.visibilityPrompt', 'private') || 'private'
		const { cabinet } = await api('POST', '/cabinets', { name, visibility: { visibility }, type: 'personal' })
		await refreshCabinets()
		if (cabinet?.cabinet_id) await openCabinet(cabinet.cabinet_id)
	}
	for (const el of document.querySelectorAll('[data-action="new-cabinet"]'))
		el.onclick = createCabinet
	/**
	 * @param {Event} event change
	 * @returns {Promise<void>}
	 */
	const onUploadChange = async event => {
		const input = /** @type {HTMLInputElement} */ event.target
		if (input.files?.length) await uploadFiles(input.files)
		input.value = ''
	}
	document.getElementById('fileInput').onchange = onUploadChange
	document.getElementById('folderInput').onchange = onUploadChange
	document.getElementById('showHidden').onchange = () => void refreshEntries()
	document.getElementById('propSave').onclick = () => void saveProps()
	document.getElementById('entryGrid').addEventListener('contextmenu', event => showContextMenu(event))
	document.addEventListener('click', hideContextMenu)
	document.addEventListener('keydown', event => {
		const command = matchCabinetShortcut(event)
		if (!command) return
		event.preventDefault()
		void runCommand(command)
	})
	window.addEventListener('blur', hideContextMenu)
	window.addEventListener('pagehide', () => {
		void cabinetStore.history.dispose()
	})
	/* eslint-enable jsdoc/require-jsdoc */
}
