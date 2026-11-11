# Package layout

```text
my-extension/
  model-access.json      manifest, read without running code
  index.mjs              entry (package-relative imports of .mjs/.json and node: builtins only)
  assets/icon.png        optional, PNG/JPEG/WebP, at most 1 MiB
  README.md              what it signs in to, where credentials live, the reference it ports
```

No `node_modules`, symlinks, bare imports (`import x from 'lodash'`) or computed imports. At most
512 files, 32 MiB per file, 64 MiB total.

## Manifest (schema 2)

```json
{
  "schemaVersion": 2,
  "name": "@local/acme",
  "version": "0.1.0",
  "entry": "./index.mjs",
  "engines": { "mcodeSdk": "^2", "desktop": ">=3.1.0" },
  "trust": "native-code",
  "platforms": ["darwin", "win32", "linux"],
  "providers": [
    { "id": "acme", "credentialSchema": 1, "credentialKinds": ["direct-owned"] }
  ],
  "sources": [
    {
      "id": "acme",
      "hostAgentId": "acme",
      "capabilities": {
        "login": { "methods": [{ "id": "key", "kind": "secret-form", "targets": ["global"] }] }
      }
    }
  ],
  "presentation": {
    "providers": {
      "acme": { "displayName": { "en": "Acme", "zhHans": "Acme" }, "icon": "./assets/icon.png" }
    }
  }
}
```

- `id`s: lowercase letters, digits and `-`, starting with a letter.
- `credentialKinds`: `direct-owned` (MiniMax Code stores the sign-in), `borrowed-current`
  (reuse a sign-in another app keeps), `public` (no account; must be the only kind).
- Login kinds: `secret-form`, `browser-pkce`, `device-code`, `cli`.
- A provider id may equal an official one (e.g. `workbuddy`); it is shown as your extension and
  keeps its own sign-ins.

## Handlers

`export default { providers, sources, dispose? }`, keyed exactly like the manifest. Each handler
receives `ctx` (`signal`, `dataDir` — the only directory you may write — `enabledTargets`,
`sessionKey`).

Provider handlers: `models(ctx, binding, credential)`, `bindTransport(ctx, credential, model)`
returning `{ api, modelId, baseUrl, apiKey?, headers?, fetch? }` where `api` is
`openai-completions`, `openai-responses` or `anthropic-messages`, `classifyError(error)` returning
`{ category, code, retryable }`, and optionally `usage`, `resolveOwned`, `renewOwned`,
`forceRenewOwned`, `forget`.

## Complete API-key example

```js
const BASE = 'https://api.acme.example/v1';

export default {
  providers: {
    acme: {
      resolveOwned: async (_ctx, _binding, payload) => ({
        identity: { providerId: 'acme', region: 'global', tenant: 'personal', subject: payload.subject },
        payload,
      }),
      models: async (ctx, _binding, credential) => {
        const response = await fetch(`${BASE}/models`, {
          headers: { authorization: `Bearer ${credential.payload.apiKey}` },
          signal: ctx.signal,
        });
        if (!response.ok) throw Object.assign(new Error('models_failed'), { status: response.status });
        const body = await response.json();
        return body.data.map((item) => ({ id: item.id, api: 'openai-completions', tools: true }));
      },
      bindTransport: async (_ctx, credential, model) => ({
        api: 'openai-completions',
        modelId: model.id,
        baseUrl: BASE,
        apiKey: credential.payload.apiKey,
      }),
      classifyError: (error) => {
        const status = error?.status;
        if (status === 401 || status === 403) return { category: 'credential', code: 'unauthorized', retryable: false };
        if (status === 429) return { category: 'rate-limit', code: 'rate_limited', retryable: true };
        return { category: 'network', code: 'upstream_failed', retryable: true };
      },
    },
  },
  sources: {
    acme: {
      login: {
        key: {
          begin: async () => {
            let submitted;
            const result = new Promise((resolve) => (submitted = resolve));
            return {
              view: { kind: 'secret-form', fields: [{ id: 'apiKey', label: 'API key' }] },
              submit: async (values) => {
                const apiKey = values.apiKey.trim();
                submitted({
                  kind: 'direct-owned',
                  providerId: 'acme',
                  credentialSchema: 1,
                  identity: {
                    providerId: 'acme',
                    region: 'global',
                    tenant: 'personal',
                    subject: apiKey.slice(-6),
                    accountMasked: `…${apiKey.slice(-4)}`,
                  },
                  payload: { apiKey, subject: apiKey.slice(-6) },
                });
              },
              result,
              cancel: () => {},
            };
          },
        },
      },
    },
  },
};
```
