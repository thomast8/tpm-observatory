# Am I Being Throttled?

Am I Being Throttled? is a desktop-only Codex plugin that passively measures observed model throughput without making benchmark calls. Its dashboard compares models and speed tiers using TPS or TPM, averages, observed ranges, and 95% confidence intervals for the mean. These measurements show speed; they cannot establish whether a provider throttled a turn.

## Install

Am I Being Throttled? requires Codex desktop or Codex CLI, Node.js 22.5 or newer, and the `codex` command on your `PATH`.

```sh
codex plugin marketplace add thomast8/tpm-observatory --ref main
codex plugin add tpm-observatory@tpm-observatory
```

Start a new Codex chat after installation. Open the dashboard by asking Codex to use Am I Being Throttled? or by invoking its `tpm_open` tool.

Codex will ask you to review and trust the bundled hooks. The hooks are required for automatic collection and run only when a prompt starts and a turn stops.

## Measurement

`TPM = output tokens / active model-generation time in minutes`

Output tokens include reasoning output. Active duration is the completed turn duration minus merged tool and command execution intervals, so tool waits are excluded without dropping model responses that invoke tools. Standard, Fast, and Ultra Fast observations remain separate series.

The collector reads only the current local Codex transcript. It stores numeric telemetry, model, effort, speed tier, session ID, and turn ID in the plugin's private SQLite database under `PLUGIN_DATA`. It does not send telemetry anywhere or make extra model calls.

## Upgrade

```sh
codex plugin marketplace upgrade tpm-observatory
codex plugin add tpm-observatory@tpm-observatory
```

Start a new Codex chat after upgrading.

## Development

```sh
just setup
just check
just qa-mcp
```

Source lives in `src/`; `npm run build` writes the installable bundle to `plugin/`.
The Codex marketplace installs the generated `codex-plugin/` compatibility bundle because current Codex releases suppress lifecycle hooks in packages with a root `plugin.json`. The portable package remains in `plugin/`.

