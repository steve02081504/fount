import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { handleUIError } from '../src/ui/errors.mjs'
import { getGroupState } from '../src/api/groupApi.mjs'

import { addFilesFromEvent } from './composerFiles.mjs'
import { hubStore } from './core/state.mjs'
import { openFilesDrawer, wireFilesDrawerToggle } from './files.mjs'

/**
 * @param {File} file 待上传文件
 * @param {string} [folderId] 目标文件夹 ID
 * @returns {Promise<void>}
 */
function uploadDrawerGroupFile(file, folderId) {
	return hubStore.context.fileHandlers.uploadGroupFile(file, folderId)
}

/**
 * @param {string} fileId 群文件 ID
 * @returns {Promise<void>}
 */
function downloadDrawerGroupFile(fileId) {
	const row = hubStore.context.currentState?.files?.find(f => f.fileId === fileId)
	return hubStore.context.fileHandlers.downloadGroupFile(fileId, row?.name || fileId)
}

/** @returns {Promise<object>} 刷新后的群状态 */
async function reloadDrawerGroupState() {
	hubStore.context.currentState = await getGroupState(hubStore.context.currentGroupId)
	return hubStore.context.currentState
}

/** @returns {void} */
export function wireFileEvents() {
	document.getElementById('hub-image-upload-input').addEventListener('change', async (event) => {
		const { files } = event.target
		if (!files?.length) return
		if (!hubStore.privateGroup.groupId && (!hubStore.context.currentGroupId || !hubStore.context.currentChannelId)) return
		event.target.value = ''
		try {
			if (hubStore.context.currentGroupId && hubStore.context.currentChannelId && hubStore.context.fileHandlers && files.length === 1) {
				await hubStore.context.fileHandlers.uploadGroupFile(files[0])
				return
			}
			await addFilesFromEvent({ target: { files } })
		}
		catch (err) {
			handleUIError(err, 'chat.hub.sendImageFailed')
		}
	})

	document.getElementById('hub-header-files-button').addEventListener('click', async () => {
		if (!hubStore.context.currentGroupId) {
			showToastI18n('warning', 'chat.hub.filesNoGroup')
			return
		}
		if (!hubStore.context.fileHandlers) {
			showToastI18n('warning', 'chat.hub.filesNoChannel')
			return
		}
		const filesDrawerContext = { groupId: hubStore.context.currentGroupId, state: hubStore.context.currentState }
		const fileHandlers = {
			uploadGroupFile: uploadDrawerGroupFile,
			downloadGroupFile: downloadDrawerGroupFile,
			reloadState: reloadDrawerGroupState,
		}
		await openFilesDrawer(filesDrawerContext, fileHandlers)
	})

	wireFilesDrawerToggle()
}

/**
 * @param {Event} event 点击事件
 * @returns {Promise<boolean>} 是否已处理
 */
export async function handleMessageFileDownloadClick(event) {
	const fileDownloadButton = event.target.closest('.hub-message-file-download')
	if (!fileDownloadButton?.dataset?.groupFileId || !hubStore.context.currentGroupId || !hubStore.context.fileHandlers?.downloadGroupFile)
		return false
	const fileId = fileDownloadButton.dataset.groupFileId
	const fileRow = hubStore.context.currentState?.files?.find(file => file.fileId === fileId)
	await hubStore.context.fileHandlers.downloadGroupFile(fileId, fileRow?.name || fileId)
	return true
}
