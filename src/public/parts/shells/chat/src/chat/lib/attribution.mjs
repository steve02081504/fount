/**
 * 【文件】attribution.mjs
 * 【职责】消息密码学归因：复用 shared 推导，并提供主人指令可信判定。
 * 【关联】channelArchive、hydration、prompt_struct、ChatClient Message、Hub UI。
 */
export { deriveMessageAttribution } from '../../../public/shared/attribution.mjs'

/**
 * 消息是否可作为可信主人指令（密码学作者 === 声明主人，且无 attribution mismatch）。
 * @param {{ trusted?: boolean, mismatch?: boolean }} attribution 归因
 * @param {string | null | undefined} authorEntityHash 实际签名作者实体
 * @param {string | null | undefined} declaredOwnerEntityHash agent 声明主人
 * @returns {boolean} 是否可信主人消息
 */
export function isTrustedOwnerAttribution(attribution, authorEntityHash, declaredOwnerEntityHash) {
	const owner = String(declaredOwnerEntityHash || '').trim().toLowerCase()
	const author = String(authorEntityHash || '').trim().toLowerCase()
	if (!owner || !author) return false
	if (!attribution?.trusted || attribution.mismatch) return false
	return author === owner
}
