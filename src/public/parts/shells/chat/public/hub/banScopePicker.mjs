/**
 * 【文件】public/hub/banScopePicker.mjs
 * 【职责】成员封禁范围选择模态：在「封禁实体」与「封禁节点」之间让用户确认一次选择。
 * 【原理】`pickBanScope` 弹出 `hub/nav/ban_scope_modal` 对话框并返回用户选择或取消。
 * 【数据结构】见函数入参与返回值 JSDoc。
 * 【关联】../../../../scripts/dialog.mjs、../../../../scripts/template.mjs
 */
import { openDialogFromTemplate } from '../../../../scripts/dialog.mjs'
import { usingTemplates } from '../../../../scripts/template.mjs'

/** @typedef {'entity' | 'node'} BanScope */

/**
 * 选择封禁范围（实体 / 节点）。
 * @param {{ displayName: string }} opts 成员展示信息
 * @returns {Promise<{ banScope: BanScope }|null>} 取消时为 null
 */
export async function pickBanScope({ displayName }) {
	usingTemplates('/parts/shells:chat/src/templates')
	return new Promise(resolve => {
		void openDialogFromTemplate('hub/nav/ban_scope_modal', { displayName }, {
			/**
			 * @param {HTMLDialogElement} dialog 对话框
			 * @returns {void}
			 */
			onReady: dialog => {
				/**
				 * @param {BanScope|null} scope 封禁范围；null 表示取消
				 * @returns {void}
				 */
				const finish = scope => {
					dialog.close()
					resolve(scope ? { banScope: scope } : null)
				}
				dialog.querySelector('[data-ban-cancel]')?.addEventListener('click', () => finish(null))
				dialog.querySelector('[data-ban-entity]')?.addEventListener('click', () => finish('entity'))
				dialog.querySelector('[data-ban-node]')?.addEventListener('click', () => finish('node'))
				dialog.addEventListener('cancel', () => finish(null), { once: true })
			},
		})
	})
}
