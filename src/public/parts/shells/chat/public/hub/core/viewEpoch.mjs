/**
 * 【文件】public/hub/core/viewEpoch.mjs
 * 【职责】Hub 主内容视图切换代际计数器。每次「当前视图」变更（群/频道/群发现/收件箱/私聊/好友列表）
 * 都递增一次；任何异步加载/渲染操作在发起时捕获当前代际，落地前比对，代际已变则放弃——保证切界面时
 * 还在 fetch 的东西不再影响新视图的 UI（共享 `#messages` 容器）。
 */
/** @type {number} 当前代际 */
let viewEpoch = 0

/** @returns {number} 递增代际并返回新值 */
export function bumpViewEpoch() {
	return ++viewEpoch
}

/** @returns {number} 当前代际 */
export function currentViewEpoch() {
	return viewEpoch
}
