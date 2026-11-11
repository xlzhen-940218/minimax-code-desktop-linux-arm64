# current-user 身份识别回归场景

## 目标

后台任务完成后的自动唤醒消息在 Pi 层表现为 `role: user`，但属于 runtime 内部消息，不能作为 canonical
History 的 external current
user。修复应让 current-user 识别边界排除这类消息，并沿已有的尾部追加路径完成压缩后的隐藏提醒。

## 外部契约与架构影响

- External contracts:
  none。不会修改数据库 schema、API 请求/响应、持久化消息格式、队列事件 payload 或配置 schema。
- Architecture impact: local to
  `packages/agent-core/src/pi-turn-runner`；不改变依赖方向或模块 seam。`packages/local-runtime-v2`
  只消费既有 placement 行为。

| ID   | 场景                                   | Given / When / Then                                                                                                                                                                                                                                                                                    | Type             | Priority | Status  | Evidence                                                                                                                                                                 |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TS-1 | 后台 user 不充当 external current user | Given initial history 的最后一条是带 `hostMetadata.backgroundTaskOrigin` 的 `role: user`，且 compaction 已产生 durable replacement；When hook 请求 `before-current-user` placement；Then 不抛出“无法定位 current real user”，提醒沿 tail 追加，replacement 不丢失，且不写入 `currentUserSourceIndex`。 | unit/integration | P0       | covered | `packages/agent-core/test/unit/pi-turn-runner/pi-turn-runner.test.ts` — `does not treat a background terminal user as the external current user after compaction (TS-1)` |
| TS-2 | 普通外部 user 仍保持原行为             | Given initial history 的最后一条是普通 `role: user`，且 compaction 已产生 durable replacement；When hook 请求 `before-current-user` placement；Then 提醒仍位于真实 user 之前，`currentUserSourceIndex` 仍指向该 user。                                                                                 | unit             | P0       | covered | `packages/agent-core/test/unit/pi-turn-runner/pi-turn-runner.test.ts` — `places a post-compaction hidden marker before the current real user (TS-2)`                     |
| TS-3 | continuation 非 user 尾部保持已有修复  | Given continuation history 的最后一条不是 `role: user`；When durable replacement 后请求 `before-current-user` placement；Then 继续沿 tail 追加，不回归为 placement 错误。                                                                                                                              | unit             | P1       | covered | `packages/agent-core/test/unit/pi-turn-runner/pi-turn-runner.test.ts` existing continuation case                                                                         |
| TS-4 | 下游 external identity 校验继续保留    | Given source 被标记为 `currentUserSourceIndex`；When source 没有 `msg-user-v1-*` external identity；Then canonical History 仍拒绝该 source，避免通过放宽校验掩盖身份错误。                                                                                                                             | unit             | P1       | covered | `packages/local-runtime-v2/src/service/session-system/messages/history/canonical-history-provider.test.ts` existing identity guard                                       |
| TS-5 | 普通 user 无法唯一定位时继续 fail-closed | Given initial history 尾部仍是普通 `role: user`，但同一对象引用重复导致 current user 无法唯一定位；When hook 请求 `before-current-user` placement；Then 保留既有错误并失败，不静默沿 tail 追加或调用 provider。 | unit | P0 | covered | `packages/agent-core/test/unit/pi-turn-runner/pi-turn-runner.test.ts` — `fails closed when duplicate ordinary users make the current user ambiguous (TS-5)` |
