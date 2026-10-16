# TPM Observatory

A local Codex plugin that discovers the models currently available to your account and passively measures their observed output tokens per minute over time.

The panel reports each model and speed tier's latest result, average, 95% confidence interval for the mean, minimum, maximum, and sample count. Completed main-chat turns are captured automatically by bundled hooks. No benchmark prompt or extra model call is made.

## Measurement

`TPM = output tokens / active model-generation time in minutes`

Output tokens include reasoning output tokens because that is the complete generation work reported by Codex. Active duration sums streamed reasoning and assistant-message time while excluding tool and command waits. Standard, Fast, and Ultra Fast observations remain separate series.

Codex requires review and trust for a newly installed plugin hook. After installing or upgrading, approve the TPM Observatory hooks once when Codex asks. The collector reads only the current local transcript and stores numeric telemetry, model, effort, speed tier, session ID, and turn ID in the plugin's private SQLite database.

## Development

```sh
just setup
just check
```

The built plugin is in `plugin/`. Its measurements are stored in the installed plugin's private data directory, not in this repository.

