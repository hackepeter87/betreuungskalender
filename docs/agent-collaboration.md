# Codex agent collaboration

This repository uses project-scoped Codex configuration to delegate bounded
work while keeping planning, integration, and acceptance with the main agent.
The configuration does not grant release, deployment, merge, or external-write
permissions.

## Requirements and activation

The configuration was validated with `codex-cli 0.171.0`. The client must
support trusted project configuration in `.codex/config.toml`, custom agents in
`.codex/agents/*.toml`, explicit model selection, and per-agent reasoning
effort. Start a new Codex session after pulling a configuration change. Codex
loads project configuration only for repositories marked as trusted.

Project settings take precedence over user settings for the keys defined here.
No project-wide main model is set: the main agent continues to use the capable
model selected for the current assignment.

## Roles and models

| Role | Configured model | Reasoning | Use |
| --- | --- | --- | --- |
| Main agent | Session-selected; inspected default was `gpt-5.6-sol` | Session-selected; inspected default was `high` | Planning, decisions, difficult debugging, integration, and final acceptance |
| `explorer` | `gpt-5.6-luna` | `high` | Read-only, targeted repository reconnaissance with cited findings |
| `mechanic` | `gpt-5.6-luna` | `high` | Bounded changes that follow a confirmed pattern and explicit file ownership |
| `reviewer` | `gpt-5.6-sol` | `high` | Targeted review where correctness or regression risk warrants a stronger model |

The requested candidate `gpt-6-luna` was not present in the account-scoped
model catalog returned by `codex debug models` during validation.
`gpt-5.6-luna` is therefore the explicit lower-cost fallback for routine roles.
This changes the model generation and advertised cost class; no numerical
saving is claimed without measured usage data. The project default for any
otherwise unspecified subagent is also `gpt-5.6-luna` with `high` reasoning,
which prevents silent inheritance of the main model.

Agent files can disable unnecessary tools and instructions, but they cannot
override the parent session's sandbox or approval policy. The explorer's
read-only behavior is therefore both an explicit role contract and subject to
main-agent review.

## Delegation contract

The main agent delegates when a sufficiently large task has a clear boundary,
expected output, and verifiable checks. Related routine changes are bundled.
Fully specified transformations use repository tools, formatters, codemods, or
scripts instead of a model where practical.

Every delegated request includes only the necessary files, binding rules,
expected result, and checks. Writing agents receive non-overlapping ownership;
dependent or overlapping changes run sequentially. At most three subagents run
alongside the main agent. Reports remain short and cover evidence or changed
files, checks, and unresolved problems. Only the main agent delegates. Each
custom child profile explicitly forbids spawning further agents. The validated
client does not expose a supported per-role capability switch or separate
project setting for delegation depth, so this boundary is instructional and
must also be enforced by main-agent review.

A focused retry is allowed after one failed attempt. After two unsuccessful
attempts on the same problem, the main agent reassesses the approach or takes
over. The main agent always reviews delegated output, integrates it, and runs
the checks required for the complete issue or milestone.

## Verification

Use the installed client rather than model names from documentation alone:

```bash
codex --version
codex debug models
codex -C /path/to/betreuungskalender --strict-config doctor --summary
```

`codex-cli 0.171.0` does not support combining `--strict-config` with
`debug models`; use the two separate commands above. A successful
`config.load` check proves that the installed client accepted the project
schema. Other `doctor` checks can still report unrelated user-state or network
problems and must be assessed separately.

`scripts/agent-configuration.test.ts` provides the deterministic repository
gate. It checks the concurrency default, explicit role models and reasoning,
exact role identifiers, supported disabled child capabilities, and the explicit
instruction against nested delegation. Client schema acceptance and
account-specific model availability remain runtime checks because CI does not
install or authenticate Codex.

The agent files establish the **configured** model assignment. Runtime
confirmation requires a newly started session that invokes the named agent and
exposes the child thread's model in its runtime or session metadata. The
Subagents view (or `/subagents`, where available) can be used to inspect the
child thread. Record configured and runtime-confirmed assignments separately;
never infer runtime use solely from a role name.

The validation run on 2026-11-20 confirmed the configured model catalog and
strict configuration load. A direct host-runtime probe created a child thread
with an explicit `gpt-5.6-luna` and `high` assignment; it completed a bounded
read-only consistency review. This confirms that the selected economical model
can execute delegated work.

Automatic project-profile selection is not yet runtime-confirmed. Two bounded
`codex exec` probes did not provide a child-thread record: their JSON events
contained no receiver thread, and one run reported an unsupported collaboration
call. Text produced by the main thread named `gpt-5.6-luna`, but that alone is
not runtime proof. Recheck the named `explorer` role in a new interactive
session, or after a client update fixes the non-interactive collaboration path.

If a configured model disappears from the local catalog, do not let the role
fall back silently. Select and document an available replacement appropriate to
the role, including whether its cost class is higher, then validate it in a new
session.

Assess economy across the complete workflow: delegation setup, child runtime,
main-agent review, retries, and integration. Do not invent token counts, prices,
or savings when the client does not expose them.

References:

- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Codex configuration basics](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

