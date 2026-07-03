/**
 * 【文件】files/groupFiles.mjs
 * 【职责】群文件子系统 barrel：领域逻辑 re-export，路由见 group/routes/groupFilesRoutes.mjs。
 */
export {
	putEncryptedChunk,
	registerEncryptedChunkIfPresent,
	getDecryptedFile,
	getDecryptedChunk,
	fileMetaFromState,
	listActiveFilesFromState,
	releaseFileStorageRefs,
	syncGroupFileManifest,
	assertFileUploadBody,
	normalizeCeMode,
	parseChunkBody,
	uploadPermissionChannelId,
} from './groupFilesOps.mjs'
