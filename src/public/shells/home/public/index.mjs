/**
 * 主页 shell 的客户端入口点。
 * 负责初始化和启动 Home shell 的核心逻辑。
 */
import { showToast } from '../../scripts/toast.mjs'

import { initializeApp } from './src/home.mjs'

initializeApp().catch(error => {
	showToast('error', error.message)
})
