/**
 * code shell 前端入口：应用主题并启动（功能逻辑见 src/ 各模块）。
 */
import { handleError } from '../../scripts/features/errorHandlers.mjs'
import { applyTheme } from '../../scripts/theme/index.mjs'

import { boot } from './src/boot.mjs'

applyTheme()

boot().catch(handleError('code.error.generic'))
