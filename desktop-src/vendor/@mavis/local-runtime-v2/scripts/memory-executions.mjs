import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { getPrimaryDataDirPath } from '@mavis/config';
import { DatabaseClient } from '../src/infra/db/client.js';
import { createMemoryExecutionQuery } from '../src/service/memory-system/index.js';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    stage: { type: 'string' },
    source: { type: 'string' },
    task: { type: 'string' },
    limit: { type: 'string' },
    'started-after-ms': { type: 'string' },
    before: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(`记忆执行账本（只读现有数据库）
pnpm --filter @mavis/local-runtime-v2 memory:executions --data-dir <dir> [选项]
  --stage migration|capture|consolidation  按阶段查询
  --source <ref>             按会话 ID 或 Agent 名称查询
  --task <id>                单次任务与逐请求用量
  --limit <n>                每页条数，默认 50，上限 200
  --started-after-ms <ms>    只查询该 Unix ms 之后启动的任务
  --before <json>            上页 nextCursor 的 JSON
时间与用量缺失以 null 表示；missingCompletion 表示缺少结束记录。
未指定目录时使用系统主数据目录，无需模型配置或认证。`);
} else {
  const database = new DatabaseClient({
    dataDir: resolve(values['data-dir'] ?? getPrimaryDataDirPath()),
    readonly: true,
  });
  try {
    const query = createMemoryExecutionQuery(database.db);
    const result = values.task
      ? query.getTask(values.task)
      : query.listTasks({
          ...(values.stage ? { stage: values.stage } : {}),
          ...(values.source ? { sourceRef: values.source } : {}),
          ...(values.limit ? { limit: Number(values.limit) } : {}),
          ...(values['started-after-ms']
            ? { startedAfterMs: Number(values['started-after-ms']) }
            : {}),
          ...(values.before ? { before: cursor(values.before) } : {}),
        });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const messages = [error?.message, error?.cause?.message].filter(Boolean).join(' ');
    console.error(
      messages.includes('no such table')
        ? '执行账本不存在，请先升级并启动 Runtime；查询不会执行数据库迁移。'
        : `执行账本查询失败：${messages}`,
    );
    process.exitCode = 1;
  } finally {
    database.close();
  }
}

function cursor(value) {
  const parsed = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.taskId !== 'string' ||
    !Number.isSafeInteger(parsed.startedAtMs)
  ) {
    throw new Error('invalid-execution-query-cursor');
  }
  return { taskId: parsed.taskId, startedAtMs: parsed.startedAtMs };
}
