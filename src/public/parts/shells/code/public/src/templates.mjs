/**
 * code 壳模板 / 对话框 API（绑定 `/parts/shells:code/src/templates`）。
 */
import { dialogsFor } from '/scripts/features/dialog.mjs'
import { templatesFor } from '/scripts/features/template.mjs'

/** code 页模板对话框 API。 */
export const { openDialogFromTemplate } = dialogsFor('/parts/shells:code/src/templates')
/** code 页模板渲染 API。 */
export const { renderTemplate } = templatesFor('/parts/shells:code/src/templates')
