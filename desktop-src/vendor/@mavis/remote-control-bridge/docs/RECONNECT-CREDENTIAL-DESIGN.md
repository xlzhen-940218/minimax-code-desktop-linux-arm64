# RC 重连凭证自愈技术方案（问题 2：RemoteGateway 重启后断联无法恢复）

> 状态：已实现（v2 缺口全部落地 + v3 bootstrap 退避补丁 §4.4.1），单测 + tsc 通过，待 review
> 作者：mavis (session mvs_1eac014e1a5d41a48befaabdac57ceca)
> 日期：2026-07-10
> Baseline 分支：`feat/rc-desktop-localruntime-bridge`
> 影响仓库：仅 `agent-archon`（Electron 客户端）；remote_gateway / archon_biz **零改动**

---

## 一、问题与根因

### 1.1 现象

日志 bundle `20260710-143716-log`：14:13:37 `ws_closed code=1006`（Gateway 重启）
后，客户端用旧 `binding_id=57` 反复 `GET /binding → 404`，进入永久
`credential_refresh` 重连死循环（attempt=51 仍在跑），直到日志结束都未恢复。
历史上三次"恢复"（binding 49→51→54→56→57）**全部靠 App 重启**触发
`rc:binding-ready` 换新 binding，重连逻辑本身从未自愈。

### 1.2 根因链（代码级）

1. WS 断（1006）→ `RcConnection.handleClose()` 落 `default` 分支 →
   `scheduleRetry()`（`connection.ts`）。**重连由 `RcConnection` 在主进程内部
   自治，不回 renderer。**
2. 重连 `attempt()` → `credential provider.getCredentials()`（`credential.ts`）。
3. renderer cache 超 60s（`RENDERER_CACHE_MAX_AGE_MS`）过期 → **回退去打主进程
   自己的 `pairingClient.getBinding()`**。
4. 主进程这条 HTTP **从设计上就没打通过 matrix 网关鉴权** → 恒 404。
5. 404 被 `connection.ts` 的通用 catch 当"可重试瞬时错误" → `scheduleRetry()`
   原地空转，binding_id 永不更新、拿不到任何新 ticket → 死循环。

### 1.3 为什么主进程 `GET /binding` 恒 404（关键地基事实）

**不是路由问题，是鉴权/签名管线差异。** 主进程 pairing-client（`ipc.ts` 手搓的
`net.fetch`）与 renderer 的 axios（`packages/ui/src/services/mmx-agent/axios.ts`）
打的是**同一个 URL**，但 renderer 注入了主进程**完全没有**的一整套 matrix 网关
签名料：

| 鉴权要素 | renderer axios | 主进程 pairing-client |
|---|---|---|
| `token` header | ✅ localStorage token | ✅ storage.accessToken（可能漂移）|
| `user_id` query param | ✅ `handleGeneralParams` 注入 | ⚠️ 有但源不同 |
| `yy` header（`publicEncrypt` 加密体）| ✅ | ❌ **无** |
| `x-timestamp` / `x-signature`（md5 签名）| ✅ | ❌ **无** |
| `op_ticket` / `uuid` / public params | ✅ 一整套 | ❌ **无** |

**验证事实**：
- 两天日志中主进程 pairing-client **零 2xx**——只调过 `GET /binding`，98 次全
  404/网络错误；`POST /pairing/code` 等根本没经主进程（那是 renderer 发的）。
- 主进程侧 `grep yy|x-signature|publicEncrypt` **零实现**——该签名逻辑只存在于
  打包进 renderer 的前端 chunk，主进程无法独立复刻。

**结论**：签发 ticket 依赖的 `GET /binding` 只能由 renderer 那条完整签名管线
成功。主进程独立打通不现实（要移植前端加密私钥/salt，成本高 + 安全评估 + 易漂移）。

---

## 二、设计约束（来自产品决策）

### 连接与持久身份的所有权

`RcConnection` 的每次连接尝试持有独立 `AbortController`。断线、停止、健康检查失败和强制关闭立即取消该尝试；旧凭据请求、旧 socket 的 close 事件和迟到命令不能重新激活它。取消信号传到本地 Request、命令回包和 `StreamPump`；不支持取消的本地调用即使迟到返回，也不能开启旧流，返回的流体会被取消。取消不代表已经提交的业务操作被回滚。

命令去重使用 producer 身份及其撤销代次，加上 `cmd.id`；同一身份重连保留去重，代表 binding 轮换不改变身份。切账户、producer generation 改变或明确撤销后，旧结果缓存不进入新身份。流使用独立的 gateway connection scope，按 `scope + sessionId + cmdId` 隔离；发送入口校验 scope。因连接结束而未能确认结果的命令返回 `COMMAND_CANCELLED`，调用方应刷新会话状态，不能自动重放写入。

`DeviceIdentityStore` 先写同目录临时文件，再 rename，成功后才发布新的内存状态。写入失败保留上一份持久状态、清理临时文件并向调用方抛错；首次创建也遵守此规则。非 ENOENT 的读取失败向上传播，不能据此重建设备身份。公开快照不暴露可变的 `pending_unbind` 引用；凭据缓存与解绑成功状态只在对应身份落盘后更新。关闭已失效的连接仍先执行，磁盘失败不会恢复旧账号连接。

四种场景的目标行为：

| 场景 | 服务端 binding | 期望行为 |
|---|---|---|
| **1 手机端解绑**（且无其他桌面绑定本机）| 删除本机 binding，`state=none` | **断联**，清本地 binding，转 `unbound` |
| **2 桌面端解绑** | 删除本机 binding | **断联**（本端主动 `disconnect({unbind:true})`）|
| **3 桌面端重启** | 不变（bound）| 重新拉 binding 拿新 ticket 建联 |
| **4 Gateway 重启** | **不变（bound）**| 绑定不变，重新拉凭证建联（**当前坏掉的场景**）|

**硬性决策（用户明确）**：
- **A 必做**：重连凭证来源从"主进程自查"切到"renderer 拉取回灌"。
- **唯一断联出口**：只有 `checkBinding` 返回 `state=none`（无任何移动端绑定本
  桌面）才断联；其余一切情况都持续重试，**不因任何报错而断联**。
- **B 不做**：不新增"404→binding-lost"这类基于错误码的断联判定（断联只认
  `state=none`）。
- **C 不做**：不加重试次数上限（"不是断联就一直重试"）。

---

## 三、方案选型

矛盾核心：**"断连随时发生、需常驻自愈" vs "签名能力只在 renderer UI、非常驻"。**

关键事实：renderer 的 RC 订阅（`store/remote-control.ts` 的 `init()` +
`onStatusChanged`）**只在 RC 设置面板（`RemoteControlSection` / `RemoteControlPanel`）
挂载时存活**，面板一关就退订。Gateway 重启随时发生、且多数时候面板没开 → 复用
现有 `reconnecting` 推送让面板去重拉**会落空**。

### 采纳：路线 ①（renderer 拉取 + 订阅提升为应用级常驻）

- 复用 renderer 现成的完整签名管线（`checkBinding`），主进程**零签名实现**。
- 把 RC 的"WS 生命周期订阅 + 断连重拉"从"面板挂载"提升为 **App 顶层常驻**，
  与设置面板 UI 解耦。Electron 的 renderer 进程常驻，此前提成立。

### 未采纳

- **路线 ②（主进程独立签名）**：要移植 `publicEncrypt` 私钥 / md5 salt 进主
  进程，成本高、有密钥安全评估、易随前端漂移。否决。
- **路线 ③（renderer 常驻低频轮询保鲜 cache）**：有常态轮询开销，且"何时断联"
  时序松散。降级备选。

---

## 四、目标架构

### 4.1 职责边界（维持既有分层）

- **主进程 `RemoteControlProxy` / `RcConnection`**：拥有 WS 生命周期。它**发现**
  断连、**驱动**重连，但**不再自己签发凭证**。
- **renderer（应用级常驻订阅）**：拥有 binding 状态 + 签名能力。它是 `GET /binding`
  的**唯一**执行者，把凭证经 IPC 回灌主进程。

### 4.2 新增回路：主进程"请求 renderer 重签凭证"

今天缺的不是"renderer→主进程建 WS"（已有 `rc:binding-ready`），而是
**"主进程重连时反向请求 renderer 重签凭证"这条回路**。新增一条主→渲染信号补齐：

```
WS close 1006
  → RcConnection.handleClose() → default 分支
  → （凭证缺失/过期）不再回退主进程 GET /binding
  → RemoteControlProxy 发 IPC  rc:refresh-binding  ───────────►  renderer(常驻订阅)
                                                                     │
                                                    checkBinding(deviceId)  ← 完整签名管线
                                                                     │
                        ┌────────────────────────────┬─────────────┴──────────────┐
                   state=bound                   state=none                   其它/网络错误
                        │                             │                            │
             notifyBindingReady({...})       notifyBindingLost()            （什么都不做）
                        │                             │                            │
      主进程 applyRendererCredentials       主进程 clearBinding             主进程按退避
        → 活连接 retryNow() 立即重连           → 停连，转 unbound            再发 rc:refresh-binding
```

### 4.3 凭证热注入：provider 必须实时读 proxy 的 cache（缺口修正 ①）

**现状断链**：`startConnection()` 创建 credential provider 时对
`rendererCredentials` 做的是**一次性快照**（`setRendererCache({...})`）；
`applyRendererCredentials()` 只更新 proxy 字段，**活着的 `RcConnection`
手里的 provider cache 不会跟着变**。且回灌路径上：
- `rc:binding-ready` handler 调 `rc.connect()`，在
  `phase==='reconnecting' && this.connection` 时 early-return（"live
  connection owns the lifecycle"）；
- 即使改调 `connection.start()`，其幂等守卫在 `waiting-retry` 态静默 no-op。

三层挡板叠加 → 回灌的新 ticket 永远到不了下一次 `attempt()`，回路依然死。

**修正**：
1. provider 改为**持 getter 实时读** proxy 的 `rendererCredentials`
   （`createCredentialProvider({ getRendererCache: () => this.rendererCredentials })`），
   废弃快照式 `setRendererCache`。回灌只改 proxy 一处，活连接自然可见。
2. `RcConnection` 新增 `retryNow()`：若处于 `waiting-retry`，取消
   `retryTimer` 立即 `attempt()`；其它状态 no-op（幂等，带防抖：一次
   attempt 在飞时重复调用不叠加）。
3. `applyRendererCredentials()` 末尾：若存在活连接 →
   `connection.retryNow()`（立即用新票重连，不等退避）；无活连接 →
   维持现有 `connect()` 路径。

### 4.4 Bootstrap：renderer 常驻 daemon 启动时主动推一次（缺口修正 ②）

**现状死锁**：App 冷启动后主进程无 connection、无 retry loop → 永远不会发
`need-credentials` / `rc:refresh-binding`；而 renderer `init()` 的 bound
分支只 set UI state、**不调 `notifyBindingReady`**（只有 pairing 轮询会调）。
主进程等 renderer 推、renderer 等主进程要 → 双向等待，重启后 WS 永不建立。

**修正**：`ensureRemoteControlDaemon()` 启动时**主动执行一次与
`rc:refresh-binding` 相同的处理**（`checkBinding` → bound 即
`notifyBindingReady` / none 即 `notifyBindingLost` / 错误静默）。这就是
场景 3（桌面重启）的建连入口，与信号驱动路径共用同一个 handler。

#### 4.4.1 Bootstrap 退避重试（缺口修正 ④ · v3）

**§4.4 首版的残留缺口**：bootstrap 单发且"抛错即静默、零重试"。而 daemon
effect 与 `useInitFetch()` 的 token 同步/续期是**同一 tick 内互不 await 的两个
异步 effect**，bootstrap 的 `checkBinding()` 完全可能在 token 落地前打出、进
catch 被吞。此时主进程冷启动仍无 connection，**永远不会**再广播
`rc:refresh-binding`（gap #2+#3），已绑定桌面一直不建 WS，直到用户手动开面板。
注意：token 竞态只是触发条件之一，启动瞬间一次普通网络抖动会产生完全相同的
wedge。

**修正**：bootstrap 改为**带退避的重试循环**，判定边界为"是否拿到确定 HTTP
应答"：
- `checkBinding` **抛错**或 deviceId 拿不到 → 视为 token 未就绪 / 瞬时抖动，
  按退避重试（`BOOTSTRAP_BACKOFF_MS = [1s,2s,5s,10s,30s]`，指数封顶 30s，
  **无硬上限**，符合决策 C）。
- `checkBinding` **成功返回**（`bound`/`none`/`pairing`/其它任意 state）→
  鉴权已就绪，是确定答案，**停止重试**（`pairing` 不空转）。
- 该循环仅用于 bootstrap；`rc:refresh-binding` 信号路径保持**单发**（此时主
  进程已有 connection，会自己按退避重播）。
- 由 daemon disposer `clearTimeout` 取消 pending 重试。此修正**不耦合**
  `useInitFetch` 的初始化顺序。

### 4.5 凭证用后即焚 + `credentials` 拒绝不再终态（缺口修正 ③）

**现状违反决策 C**：ticket 一次性，但 cache 按 60s 年龄判新鲜。60s 内
断连重连会**重放已消耗的 ticket** → gateway 拒 `ticket_invalid` →
`handleConnectionStopped` 的 `credentials` 分支给一次立即重启（仍是同一张
废票）→ 窗口内第二次拒绝 → `phase:'error'` + `connection=null`，**彻底
停摆无人重试**——违反"非 none 一直重试"。

**修正**：
1. **用后即焚**：WS 成功建连（收到 ctrl.hello / connected）后，proxy 立即
   使 `rendererCredentials` 失效（置 null 或标记 consumed）。下次断连
   `getCredentials()` 必然 stale → 走 refresh 回路拿新票，杜绝重放。
2. `handleConnectionStopped` 的 `credentials` 分支**不再落 `phase:'error'`
   终态**：清 cache 后转入 need-credentials 刷新循环（发
   `rc:refresh-binding` + 保持 `reconnecting`），与 stale 路径汇合。
   现有 `CREDENTIAL_RETRY_WINDOW_MS` 一次性立即重启逻辑随之删除。

---

### 4.6 本地泳道 WS handshake 与设置变更（2026-07-15）

Remote Control
WS 的路由泳道属于 Desktop 本地配置，不进入 binding/ticket 持久化。当前实现遵循以下边界：

- `RcConnection.attempt()` 每次创建 socket 前调用动态 header provider，并把当前 `headers` 与
  `maxPayload=DEFAULT_MAX_MESSAGE_BYTES` 同时传给 Node `ws`；注入的 `wsFactory(url)`
  仍兼容，第二个 options 参数可忽略。重连不会复用旧 attempt 的 header 快照。
- Electron provider 每次从 `getDesktopConfig().swimLaneName` 读取值；仅 dev/test/staging
  且 trim 后非空时发送 `lane`、`bedrock_lane`、`bedrock-lane` 三个同值头。任何平台的
  Remote Control 路径都不得在产品代码中硬编码联调泳道。生产环境、空值不发送；prod 也不
  订阅泳道变化，因此配置变化不会触发 WS restart。`RC_BIZ_HEADERS` 仍只用于 pairing HTTP
  请求，绝不合并到 WS options。
- `storage.ipc.ts` 以 trim 后的有效泳道为比较值；有效值发生变化时通知 RC
  IPC。活跃 proxy 会关闭当前 WS（`app_quit`，不调用 unbind）、清掉 renderer
  ticket/endpoint、保留 durable binding，并复用 `rc:refresh-binding` 要求 renderer 重新签名。既有
  `rc:binding-ready` handler 回灌新 bundle 后调用
  `connect()`，用新 ticket/endpoint 建立 WS。相同有效值或没有 active connection 时不做破坏性动作。
- header、lane、ticket 值不写入日志；WS URL 使用既有 ticket
  redaction，binding-ready 日志只记录 binding id。

验证入口：`packages/remote-control-bridge/test/connection.test.ts`、`index.test.ts`、Electron
`main/modules/remote-control-bridge/ipc.test.ts` / `main/ipc/storage.ipc.test.ts`，以及 acceptance
smoke 中的真实本地 HTTP Upgrade/WS
server。该行为仅由 AgentArchon 实现，ArchonBiz、RemoteGateway、IDL 不变。

## 五、详细改动清单（仅 agent-archon）

### 5.1 主进程

#### (1) `config/constants.ts` + `preload.ts` — 新增 IPC 通道常量
- `RC_REFRESH_BINDING: 'rc:refresh-binding'`（主→渲染，webContents.send）
- `RC_BINDING_LOST: 'rc:binding-lost'`（渲染→主，ipcRenderer.invoke）

#### (2) `credential.ts` — 移除主进程自查回退 + 改实时 getter
- `getCredentials()` 删除 renderer cache 过期后回退 `client.getBinding()` 的整段。
- **provider 改为构造时接收 `getRendererCache()` getter**（实时读 proxy 的
  `rendererCredentials`），废弃快照式 `setRendererCache`（§4.3）。
- cache 命中且新鲜 → 返回 `{state:'bound', ...}`。
- cache 缺失/过期/已消耗 → 返回新增态 `{state:'stale'}`（**不再打主进程 HTTP**）。
- `RcCredentials` 类型加 `| { state: 'stale' }`；由于回退删除，provider 不再
  可能返回 `pairing`/`none`，类型收窄为 `bound | stale`（`types.ts`），
  `connection.ts` 原 `state !== 'bound'` → `binding-lost` 分支变 dead code，
  **直接删除**（真正的 none 断联由 renderer `notifyBindingLost` 驱动，见 5.2）。

#### (3) `connection.ts` — `attempt()` 对 `stale` 的处理 + `retryNow()`
- `getCredentials()` 得到 `stale` 时：**不建 WS、不 scheduleRetry 空转**，而是
  发 `{ kind: 'need-credentials' }` 事件（新增 `RcConnectionEvent` 变体），并按
  退避安排下一次 `attempt()`（保证 renderer 迟迟不回也会持续重试 → 满足"一直
  重试"）。
- 新增 **`retryNow()`**：`waiting-retry` 态下取消 `retryTimer` 立即
  `attempt()`；其它状态 no-op（幂等 + 防抖，多窗口重复回灌只触发一次，§4.3）。
- `RcConnectionEvent` 新增：`| { kind: 'need-credentials' }`。
- 删除原 `creds.state !== 'bound'` → `binding-lost` 出口（见 (2)）。

#### (4) `index.ts` — `RemoteControlProxy` 编排
- 监听 `RcConnection` 的 `need-credentials` 事件 → 发 `rc:refresh-binding` 给所有
  BrowserWindow（`webContents.send`），并保持 `phase: 'reconnecting'`。
- `applyRendererCredentials()`：刷新 `rendererCredentials` 后，**若存在活连接
  → `connection.retryNow()` 立即重连**；无活连接 → 现有 `connect()` 路径（§4.3）。
- **用后即焚**：`handleConnectionEvent` 的 `connected` 分支使
  `rendererCredentials` 失效（§4.5），下次断连必然 stale → 走 refresh 回路。
- `handleConnectionStopped` 的 `credentials` 分支重写：**不再落 `phase:'error'`
  终态**，清 cache → 发 `rc:refresh-binding` → 保持 `reconnecting` +
  `connection.start()` 续跑退避循环；删除 `CREDENTIAL_RETRY_WINDOW_MS`
  一次性立即重启逻辑（§4.5）。
- 新增 `onRendererBindingLost()`：renderer 报 `state=none` → `connection.stop()` +
  `identity.clearBinding()` + `setStatus({phase:'unbound'})`。**这是唯一断联出口。**
- **phase 统一**：所有"服务端已无绑定"出口（`onRendererBindingLost` /
  `server-unbind`）统一落 `unbound`；原 `binding-lost` stopped 分支落 `idle`
  的不一致随该分支删除一并消失。
- `getStatus()` 增加透出，使 renderer 常驻订阅可拿到 `binding_id`。

#### (5) `ipc.ts` — 注册新通道
- `rc:binding-ready`（已存在）→ `applyRendererCredentials` + `connect()`。
- 新增 `rc:binding-lost` handler → `proxy.onRendererBindingLost()`。
- `broadcastStatus` 已有；新增 `broadcastRefreshBinding()` 供 proxy 调用（或 proxy
  持有 webContents 发送器注入）。

### 5.2 renderer

#### (6) `store/remote-control.ts` — 订阅提升为常驻 + 断连重拉
- 拆出一个**不依赖面板挂载**的 `ensureRemoteControlDaemon()`：在 App 顶层
  （见 5.3）调用一次，内部：
  - 定义统一 handler `refreshAndPush()`：`checkBinding(deviceId)`：
    - `state==='bound' && binding_id` → `notifyBindingReady({binding_id,ticket,endpoint})`
    - `state==='none'` → `notifyBindingLost()`（新增 preload API）
    - 其它/`catch` → **不做任何事**（主进程会再次发信号重试）。返回 boolean
      标记"是否拿到确定应答"供 bootstrap 循环判定（成功=true / 抛错=false）。
  - 订阅 `rc:refresh-binding` → `refreshAndPush()`（**单发**，忽略返回值）。
  - **启动时执行 bootstrap 退避重试循环**（§4.4 + §4.4.1）——冷启动建 WS 的
    唯一入口，修复"主进程等推、renderer 等要"的死锁；带退避直到拿到确定 HTTP
    应答，规避 token 竞态 / 启动抖动被静默吞掉。由 disposer `clearTimeout` 取消。
  - 保留原 `onStatusChanged` 只更新 UI store（面板订阅仍可并存，纯展示）。
- 现有面板 `init()` 中的 UI 订阅逻辑保留；**自愈逻辑移到常驻 daemon**，二者解耦。

#### (7) `services/remote-control.ts`
- `checkBinding` 已存在，无需改。

#### (8) `preload.ts`
- `onRefreshBinding(cb)`：包 `ipcRenderer.on('rc:refresh-binding')`。
- `notifyBindingLost()`：`ipcRenderer.invoke('rc:binding-lost')`。

### 5.3 App 顶层常驻挂载点

- 在 renderer 应用根（如 `MavisPage` 之上的顶层 provider / `App` 根组件，
  **不随任何 tab/弹窗卸载**）`useEffect` 里调一次 `ensureRemoteControlDaemon()`，
  返回的 unsub 只在 App 卸载时触发。
- **待实现时确认**：选定确切的顶层组件（候选：renderer 入口的 root layout）。

---

## 六、场景 × 行为对照（验收标准）

| 场景 | 触发 | renderer `checkBinding` | 结果 |
|---|---|---|---|
| **4 Gateway 重启** | WS 1006 → cache 已消耗/过期 stale → `rc:refresh-binding` | `bound` | `notifyBindingReady` → `retryNow()` 新 ticket 立即重连，**无需重启 App** ✅ |
| **3 桌面重启** | App 起 → daemon bootstrap 主动 `refreshAndPush()`（§4.4） | `bound` | `notifyBindingReady` → `connect()` 建连 ✅ |
| **1 手机解绑至无桌面绑定** | WS 断 → `rc:refresh-binding` | `none` | `notifyBindingLost` → 停连转 `unbound` ✅ |
| **2 桌面解绑** | 本端 `disconnect({unbind:true})` | — | 现路径不变 ✅ |
| **60s 内快速断连重连**（ticket 已消耗） | connected 时已用后即焚 → stale → `rc:refresh-binding` | `bound` | 新票重连，**不重放废票、不落 error 终态**（§4.5）✅ |
| **gateway 拒票（ticket_invalid/auth_expired）** | stopped cause=credentials | `bound` | 清 cache → refresh 回路拿新票重连，不停摆 ✅ |
| **网络抖动 / biz 5xx / 临时错误** | WS 断 → `rc:refresh-binding` | throw / 非 bound 非 none | 不断联，主进程退避后再发信号，持续重试 ✅ |

---

## 七、边界与风险

1. **renderer 短暂不可用**（进程重启窗口）：主进程 `need-credentials` 退避重发
   `rc:refresh-binding`，renderer 恢复后即接上。不会永久卡死。
2. **多 BrowserWindow**：`webContents.send` 广播到所有窗口；`checkBinding` 幂等，
   多个回灌以最后一个为准（覆盖式写 `rendererCredentials`）。重复回灌触发的
   多次 `retryNow()` 由其状态守卫防抖（仅 `waiting-retry` 态生效，attempt
   在飞时 no-op），不会叠加连接。
3. **ticket 一次性 60s**：renderer 拿到即经 IPC 回灌，主进程 `retryNow()` 立即
   建连，窗口内消耗；建连成功即用后即焚（§4.5），60s 新鲜度只是兜底上限，
   实际生命周期是"一票一连"。
4. **`state=stale` 语义**："已 bound（本地视角）但主进程手上没有可用票"
   （缺失/过期/已消耗）。provider 类型收窄为 `bound | stale` 后不存在
   pairing/none 混淆——配对中态与解绑判定全部由 renderer 侧驱动。
5. **不改 remote_gateway / archon_biz**：断联判定完全在客户端；`state=none` 语义
   由 biz 现有 `GetBindingStatus` 提供（已验证：无 active binding 返 `none`）。
6. **日志**：`need-credentials` / `rc:refresh-binding` 发送 / renderer 回灌 /
   `retryNow` 生效或 no-op / 用后即焚 / `binding-lost` 各打一条 info（决策点
   if/else 都要有独立 log，便于"为什么没重连/为什么断联"可追溯）。

---

## 八、测试计划

- `credential.test.ts`：getter 返回新鲜 cache→bound；缺失/过期→`stale`（**不再调
  getBinding**，用 mock 断言零 HTTP）；**getter 实时性**——provider 创建后
  cache 变更立即可见（回灌热注入）。
- `connection.test.ts`：`getCredentials→stale` 时发 `need-credentials` 事件、不建
  WS、按退避重排；`bound` 时正常建连；**`retryNow()`**——`waiting-retry` 态
  取消 timer 立即 attempt，`connecting`/`connected`/`stopped` 态 no-op，
  重复调用不叠加。
- `index.test.ts`：`need-credentials` → 触发 `rc:refresh-binding` 广播；
  `applyRendererCredentials` → 活连接走 `retryNow()`、无连接走 `connect()`；
  **connected 后用后即焚**（cache 置空，下次 stale）；**credentials 拒绝
  → 不落 error 终态**，清 cache 进 refresh 循环；`onRendererBindingLost` →
  停连转 `unbound`。
- `store/remote-control` renderer 测（若有 vitest 环境）：daemon **bootstrap
  主动 refreshAndPush 一次**；`rc:refresh-binding` → bound 回灌 / none 上报 /
  错误吞掉不断联。
- 回归：现有 permission-upstream / stream-pump / 首次配对建连全绿。
- 独立跑 tsc（vitest 不等于 tsc）。

---

## 九、实现顺序

1. 类型与常量（`types.ts`：`RcCredentials` 收窄为 `bound | stale`、
   `RcConnectionEvent` 加 `need-credentials`；constants/preload 加通道）。
2. `credential.ts`：去回退 + 改 `getRendererCache()` getter。
3. `connection.ts`：stale → need-credentials；新增 `retryNow()`；删
   `binding-lost` dead code 出口。
4. `index.ts` 编排：need-credentials 广播、回灌热注入 + `retryNow()`、
   connected 用后即焚、credentials 拒绝改进 refresh 循环、
   `onRendererBindingLost`；`ipc.ts` 注册 `rc:binding-lost` + 广播
   `rc:refresh-binding`。
5. `preload.ts` 两个 API。
6. renderer `ensureRemoteControlDaemon()`（含 bootstrap 主动 push）+ 顶层挂载。
7. 单测 + tsc + 回归。
8. 开分支（off `feat/rc-desktop-localruntime-bridge`），MR（不 auto-merge，等确认）。


## 控制面、数据面与配对请求的所有权

- `RemoteControlProxy` 组装控制面，拥有公开状态、renderer 请求代次、一次性凭据缓存和持久身份的提交协调。`DeviceIdentityStore` 是 durable identity 的唯一写入者。
- `RcDataPlane` 独占当前 `RcConnection`、command router、`StreamPump`、`PermissionUpstream` 和 active stream scope；控制面只能 start/stop/retry，不直接写 socket 或 scope。代表 binding 轮换仍只更新凭据，身份变化才换连接。
- `RcPairingSession` 拥有兼容配对路径的 HTTP、poll timer、busy、失败计数和二维码时限。每轮操作捕获账号并有独立 AbortController；取消、换账号、新一轮配对和 renderer 新凭据使旧轮失效。即使 HTTP 不响应取消，迟到结果也不能改身份、状态、启动 socket 或清除新轮 busy。
- 普通 disconnect 也推进 renderer 请求代次并清掉旧一次性 ticket。新连接需要新凭据；账号切换即使尚无已落盘 binding，也会结束在途配对。
- 解绑确认的归属检查和本地持久提交在同一同步回调内完成。迟到的旧解绑成功或失败不覆盖新 binding；服务端明确返回 `ok=false` 保留本地身份并报告失败。网络失败不冒称解绑完成，producer `pending_unbind` 仍遵守既有 owner/requestId 契约。

真实 gateway、多端切换和 Windows 进程/端口行为需要在对应环境验收；本地注入 HTTP/WS 的行为测试不能替代它们。
