/**
 * MutationObserver 闸门接线：注册各 watch 任务的脏标记，并转发 observe / ignore 门面。
 */
import { markDirty } from './a11y.mjs'
import { markDirty as markCssvarDirty } from './cssvar.mjs'
import { ignore, ignoreAsync, observe, setDirtyHandler } from './mutation_gate.mjs'
import { markDirty as markSvgThemeDirty } from './svg_theme.mjs'

/**
 * 非忽略期的突变回调：依次标记各 watch 任务脏。
 * @returns {void}
 */
function markAllDirty() {
	markDirty()
	markCssvarDirty()
	markSvgThemeDirty()
}

setDirtyHandler(markAllDirty)

/**
 * 转发 mutation_gate 门面，保持既有调用方（index / locale）导入不变。
 */
export { ignore, ignoreAsync, observe }
