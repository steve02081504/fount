/**
 * 【文件】public/src/ui/composerKeys.mjs
 * 【职责】编写器键盘：Ctrl/Cmd+Enter 发送、编辑模式保存/取消绑定。
 * 【原理】isComposerSubmitKey 检测；bindComposerSubmit/bindComposerEditKeys 注册 keydown。
 * 【数据结构】textarea HTMLElement、onSubmit/onSave/onCancel 回调。
 * 【关联】Hub composer；与 composerAttachments 并列。
 */
/**
 * @param {KeyboardEvent} event 键盘事件
 * @returns {boolean} 是否为 Ctrl/Cmd+Enter 提交快捷键
 */
export function isComposerSubmitKey(event) {
	return event.key === 'Enter' && (event.ctrlKey || event.metaKey)
}

/**
 * 为多行 composer / 编辑区绑定 Ctrl/Cmd+Enter 提交。
 * @param {HTMLTextAreaElement} textarea 输入框
 * @param {() => void | Promise<void>} onSubmit 提交回调
 * @returns {void}
 */
export function bindComposerSubmit(textarea, onSubmit) {
	textarea.addEventListener('keydown', (event) => {
		if (!isComposerSubmitKey(event)) return
		event.preventDefault()
		void onSubmit()
	})
}

/**
 * 为编辑区绑定 Escape 取消与 Ctrl/Cmd+Enter 保存。
 * @param {HTMLTextAreaElement} textarea 编辑框
 * @param {object} handlers 回调
 * @param {() => void | Promise<void>} handlers.onSave 保存
 * @param {() => void | Promise<void>} handlers.onCancel 取消
 * @returns {void}
 */
export function bindComposerEditKeys(textarea, { onSave, onCancel }) {
	textarea.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault()
			void onCancel()
			return
		}
		if (isComposerSubmitKey(event)) {
			event.preventDefault()
			void onSave()
		}
	})
}
