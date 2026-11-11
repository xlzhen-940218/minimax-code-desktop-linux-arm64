# MiniMax Code user and project Hooks reference

Use this reference when the user asks to create, change, explain, or troubleshoot a Hook for
themselves or for one project in MiniMax Code Desktop or TUI. A Hook runs a shell command when an
Agent lifecycle event happens, for example before a tool call or when a conversation starts. This
configuration ships with the current client; it needs no regional documentation lookup.

## Choose where the Hook belongs

| Owner   | File                                 | Runs for                                                          |
| ------- | ------------------------------------ | ----------------------------------------------------------------- |
| User    | `{{DATA_DIR}}/hooks.json`            | every local Desktop and TUI conversation of this user             |
| Project | `<project root>/.minimax/hooks.json` | conversations whose project directory is exactly `<project root>` |

- "Global", "all projects", or "for me" means the user file. "This project" or "this repo" means the
  project file of the current conversation's project directory, as shown by the workspace in
  Environment. A parent folder or a nested subfolder is a different project; conversations without a
  project load no project Hooks. If the target is unclear, ask which one.
- The project file lives in the repository. Committing it shares the Hook with collaborators, and
  worktrees of the project read their own committed copy.
- Write a local Plugin with the `plugin-creator` Skill only when the user wants to package, share,
  or distribute the Hook together with other Plugin capabilities.
- Write a MiniMax Code Hook only to the two files above. Never put it in another coding assistant's
  settings or configuration folder; MiniMax Code does not read those files.
- Cloud conversations on Web and App do not load these files.

## File format

```json
{
  "enabled": true,
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "write|edit",
        "hooks": [
          {
            "type": "command",
            "name": "Block file edits",
            "command": "echo 'Editing files is not allowed right now.' >&2; exit 2",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

- The document is one JSON object with a `hooks` object. Each key is an event name; each value is an
  array of groups, and each group has an optional `matcher` and a `hooks` array of handlers.
- Author only these handler fields: required `type: "command"`; required non-empty `command`;
  optional `name`, a display label of up to 64 characters shown in Settings; optional
  `commandWindows`, used instead of `command` on Windows; optional integer `timeout` from 1 through
  10 seconds, default 5.
- User file only: the top-level `"enabled": true` is required, otherwise no user Hook runs. A
  handler with `"enabled": false` is off. The project file ignores both fields.
- Edit an existing file in place: read it first, keep every other entry and unknown field, and write
  valid JSON. Never replace the whole file to add one Hook. When creating the user file, set its
  permissions to `600` on macOS and Linux.
- One file may hold at most 64 executable handlers and 256 KiB. An invalid file disables every Hook
  in it.
- Changes take effect from the next turn, not the current one.

## Turning project Hooks on

A project Hook written to the file does not run until the user turns on its switch in Settings →
Hooks after picking the project there (设置 → 钩子 → 项目) on this computer. Changing an existing
project Hook's event, matcher, command, Windows command, or timeout turns it off again; renaming it
does not. After writing a project Hook, tell the user to turn it on there. Never edit the local
enablement state under `{{DATA_DIR}}` yourself.

The user can also create, edit, enable, and disable both kinds of Hooks in that settings page, which
offers per-event examples. Its Global tab manages the user file.

## Events

| Event               | When it runs                                   | `matcher` filters on                           |
| ------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `SessionStart`      | before the first model processing of a session | `source`: `startup`, `resume`, ...             |
| `SessionEnd`        | when a session is left, archived, or idles out | `reason`: `clear`, `logout`, `resume`, `other` |
| `UserPromptSubmit`  | after the user sends a message                 | nothing; omit `matcher`                        |
| `PreToolUse`        | before a tool runs                             | tool name                                      |
| `PermissionRequest` | when a tool needs a permission decision        | tool name                                      |
| `PostToolUse`       | after a tool finishes                          | tool name                                      |
| `SubagentStart`     | before a Subagent starts                       | `agent_type`                                   |
| `SubagentStop`      | when a Subagent is ready to stop               | `agent_type`                                   |
| `Stop`              | when the main Agent is ready to stop           | nothing; omit `matcher`                        |
| `PreCompact`        | before context compaction                      | `trigger`: `manual` or `auto`                  |
| `PostCompact`       | after context compaction                       | `trigger`: `manual` or `auto`                  |

Omit `matcher` to run on every occurrence. Matching is case-sensitive; separate exact alternatives
with `|`. Tool names are the native names shown to the model, such as `bash`, `read`, `write`,
`edit`, and `task`, not `Bash` or `Write`.

## Command behavior

- Commands run through `/bin/sh` on macOS and Linux, with the conversation's workspace as the
  working directory, and receive one JSON object on stdin with `hook_event_name`, `session_id`,
  `cwd`, and event fields such as `tool_name`, `tool_input`, `prompt`, or `stop_hook_active`.
- `${MINIMAX_PROJECT_DIR}` is the workspace, `${MINIMAX_HOOKS_DIR}` is the folder of the
  `hooks.json` that declared the Hook, and `${MINIMAX_HOOKS_DATA}` is a persistent folder for the
  Hook's own logs and state. Write files there, not into the project.
- All matching Hooks of one event share 15 seconds; `SessionEnd` Hooks share 3 seconds.
- Hooks run with the user's own permissions and no sandbox. Confirm with the user before writing a
  command that deletes or changes files, or sends data over the network. Never put secrets in a Hook
  file; the project file is committed with the code.

Valid structured JSON on stdout is applied whatever the exit code, so a command that prints a deny
decision and then exits 1 still denies. Otherwise exit codes decide the result. Exit code 0
succeeds. Any exit code other than 0 or 2 is a failure and the Agent continues as if the Hook did
not run. Exit code 2 blocks, and stderr becomes the reason:

| Event                                                        | Effect of exit code 2                                   |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `PreToolUse`                                                 | the tool call is denied and the Agent sees stderr       |
| `UserPromptSubmit`                                           | the message is blocked                                  |
| `Stop`, `SubagentStop`                                       | the Agent continues once with stderr as the instruction |
| `PostToolUse`                                                | stderr is added as context for the Agent                |
| `PreCompact`                                                 | compaction is postponed                                 |
| `PermissionRequest`                                          | no effect; deny with JSON instead                       |
| `SessionStart`, `SessionEnd`, `SubagentStart`, `PostCompact` | no effect; recorded as a failure                        |

For `SessionStart` and `UserPromptSubmit`, plain text written to stdout with exit code 0 is added as
context for the Agent. Use structured stdout JSON only for what exit codes cannot express: asking
for permission, rewriting tool input, resolving `PermissionRequest`, or adding `SubagentStart`
context. Its schema is the same as for Plugin Hooks; load the `plugin-creator` Skill and read only
its `references/local-plugin-hooks.md` output sections for it. A `Stop` Hook that blocks must exit 0
when `stop_hook_active` is `true` in its input; otherwise it makes the Agent continue up to eight
extra times in one turn.

## Verify before reporting

1. Parse the edited file as JSON and confirm the event name, matcher, and handler fields.
2. Run the command once with a representative JSON object on stdin and check its exit code and
   output.
3. Tell the user which file changed, that the Hook works from the next turn, and, for a project
   Hook, that it must be turned on in Settings → Hooks → Project first.
