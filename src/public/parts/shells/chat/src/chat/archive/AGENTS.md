# 冷归档（Chat）

- **月份分桶**：唯一标准 = **UTC** 自然月 `YYYY-MM`（`archiveMonthKey` 使用 `Date.UTC`；禁止 `getMonth()` 等本地时区分桶）。
- **双轴线**：管理员轴线 = DAG/HTTP 治理（踢人、删帖、频道权限等）；小圈子轴线 = 联邦多 peer + `monthDigests` 信誉仲裁（正文真相 = digest，非管理员 Seal）。**本机冷归档清理**属 replica 磁盘卫生，群成员即可在设置里删自己的 `archive/*.jsonl`，不要求 ADMIN。
- **不进 DAG**：`archive_manifest.json` 存 `monthDigests`、`archivedEventIds`（赢家落盘后物化）、`channels[].months`（补拉 hint）；fold 后 `prev` 接 `checkpoint_event_id`。
- **本地读盘**：Hub/reader 校验 `monthDigests` 与月 JSONL 一致；联邦 serve 流式分块加密，不整文件 `readFile`。
- **联邦**：入群带 wire manifest（仅月份/digest hint）；`syncMissingArchiveMonths` 按 manifest 补拉；`fed_archive_month_want` 需 PullAttestation + active 成员；多 peer 按 `pickNodeScore` 对 digest 仲裁后写入并 `syncArchivedEventIdsFromMonthBody`；收集应答在 quorum（同 digest ≥2 peer）或收齐目标 peer 时提前结束（`federationCollect.mjs`）。
- **digest**：磁盘 JSONL 每行须为 `canonicalArchiveMonthLine`；`digestCanonicalMonthLines` 流式哈希；`mutateArchiveManifest` 互斥 R-M-W；联邦重组写临时文件后 `rename`，禁止整月 `Buffer.concat`。
- **热区**：`hot_posts.latestByChannel`（每频道最新 N，`hotLatestMessageCount`）。
