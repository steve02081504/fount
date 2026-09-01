#!/usr/bin/env bash
# 仅更新 Deno 运行时：归属检测→包管理器升级/deno 自升级（含锁与刷新节流）。
# 由服务端空闲更新按路径直接调用，不经过 fount cmd 分派。
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
FOUNT_DIR="${FOUNT_DIR:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
FOUNT_SRC="$FOUNT_DIR/path/src"
export FOUNT_DIR FOUNT_SRC
# shellcheck disable=SC1091
. "$FOUNT_SRC/load.sh"
require env i18n packages deno
install_deno
deno_upgrade
