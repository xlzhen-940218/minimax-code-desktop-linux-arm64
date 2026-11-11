import { isDeepStrictEqual } from 'node:util';

export function assertBareLarkRoute(testCase, stream, commands) {
  const [skillCall, bashCall] = stream.toolStarts;
  if (
    stream.toolStarts.length !== 2 ||
    skillCall?.name !== 'skill' ||
    skillCall?.input?.name !== 'lark-tools' ||
    bashCall?.name !== 'bash'
  ) {
    throw withEvidence(
      new Error(
        `${testCase.id}: expected exactly the lark-tools Skill followed by exactly one Bash call; got ${formatTrajectory(stream.toolStarts)}`,
      ),
      stream,
    );
  }
  if (!isToolFinishedBeforeStartInLaterMessage(stream, skillCall.callId, bashCall.callId)) {
    throw withEvidence(
      new Error(
        `${testCase.id}: lark-tools Skill must FINISH in an earlier assistant message before Bash STARTS`,
      ),
      stream,
    );
  }

  const route = parseDirectLarkCliFetchCommand(bashCall.input?.command, testCase.url);
  if (commands.length !== 1 || !Array.isArray(commands[0]?.argv)) {
    throw withEvidence(
      new Error(
        `${testCase.id}: expected exactly one captured lark-cli argv and no auth/status/version/help preflight`,
      ),
      { stream, commands, bashCommand: route.command },
    );
  }
  if (!isDeepStrictEqual(commands[0].argv, route.argv)) {
    throw withEvidence(
      new Error(
        `${testCase.id}: captured lark-cli argv does not match the direct Bash command body`,
      ),
      { stream, commands, bashCommand: route.command, parsedArgv: route.argv },
    );
  }
  assertLarkFetchArgv(testCase.id, commands[0].argv, testCase.url, {
    stream,
    commands,
    bashCommand: route.command,
  });
  const assistantMessages = Array.isArray(stream.assistantMessages)
    ? stream.assistantMessages
    : [];
  const finalAssistantMessage = assistantMessages.at(-1);
  if (
    finalAssistantMessage?.closed !== true ||
    typeof finalAssistantMessage?.text !== 'string' ||
    !finalAssistantMessage.text.includes(testCase.fact)
  ) {
    throw withEvidence(
      new Error(`${testCase.id}: final answer omitted the unique CLI fixture fact`),
      { stream, commands },
    );
  }
}

export function assertCompleteToolLifecycle(stream, label) {
  const starts = Array.isArray(stream.toolStarts) ? stream.toolStarts : [];
  const results = Array.isArray(stream.toolResults) ? stream.toolResults : [];
  const lifecycles = Array.isArray(stream.toolLifecycles) ? stream.toolLifecycles : [];
  const callIds = starts.map((call) => call.callId);
  const resultCallIds = results.map((call) => call.callId);
  const lifecycleByCallId = new Map(lifecycles.map((state) => [state.callId, state]));
  const eachLifecycleComplete = starts.every((call) => {
    const state = lifecycleByCallId.get(call.callId);
    return (
      state?.name === call.name &&
      state?.terminalStatus === 'finished' &&
      Array.isArray(state?.statuses) &&
      state.statuses.length === 2 &&
      state.statuses[0] === 'start' &&
      state.statuses[1] === 'finished'
    );
  });
  if (
    !Array.isArray(stream.lifecycleErrors) ||
    stream.lifecycleErrors.length !== 0 ||
    stream.toolFailures !== 0 ||
    stream.toolFinishes !== starts.length ||
    results.length !== starts.length ||
    lifecycles.length !== starts.length ||
    callIds.some((callId) => !callId) ||
    new Set(callIds).size !== callIds.length ||
    new Set(resultCallIds).size !== resultCallIds.length ||
    resultCallIds.some((callId) => !callIds.includes(callId)) ||
    !eachLifecycleComplete
  ) {
    throw withEvidence(
      new Error(
        `${label}: incomplete tool lifecycle: starts=${starts.length}, finishes=${stream.toolFinishes}, results=${results.length}, failures=${stream.toolFailures}, uniqueCallIds=${new Set(callIds).size}, completeLifecycles=${eachLifecycleComplete}, errors=${stream.lifecycleErrors?.join('; ') || '(none)'}`,
      ),
      stream,
    );
  }
}

export function recordAssistantMessage(evidence, message, terminal) {
  if (message?.role !== 'assistant') return;
  const messageId = String(message.msg_id || message.id || '').trim();
  if (!messageId) {
    const error = 'assistant message emitted content without messageId';
    if (!evidence.lifecycleErrors.includes(error)) evidence.lifecycleErrors.push(error);
    return;
  }

  let assistantMessage = evidence.assistantMessagesById.get(messageId);
  if (!assistantMessage) {
    assistantMessage = { messageId, text: '', closed: false };
    evidence.assistantMessagesById.set(messageId, assistantMessage);
  }
  if (typeof message.msg_content === 'string') {
    if (terminal) {
      // The terminal frame repeats the full message after its streaming deltas.
      assistantMessage.text = message.msg_content;
    } else {
      assistantMessage.text += message.msg_content;
    }
  }
  if (terminal) assistantMessage.closed = true;
}

export function parseDirectLarkCliFetchCommand(rawCommand, targetUrl) {
  if (typeof rawCommand !== 'string' || !rawCommand.trim()) {
    throw new Error('Bash command body is missing');
  }
  const words = parseSingleSimpleCommand(stripAllowedTrailingStderrMerge(rawCommand));
  if (words[0] !== 'lark-cli') {
    throw new Error(
      'Bash must directly execute lark-cli without which/command -v/type/auth or another preflight',
    );
  }
  const argv = words.slice(1);
  assertLarkFetchArgv('bare Feishu link', argv, targetUrl, { bashCommand: rawCommand });
  return { command: rawCommand, argv };
}

function stripAllowedTrailingStderrMerge(command) {
  const match = /^(?<body>[\s\S]*\S)\s+2>&1\s*$/u.exec(command);
  return match?.groups?.body ?? command;
}

function assertLarkFetchArgv(label, argv, targetUrl, evidence) {
  const allowed = [
    ['docs', '+fetch', '--doc', targetUrl],
    ['docs', '+fetch', '--doc', targetUrl, '--format', 'json'],
    ['docs', '+fetch', '--format', 'json', '--doc', targetUrl],
  ];
  if (!allowed.some((candidate) => isDeepStrictEqual(argv, candidate))) {
    throw withEvidence(
      new Error(
        `${label}: lark-cli argv must be one direct docs +fetch for the exact URL, with only optional --format json`,
      ),
      evidence,
    );
  }
}

function parseSingleSimpleCommand(command) {
  const words = [];
  let word = '';
  let wordStarted = false;
  let quote = null;

  const pushWord = () => {
    if (!wordStarted) return;
    words.push(word);
    word = '';
    wordStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === '$' || char === '`' || char === '\n' || char === '\r') {
        throw new Error('Bash direct command must not contain expansion or another command');
      }
      if (char === '\\') {
        index += 1;
        if (index >= command.length) throw new Error('Bash command ends with an escape');
        word += command[index];
        continue;
      }
      word += char;
      continue;
    }

    if (/\s/u.test(char)) {
      pushWord();
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      wordStarted = true;
      continue;
    }
    if (';&|<>()`$\n\r'.includes(char) || char === '#') {
      throw new Error(
        'Bash must contain one direct lark-cli command without preflight, chaining, pipes, redirects, or expansion',
      );
    }
    if (char === '\\') {
      index += 1;
      if (index >= command.length) throw new Error('Bash command ends with an escape');
      word += command[index];
      wordStarted = true;
      continue;
    }
    word += char;
    wordStarted = true;
  }
  if (quote) throw new Error('Bash direct command contains an unterminated quote');
  pushWord();
  if (words.length === 0) throw new Error('Bash direct command is empty');
  return words;
}

function isToolFinishedBeforeStartInLaterMessage(stream, finishedCallId, startedCallId) {
  const finishedIndex = stream.toolTimeline.findIndex(
    (event) => event.callId === finishedCallId && event.status === 'finished',
  );
  const startedIndex = stream.toolTimeline.findIndex(
    (event) => event.callId === startedCallId && event.status === 'start',
  );
  const finishedEvent = stream.toolTimeline[finishedIndex];
  const startedEvent = stream.toolTimeline[startedIndex];
  return (
    finishedIndex >= 0 &&
    startedIndex > finishedIndex &&
    Boolean(finishedEvent?.messageId) &&
    Boolean(startedEvent?.messageId) &&
    finishedEvent.messageId !== startedEvent.messageId
  );
}

function formatTrajectory(toolStarts) {
  return (
    toolStarts
      .map((call) =>
        call.name === 'skill' ? `${call.name}(${call.input?.name || '?'})` : call.name,
      )
      .join(' -> ') || '(none)'
  );
}

function withEvidence(error, evidence) {
  error.evidence = evidence;
  return error;
}
