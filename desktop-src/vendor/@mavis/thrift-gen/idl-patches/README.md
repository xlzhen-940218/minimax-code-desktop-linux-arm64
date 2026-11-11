# 模型接入 consumer IDL 输入

基线：weaver/idl `fcf9e3a74c318213daaadac1d470ef85bcc27282`
的 model-access 源文件；本分支 patch 增加 subscriptions_enabled、account_masked、group_provider_id、members/selected。使用同 SHA 的完整 IDL
checkout 使用 `git apply --unidiff-zero <model-access-product.patch>` 应用本目录零上下文 patch，再
`pnpm gen:thrift -- --idl-dir <checkout>`。

本文件记录源先于生成物的可重现输入，不是上游提交。用户本轮只授权同分支 commit、不创建 MR；上游 IDL 尚未交付。不得将这个 patch 当作已合入/已部署的契约。

## 用户包与开发会话（model-access-user-packages.patch）

生成输入：weaver/idl `origin/feat/local-subscription-import`（`214fb03a7`）本地合并 `main`
`ec75f46ea`（合并结果与当前提交的生成物零差异），再应用 `model-access-user-packages.patch`（普通
`git apply`）。新增 ModelAccessPackageSource / source_ref、ModelAccessDevSession、dev-session
start/reload/stop/promote、GetModelAccessExtensionStatus、ExportModelAccessPackage，以及
installation 的 origin 与 presentation 字段；ModelAccessDevRequest 的 session_id、kind（run / keep）、version、replaces_kept（会话内确认卡片）。仅为本地可重现输入，尚未提交上游 IDL MR，
不得当作已合入/已部署的契约。
