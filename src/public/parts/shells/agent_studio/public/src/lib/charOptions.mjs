/**
 * 【文件】public/src/lib/charOptions.mjs — 角色下拉填充
 * 【职责】用共享角色列表填充 `<select>` 的角色选项。
 * 【原理】读取 `state.chars`；可选插入「全部角色」项。
 * 【关联】state.mjs、views/generations.mjs、views/benchmarks.mjs。
 */
import { geti18n } from '/scripts/i18n/index.mjs'

import { state } from '../state.mjs'

/**
 * 用角色列表填充下拉框。
 * @param {HTMLSelectElement | null} select 下拉框
 * @param {{ allCharsKey?: string }} [options] 选项（提供时插入值为空的全部角色项）
 * @returns {void}
 */
export function fillCharOptions(select, { allCharsKey } = {}) {
	if (!(select instanceof HTMLSelectElement)) return
	select.replaceChildren()
	if (allCharsKey) {
		const all = document.createElement('option')
		all.value = ''
		all.textContent = geti18n(allCharsKey)
		select.appendChild(all)
	}
	for (const char of state.chars) {
		const option = document.createElement('option')
		option.value = char.id
		option.textContent = char.info?.name || char.id
		select.appendChild(option)
	}
}
