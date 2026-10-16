# TPM Observatory

A local Codex plugin that discovers the models currently available to your account and measures their observed output tokens per minute over time.

The panel reports each model's latest result, average, 95% confidence interval for the mean, minimum, maximum, and sample count. Measurements use an isolated ephemeral Codex turn with no tools, environment access, plugins, web search, or project files.

## Measurement

`TPM = output tokens / completed turn duration in minutes`

Output tokens include reasoning output tokens because that is the complete generation work reported by Codex. Turn duration is end-to-end model turn time, so the result is an observed throughput measure rather than decode-only speed. Benchmarks use the model's lowest advertised reasoning effort and consume normal Codex allowance.

## Development

```sh
just setup
just check
```

The built plugin is in `plugin/`. Its measurements are stored in the installed plugin's private data directory, not in this repository.

