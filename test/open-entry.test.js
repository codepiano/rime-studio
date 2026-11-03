import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('entry uses versioned startup before opening and propagates startup or browser failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rime-entry-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'bin'));
    fs.copyFileSync(new URL('../scripts/open-entry.sh', import.meta.url), path.join(root, 'scripts/open-entry.sh'));
    fs.writeFileSync(path.join(root, 'control-panel.json'), JSON.stringify({ frontendUrl: 'http://127.0.0.1:4312' }));
    fs.writeFileSync(path.join(root, 'scripts/release-start.sh'), '#!/bin/sh\necho start >> "$ENTRY_EVENTS"\nexit "${START_EXIT:-0}"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'bin/open'), '#!/bin/sh\necho "open $1" >> "$ENTRY_EVENTS"\nexit "${OPEN_EXIT:-0}"\n', { mode: 0o755 });
    const events = path.join(root, 'events');
    const run = (extra = {}) => {
      fs.writeFileSync(events, '');
      return spawnSync('/bin/bash', ['scripts/open-entry.sh'], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, ENTRY_EVENTS: events, ...extra } });
    };
    assert.equal(run().status, 0);
    assert.equal(fs.readFileSync(events, 'utf8'), 'start\nopen http://127.0.0.1:4312\n');
    assert.equal(run({ START_EXIT: '17' }).status, 17);
    assert.equal(fs.readFileSync(events, 'utf8'), 'start\n');
    const failed = run({ OPEN_EXIT: '2' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /无法打开浏览器/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
