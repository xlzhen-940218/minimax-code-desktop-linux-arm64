import { positiveInteger, reasoningEffort } from './report.mjs';

/** 省略命令行覆盖时保留生产配置，运行报告记录这里的生效值。 */
export function resolveMemoryConfig(config, values) {
  const effort = reasoningEffort(values['reasoning-effort']);
  return {
    ...config,
    detailedLoggingEnabled: true,
    publicationCooldownMs: 0,
    ...(values['capture-limit'] !== undefined
      ? { maxCaptureSessionsPerWake: positiveInteger(values['capture-limit'], 'capture-limit') }
      : {}),
    ...(values['capture-concurrency'] !== undefined
      ? {
          maxCaptureConcurrency: positiveInteger(
            values['capture-concurrency'],
            'capture-concurrency',
          ),
        }
      : {}),
    ...(values['max-selected-sessions'] !== undefined
      ? {
          maxSelectedSessions: positiveInteger(
            values['max-selected-sessions'],
            'max-selected-sessions',
          ),
        }
      : {}),
    ...(values.model ? { captureModel: values.model, consolidationModel: values.model } : {}),
    ...(effort ? { captureReasoningEffort: effort, consolidationReasoningEffort: effort } : {}),
  };
}
