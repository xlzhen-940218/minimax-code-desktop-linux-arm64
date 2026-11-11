# Remote model catalog and sidebar session compatibility

## Approved scope

- `/minimax-cloud/api/v1/remote-control/models` returns the complete Desktop model catalog without a
  per-field bridge projection.
- `/archon/api/v1/sidebar/session` returns the persisted `reasoning` selection while preserving
  legacy `variant` compatibility.
- Existing routes, Remote Control transport, storage, model execution, and configuration remain
  unchanged.

## Domain terms

- **Model catalog**: response metadata used to render model choices and their optional parameters.
- **Model selection**: the values selected for one session, such as `reasoning`, `context_limit`,
  and `thinking_effort`.

Catalog options are not copied into every session response. Session responses expose only selected
values.

## Seams

### Remote Control catalog seam

`/minimax-desktop/api/v1/models/list` already encodes `model_provider.ListModelsResp` as JSON. The
existing directed `MODEL_LIST` command remains the transport. The Electron bridge validates the
response status, relays the complete `ListModelsResp` JSON without enumerating top-level or model
fields, and normalizes only a missing or non-array `models` value to `[]`. Remote Gateway and
archon-biz continue carrying the complete body as `ack_json`.

The public `RCModelListResp` wrapper remains. Its `models` element and the Remote Gateway
`AckModelListPayload.models` use `model_provider.ModelInfo`, making that existing IDL type the
catalog source of truth. The service return wrapper is not replaced, so the endpoint method shape
remains stable.

### Sidebar selection seam

`convertServerModelSelectionToBiz` remains the common archon-server-to-legacy projection and keeps
its existing queue/event behavior. `archon_biz_base.ModelInfo` gains an optional `reasoning` field.
Only the Sidebar Session adapter copies an explicit server value and infers legacy `thinking` /
`none-thinking` variants when the value is absent.

Only the Cloud Session legacy-to-view adapter prefers the explicit legacy `reasoning` field and
retains variant inference as a fallback. The shared legacy model adapter remains variant-only so
queue conversion does not gain a new field. The old Sidebar Session response is not replaced by
`session.SessionInfoView` because the two session DTOs have different fields and incompatible Thrift
field assignments.

## External contracts

- **API response shape**:
  - Remote Control models gain the optional fields already declared by `model_provider.ModelInfo`;
    existing JSON keys keep their meanings.
  - Legacy Sidebar Session `model` gains optional `reasoning`.
- **IDL**:
  - `RCModelListResp.models` and `AckModelListPayload.models` reuse `model_provider.ModelInfo`.
  - `archon_biz_base.ModelInfo` appends optional `reasoning` on a new field ID.
- **RPC**: `RemoteCommandResp.ack_json` remains a string and archon-server RPC signatures remain
  unchanged.
- **DB schema and migrations**: none.
- **Persisted state formats**: none.
- **Queue/event payloads**: none.
- **Config schema**: none.

Changing the generated catalog element type is a source-level change for newly generated SDKs. The
deployed HTTP and Remote Gateway RPC wire remain JSON-compatible; existing keys are preserved and
new keys are optional.

## Architecture impact

- `weaver/idl`: catalog DTO reuse and additive legacy selection field.
- `agent-archon/packages/remote-control-bridge`: remove the shallow field projection.
- `archon_biz/internal/domain/session/service`: preserve and recover `reasoning` in existing
  adapters.
- Dependency direction: `remote_gateway_base.thrift` additionally imports the existing
  `api_common/model_provider.thrift`; no runtime module gains a new dependency.
- No module, interface, or transport is added or moved.

## Dependency decision

No dependency is needed. Existing generated IDL contracts, JSON handling, and repository test tools
cover the change. No library documentation lookup is needed.

## Rejected alternatives

- Switching model list to generic RemoteForward: adds allowlist and rollout work without improving
  the contract.
- Replacing `RCModelListResp` with `model_provider.ListModelsResp`: changes the generated method
  return type unnecessarily.
- Replacing the legacy Sidebar response with `session.ListSidebarSessionsResp`: drops legacy fields
  and creates Thrift compatibility problems.
- Extracting a new shared session model contract: broader than this compatibility fix.
