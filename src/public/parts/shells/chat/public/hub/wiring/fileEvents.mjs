import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { store } from '../core/state.mjs'
import { isFilesDrawerOpen, refreshFilesDrawer, setFilesDrawerOpen, wireFilesDrawerToggle } from '../files.mjs'

/** @returns {void} */
export function wireFileEvents() {
	document.getElementById('image-upload-input').addEventListener('change', async (event) => {
		const { files } = event.target
		if (!files?.length) return
		if (!store.privateGroup.groupId && (!store.context.currentGroupId || !store.context.currentChannelId)) return
		event.target.value = ''
		try {
			const { addFilesFromEvent } = await import('../composerFiles.mjs')
			if (store.context.currentGroupId && store.context.currentChannelId && store.context.fileHandlers && files.length === 1) {
				await store.context.fileHandlers.uploadGroupFile(files[0])
				return
			}
			await addFilesFromEvent({ target: { files } })
		}
		catch (err) {
			const { handleUIError } = await import('../../src/ui/errors.mjs')
			handleUIError(err, 'chat.hub.sendImageFailed')
		}
	})

	document.getElementById('header-files-button').addEventListener('click', () => {
		if (!store.context.currentGroupId) {
			showToastI18n('warning', 'chat.hub.filesNoGroup')
			return
		}
		const open = !isFilesDrawerOpen()
		setFilesDrawerOpen(open)
		if (open)
			void refreshFilesDrawer({
				groupId: store.context.currentGroupId,
				state: store.context.currentState,
				viewer: store.context.currentState?.viewer,
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
	const fileDownloadButton = event.target.closest('.message-file-download')
	if (!fileDownloadButton?.dataset?.groupFileId || !store.context.currentGroupId || !store.context.fileHandlers?.downloadGroupFile)
		return false
	const fileId = fileDownloadButton.dataset.groupFileId
	const fileRow = store.context.currentState?.files?.find(file => file.fileId === fileId)
	await store.context.fileHandlers.downloadGroupFile(fileId, fileRow?.name || fileId)
	return true
}
