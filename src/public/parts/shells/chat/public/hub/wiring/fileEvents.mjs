import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { hubStore } from '../core/state.mjs'
import { isFilesDrawerOpen, refreshFilesDrawer, setFilesDrawerOpen, wireFilesDrawerToggle } from '../files.mjs'

/** @returns {void} */
export function wireFileEvents() {
	document.getElementById('hub-image-upload-input').addEventListener('change', async (event) => {
		const { files } = event.target
		if (!files?.length) return
		if (!hubStore.privateGroup.groupId && (!hubStore.context.currentGroupId || !hubStore.context.currentChannelId)) return
		event.target.value = ''
		try {
			const { addFilesFromEvent } = await import('../composerFiles.mjs')
			if (hubStore.context.currentGroupId && hubStore.context.currentChannelId && hubStore.context.fileHandlers && files.length === 1) {
				await hubStore.context.fileHandlers.uploadGroupFile(files[0])
				return
			}
			await addFilesFromEvent({ target: { files } })
		}
		catch (err) {
			const { handleUIError } = await import('../../src/ui/errors.mjs')
			handleUIError(err, 'chat.hub.sendImageFailed')
		}
	})

	document.getElementById('hub-header-files-button').addEventListener('click', () => {
		if (!hubStore.context.currentGroupId) {
			showToastI18n('warning', 'chat.hub.filesNoGroup')
			return
		}
		const open = !isFilesDrawerOpen()
		setFilesDrawerOpen(open)
		if (open)
			void refreshFilesDrawer({
				groupId: hubStore.context.currentGroupId,
				state: hubStore.context.currentState,
				viewer: hubStore.context.currentState?.viewer,
			}).catch(err => {
				void import('../../src/ui/errors.mjs').then(({ handleUIError }) => handleUIError(err))
			})
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
