/**
 * CI 专用桩：由 `.github/path-ci/install-hooks.sh` 临时替换 `src/log_viewer/index.mjs`；本地不用。
 */
import process from 'node:process'
console.log('FOUNT_CI_HOOK:log')
process.exit(0)
