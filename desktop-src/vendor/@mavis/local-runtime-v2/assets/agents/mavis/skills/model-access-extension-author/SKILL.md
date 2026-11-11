---
name: model-access-extension-author
description: |
  Create, run, debug and package a MiniMax Code model access extension: a local package that signs
  in to a model vendor (API key, browser or device sign-in, or an existing desktop/CLI sign-in) and
  serves its models in MiniMax Code. Use when the user asks to add a vendor or subscription that
  MiniMax Code does not offer, to connect their own account of a coding tool, or to turn a reference
  plugin (for example a DeepSeek Harness or OpenCode plugin) into a MiniMax Code extension. Uses the
  model_access_extension tool; the user approves running native code in Desktop.
listed: false
---

# Model access extension author

Build a model access extension package in a folder of the current workspace, run it in a
development session, fix it until it loads, then let the user keep it.

## Safety rules

- An extension is native code running with the user's rights. Never start a development session
  without telling the user what the package reads (files, keychain, other apps' sign-ins) and
  which hosts it calls. The user approves in Desktop; you cannot approve for them.
- Never print, log or return tokens, cookies, API keys or credential file contents. Treat any
  credential you read as opaque: put it in the returned `payload`/`apiKey`, never in messages.
- Read another application's sign-in files only for targets the user enabled
  (`ctx.enabledTargets`), read-only, and never write back to that application's files.
- Do not copy large parts of third-party code. Port the protocol (endpoints, headers, flows) and
  write the extension yourself; credit the reference in the package README.

## Workflow

1. Establish the vendor's access path: API key, browser PKCE, device code, CLI/desktop sign-in
   to borrow, or a public endpoint. Ask only for what is missing (regions, model list source).
2. Create the package folder (e.g. `<workspace>/model-access/<name>`) from
   `references/package-layout.md`. Default to one dependency-free `index.mjs`.
3. Call `model_access_extension` with `{"action":"preview","path":...}`. Fix manifest errors
   (`invalid_package`, `incompatible_sdk`, `dependency_unsupported`) and preview again.
4. Call `{"action":"start_dev","path":...}`. Desktop shows a consent card in this conversation;
   the call waits until the user runs or declines it. If you edit files before they decide, call
   `start_dev` again so the card shows the new content. On `declined`, stop and ask what to change.
5. Call `probe` to confirm the declared providers and entry points. Ask the user to open Agent
   model access, click the vendor tagged "In development", sign in or pick the borrow entry, and
   send one message with a model of the extension.
6. After every edit call `reload`; running conversations keep the old code until they finish.
   Use `status` for load errors (`activation_failed`, `invalid_handlers`).
7. When it works, call `{"action":"keep","path":...}`: the user confirms in this conversation and
   the extension stays after a restart (a dev session alone does not). You can also `export` a zip
   for them (`{"action":"export","path":...,"target":"/abs/out.zip"}`).
8. To change an extension the user already kept, edit its folder and `start_dev` it again under
   the same `name`: it runs in place of the kept one (same sign-ins), stopping returns the kept
   version, `keep` updates it. Never tell the user to uninstall first.

## Porting a reference plugin

Users usually give only a link or path ("make an extension like this repo"). Do the rest yourself:

1. Get the source read-only, e.g. `git clone --depth 1 <url> <workspace>/reference/<repo>`. If the
   network fails, ask the user for a local copy instead of guessing the protocol.
2. Find how it signs in (key, browser, device code, or another app's stored sign-in and how it is
   located/decrypted), how it renews, the endpoint, required headers and body fields, how the
   stream is converted, and region or edition differences. Tell the user these findings in a few
   bullets (no secrets) before writing code.
3. Port only model access: sign-in or borrow, model list, streaming chat, renewal. Leave out the
   host's plugin framework, UI, commands, tools, account pools and usage dashboards; list what you
   left out at the end.
4. Pick your own `@local/<vendor>` name and a provider id that does not collide with an installed
   or official extension. Put editions or regions in one package as source targets unless they
   need different code.
5. Then follow the workflow from step 2. Credit the reference in the package README.

## References

The two references are appended below this Skill when it is loaded:

- `references/package-layout.md`: manifest (schema 2), handler contract and a complete
  API-key example.
- `references/sign-in-patterns.md`: device code, browser PKCE and borrowing a desktop/CLI
  sign-in, with renewal.

## Errors

| Code | Meaning | Fix |
| --- | --- | --- |
| `invalid_package` | Manifest, layout or icon invalid | Compare with package-layout.md; icons must be PNG/JPEG/WebP ≤ 1 MiB |
| `dependency_unsupported` | Import of a bare package or computed import | Inline the code or bundle it into `.mjs` files |
| `package_name_reserved` | Name starts with `@mavis/` | Use your own scope, e.g. `@local/<vendor>` |
| `package_name_taken` | An official package has this name, or `name` changed during a dev session | Use your own `name` and keep it stable |
| `unsupported_host_version` | `engines.desktop` above this app | Lower the floor or update the app |
| `activation_failed` / `invalid_handlers` | Module threw or handlers do not match the manifest | Every declared provider/source entry needs exactly the declared handlers |
| `service_disabled` | Model access is turned off remotely | Nothing to fix locally |
