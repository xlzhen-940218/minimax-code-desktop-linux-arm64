import assert from 'node:assert/strict';
import test from 'node:test';

import { startDesktopLocalMessagesProviderFixture } from './desktop-local-messages-provider-fixture.mjs';

test('records only safe request facts and blocks non-local fetches', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = await startDesktopLocalMessagesProviderFixture({
    revisions: [
      {
        label: 'REV1',
        token: 'SAFE_REVISION_ONE',
        modelId: 'desktop-agent-revision-one',
        markdownHeading: '# Revision One',
        skillName: 'desktop-revision-one-skill',
      },
      {
        label: 'REV2',
        token: 'SAFE_REVISION_TWO',
        modelId: 'desktop-agent-revision-one',
        markdownHeading: '# Revision Two',
        skillName: 'desktop-revision-two-skill',
      },
    ],
  });
  try {
    const safetyResponse = await fetch(`${fixture.baseUrl}/mavis/api/v1/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content_text: 'PRIVATE_SAFETY_SENTINEL', scene: 205 }),
    });
    assert.equal(safetyResponse.status, 200);
    assert.deepEqual(await safetyResponse.json(), { pass: true });
    const response = await fetch(`${fixture.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { authorization: 'fixture-placeholder', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'desktop-agent-revision-one',
        max_tokens: 321,
        thinking: { type: 'disabled' },
        system:
          '# Revision One\nSAFE_REVISION_ONE desktop-revision-one-skill PRIVATE_BODY_SENTINEL',
        tools: [{ name: 'read' }, { name: 'skill' }],
      }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /SAFE_REVISION_ONE/u);
    const skillCallResponse = await fetch(`${fixture.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { authorization: 'fixture-placeholder', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'desktop-agent-revision-one',
        max_tokens: 321,
        system: '# Revision One\nSAFE_REVISION_ONE desktop-revision-one-skill',
        messages: [
          { role: 'user', content: 'Read desktop-revision-two-skill before replying.' },
        ],
        tools: [{ name: 'read' }, { name: 'skill' }],
      }),
    });
    assert.equal(skillCallResponse.status, 200);
    assert.match(await skillCallResponse.text(), /"type":"tool_use"/u);
    const skillResultResponse = await fetch(`${fixture.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { authorization: 'fixture-placeholder', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'desktop-agent-revision-one',
        max_tokens: 321,
        system: '# Revision One\nSAFE_REVISION_ONE desktop-revision-one-skill',
        messages: [
          { role: 'user', content: 'Read desktop-revision-two-skill before replying.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_desktop_local_skill_probe',
                name: 'skill',
                input: { name: 'desktop-revision-two-skill' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_desktop_local_skill_probe',
                content:
                  'Local skill not found: desktop-revision-two-skill PRIVATE_SKILL_SENTINEL',
              },
            ],
          },
        ],
        tools: [{ name: 'read' }, { name: 'skill' }],
      }),
    });
    assert.equal(skillResultResponse.status, 200);
    assert.match(await skillResultResponse.text(), /SAFE_REVISION_ONE/u);
    await assert.rejects(
      fetch('http://127.0.0.1:9/blocked-by-fixture'),
      /blocked a non-local fetch/u,
    );

    const facts = fixture.facts();
    assert.deepEqual(facts.requests, [
      { kind: 'content_safety' },
      {
        kind: 'messages',
        revision: 'REV1',
        modelRevision: 'REV1',
        maxTokens: 321,
        thinkingType: 'disabled',
        knownToolNames: ['read', 'skill'],
        unexpectedToolCount: 0,
        markdownHeadingMatched: true,
        selectedSkillMatched: true,
        skillReadAdmission: 'none',
        credentialHeaderPresent: true,
      },
      {
        kind: 'messages',
        revision: 'REV1',
        modelRevision: 'REV1',
        maxTokens: 321,
        thinkingType: 'omitted',
        knownToolNames: ['read', 'skill'],
        unexpectedToolCount: 0,
        markdownHeadingMatched: true,
        selectedSkillMatched: true,
        skillReadAdmission: 'requested',
        credentialHeaderPresent: true,
      },
      {
        kind: 'messages',
        revision: 'REV1',
        modelRevision: 'REV1',
        maxTokens: 321,
        thinkingType: 'omitted',
        knownToolNames: ['read', 'skill'],
        unexpectedToolCount: 0,
        markdownHeadingMatched: true,
        selectedSkillMatched: true,
        skillReadAdmission: 'denied',
        credentialHeaderPresent: true,
      },
    ]);
    assert.equal(JSON.stringify(facts).includes('PRIVATE_BODY_SENTINEL'), false);
    assert.equal(JSON.stringify(facts).includes('PRIVATE_SAFETY_SENTINEL'), false);
    assert.equal(JSON.stringify(facts).includes('PRIVATE_SKILL_SENTINEL'), false);
    assert.deepEqual(facts.network, { allowedFetches: 4, blockedFetches: 1 });
  } finally {
    await fixture.close();
  }
  assert.equal(globalThis.fetch, originalFetch);
});
