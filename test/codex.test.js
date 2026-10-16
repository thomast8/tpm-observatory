import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { CodexTransport } from '../src/codex.js';

test('matches JSON-RPC responses to requests', async () => {
  const child = fakeChild();
  const transport = new CodexTransport(child, 100);
  const request = transport.request('model/list', { cursor: null });
  const sent = JSON.parse(await nextLine(child.stdin));
  child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: { data: [] } })}\n`);
  assert.deepEqual(await request, { data: [] });
  transport.close();
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
}

function nextLine(stream) {
  return new Promise((resolve) => stream.once('data', (chunk) => resolve(chunk.toString().trim())));
}
