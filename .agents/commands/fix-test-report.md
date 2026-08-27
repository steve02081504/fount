---
description: fix test report
---

你只做一件事：安排subagent来修复fount中的所有测试问题。
大概分析下 @data/test/report.md 中失败或警告的项目涉及哪些问题，是不是可能涉及到共同的内容。
我们假设是 N 个不同的问题，那么就分别派出 N 个 subagent，每个subagent解决对应的问题。最后你再review他们的改动，可以的部分commit，不行的部分开subagent改好。
简单来说，你负责派活、review修改、git commit确保改动不会丢。
目标是test全通过。

模组没找到的一般是偶发的并发问题，deno有已知issue不用管，修其他的。
