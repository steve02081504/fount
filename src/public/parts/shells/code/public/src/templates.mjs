/**
 * code 壳模板 / 对话框 API（绑定 `/parts/shells:code/src/templates`）。
 */
import { dialogsFor } from '/scripts/features/dialog.mjs'

/**
 * code 页模板对话框 API。
 */
export const {
	openDialogFromTemplate,
	pickFromDialog,
	backDialog,
} = dialogsFor('/parts/shells:code/src/templates')
