# 仅更新 Deno 运行时：归属检测→包管理器升级/deno 自升级（含锁与刷新节流）。
# 由服务端空闲更新按路径直接调用，不经过 fount cmd 分派。
$script:FOUNT_SRC = $PSScriptRoot
if (-not $FOUNT_DIR) {
	$FOUNT_DIR = Split-Path -Parent (Split-Path -Parent $script:FOUNT_SRC)
}
. (Join-Path $script:FOUNT_SRC 'load.ps1')
require env i18n win/refresh_path pkg_common packages deno
install_deno
deno_upgrade
