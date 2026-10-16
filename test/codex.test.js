import assert from 'node:assert/strict';
import test from 'node:test';
import { disableCapabilities, selectEffort } from '../src/codex.js';

test('uses low effort when the model advertises it', () => {
  assert.equal(
    selectEffort({
      defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'low' }],
    }),
    'low',
  );
});

test('falls back to the model default effort', () => {
  assert.equal(
    selectEffort({
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
    }),
    'medium',
  );
});

test('disables every inherited plugin, app, and MCP server', () => {
  const overlay = disableCapabilities({
    plugins: ['alpha@local'],
    apps: { calendar: { enabled: true } },
    mcp_servers: { browser: { enabled: true } },
  });
  assert.deepEqual(overlay.plugins, { 'alpha@local': { enabled: false } });
  assert.deepEqual(overlay.apps, {
    calendar: { enabled: false },
    _default: { enabled: false },
  });
  assert.deepEqual(overlay.mcp_servers, { browser: { enabled: false } });
  assert.equal(overlay.features.hooks, false);
  assert.equal(overlay.web_search, 'disabled');
});

