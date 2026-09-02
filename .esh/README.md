# esh profile

此文件夹用于存放esh配置文件，为其父文件夹提供在esh中的PPP。

## commands

- `rand-review` — 非主分支可用。按相对主分支的新增行数加权，随机打开一个仍存在的改动文件（含未跟踪）。
- `sync-pkg-mgr` — `node .esh/commands/sync-pkg-mgr.mjs`。以 `path/fount` 的 `# BEGIN/END FOUNT_PKG_MGR` 可读块为事实源，把压缩单行同步进全部 readme、`src/runner/npm/main.mjs` 与 subfounts shell 前端的 `pkg_mgr_block.mjs`。
