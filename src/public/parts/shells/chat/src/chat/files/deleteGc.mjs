/**
 * 【文件】files/deleteGc.mjs
 * 【职责】`file_delete` 事件后释放本节点分块引用，引用归零时物理删除（§10.4 本地视角）。
 * 【原理】fileMetaFromState 取删除前元数据；releaseFileStorageRefs 递减 refcount 并 unlink 孤儿块。联邦侧已复制的块由邻居各自 refcount 管理，本文件只管本节点存储插件。
 * 【数据结构】返回 { released, deleted } 计数；依赖物化 state.files 索引。
 * 【关联】groupFiles、chunkRefcount、blobStore；DAG materialize file_delete 钩子。
 */
import { fileMetaFromState, releaseFileStorageRefs } from './groupFiles.mjs'

/**
 * `file_delete` 后释放本节点分块引用并在归零时物理删除（§10.4 本地视角）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} fileId 文件 ID
 * @param {object} stateBeforeDelete 删除事件应用前的物化状态
 * @returns {Promise<{ released: number, deleted: number }>} 处理的分块数
 */
export async function releaseFileChunksAfterDelete(username, groupId, fileId, stateBeforeDelete) {
	const meta = fileMetaFromState(stateBeforeDelete, fileId)
	if (!meta) return { released: 0, deleted: 0 }
	return releaseFileStorageRefs(username, meta)
}
