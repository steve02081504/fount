/**
 * Chat live WebSocket 探针共用：CI 路径禁止 skip exit 0。
 */
import { console, geti18n } from '../../i18n.mjs'

/**
 * 以通过/失败状态结束进程。
 * @param {boolean} ok 是否通过
 * @param {string} detail 结果说明
 * @returns {never} 以 0/1 退出
 */
export function finishLiveWs(ok, detail) {
	console.log(geti18n(ok ? 'fountConsole.test.ws.pass' : 'fountConsole.test.ws.fail', { detail }))
	process.exit(ok ? 0 : 1)
}

/**
 * 从角色列表选取测试用角色。
 * @param {string[] | null | undefined} list 可用角色名列表
 * @param {string[]} preferred 优先顺序
 * @returns {string|null} 匹配到的角色名
 */
export function pickPreferredChar(list, preferred) {
	for (const name of preferred)
		if (list.includes(name)) return name
	return list[0] ?? null
}

/**
 * CI live 探针：缺少前置条件时必须 fail，不能静默 skip。
 * @param {string} reason 失败原因
 * @returns {never} 以退出码 1 结束
 */
export function failLiveWsPrecondition(reason) {
	finishLiveWs(false, reason)
}
