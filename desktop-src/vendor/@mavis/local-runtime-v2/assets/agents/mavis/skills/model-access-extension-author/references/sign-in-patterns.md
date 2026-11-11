# Sign-in patterns

## Device code

`begin` requests a device code, returns
`{ view: { kind: 'device', verificationUrl, userCode, expiresAt }, result, cancel }`, and polls
the token endpoint until approved or `ctx.signal` aborts. Resolve `result` with a `direct-owned`
login result whose `payload` holds `accessToken`, `refreshToken` and `expiresAt`.

## Browser PKCE

Start a loopback listener on `127.0.0.1` (random port), build the authorize URL with a PKCE
challenge and `redirect_uri=http://127.0.0.1:<port>/callback`, return
`{ view: { kind: 'browser', url } }`, exchange the code in the callback, close the listener in
`cancel` and when `ctx.signal` aborts.

## Renewal

`renewOwned(ctx, binding, previous)` returns a complete new `ResolvedCredential` (including the new
refresh token); the host stores it at once and never replays the old refresh token. Throw an error
with `code: 'auth_revoked'` when the vendor says the sign-in is gone. `forceRenewOwned` runs after
the vendor rejected a token on a request.

## Borrowing a desktop or CLI sign-in

Declare the provider with `borrowed-current` and a source with
`subscriptionBorrow.variants: [{ id: 'desktop', targets: ['cn', 'global'] }]`.

- `discover(ctx)`: for each target in `ctx.enabledTargets` read the app's sign-in file
  read-only and return `{ providerId, sourceRef, status, accountMasked? }`. Never read a target
  that is not enabled.
- `resolve(ctx, sourceRef)`: return the current credential (`identity` + opaque `payload`).
- `renew` / `forceRenew`: refresh with the app's refresh token into memory or `ctx.dataDir`;
  never write the refreshed token back into the other application's files.
- Desktop apps may encrypt fields at rest on some platforms; if a field cannot be read, report
  `status: 'unavailable'` instead of guessing.

Example sign-in file locations differ per platform: macOS
`~/Library/Application Support/<App>/`, Windows `%APPDATA%\<App>\`, Linux `~/.config/<App>/`.
