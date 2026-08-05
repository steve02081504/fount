/**
 * Social composer 公共入口（薄 barrel；实现见 composerState / composerPublish）。
 */
export {
	addComposerMedia,
	clearComposer,
	initComposerVisibilityPicker,
	loadAlbumPickerOptions,
	loadDraftIntoComposer,
	loadGroupPickerOptions,
	refreshGroupRefPreview,
	refreshMediaPreview,
	refreshQuotePreview,
	setComposerAdvancedOpen,
	setComposerContentWarningOpen,
	setPendingGroupRef,
	syncGroupRefInComposer,
} from './composerState.mjs'

/**
 * 发帖与草稿相关 API（composerPublish 重导出）。
 */
export {
	buildPostBody,
	publishPost,
	saveComposerDraft,
} from './composerPublish.mjs'
