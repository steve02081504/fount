/**
 * 【文件】public/hub/banScopePicker.mjs
 * 【职责】成员封禁范围选择模态：在「封禁实体」与「封禁节点」之间让用户确认一次选择。
 * 【原理】`pickBanScope` 弹出 `hub/nav/ban_scope_modal` 对话框并返回用户选择或取消。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/features/dialog.mjs、../../../../scripts/features/template.mjs
 */
import { pickFromDialog } from '../../../../scripts/features/dialog.mjs'
import { usingTemplates } from '../../../../scripts/features/template.mjs'

/** @typedef {'entity' | 'node'} BanScope */

/**
 * 选择封禁范围（实体 / 节点）。
 * @param {{ displayName: string }} opts 成员展示信息
 * @returns {Promise<{ banScope: BanScope }|null>} 取消时为 null
 */
export async function pickBanScope({ displayName }) {
	usingTemplates('/parts/shells:chat/src/templates')
	const action = await pickFromDialog('hub/nav/ban_scope_modal', { displayName })
	return action ? { banScope: /** @type {BanScope} */ action } : null
}
