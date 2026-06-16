/**
 * 【文件】stickers/collection/index.mjs
 * 【职责】用户贴纸收藏模块的 barrel 导出，统一对外暴露 load/save 接口。
 * 【原理】仅 re-export store.mjs，无额外逻辑，便于 endpoints 与 stickers 主模块单一导入路径。
 * 【数据结构】UserStickerCollection（经 store 定义）。
 * 【关联】被 stickers/stickers.mjs 引用；实现见 collection/store.mjs。
 */
export { loadUserStickerCollection, saveUserStickerCollection } from './store.mjs'
