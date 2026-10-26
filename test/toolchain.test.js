import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const check = new URL('../scripts/check-toolchain.mjs', import.meta.url).href;
test('toolchain rejects old Node/Corepack before invoking pnpm', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rime-toolchain-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const [node, corepack, accepted] of [
    ['24.14.0', '0.36.0', false], ['24.15.0', '0.36.0', true],
    ['25.0.0', '0.36.0', false], ['26.0.0', '0.36.0', true],
    ['26.8.1', '0.23.0', false], ['26.8.1', '0.35.9', false],
    ['26.8.1', '0.37.0', true],
  ]) {
    await fs.writeFile(path.join(dir, 'corepack'), `#!/bin/sh\necho ${corepack}\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `Object.defineProperty(process.versions, 'node', {value:${JSON.stringify(node)}}); await import(${JSON.stringify(check)});`],
    { env: { ...process.env, PATH: dir }, encoding: 'utf8' });
    assert.equal(result.status === 0, accepted, `${node} / ${corepack}: ${result.stderr}`);
  }
});
test('release build isolates pnpm settings and preserves npm cache', () => {
  const script = `
import importlib.util, pathlib, tempfile, os
spec = importlib.util.spec_from_file_location('adapter', 'tooling/release/adapter.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
with tempfile.TemporaryDirectory() as d:
    a.STORE = pathlib.Path(d) / 'project'
    for key in ('production', 'store_dir', 'enable_global_virtual_store', 'package_import_method'):
        os.environ['npm_config_' + key] = 'stale'
    env = a.build_env(pathlib.Path(d))
    assert env['pnpm_config_production'] == 'false'
    assert env['pnpm_config_enable_global_virtual_store'] == 'false'
    assert env['pnpm_config_package_import_method'] == 'copy'
    assert env['pnpm_config_store_dir'] == str(pathlib.Path(d) / '.build-cache/pnpm')
    assert env['npm_config_cache'] == str(pathlib.Path(d) / '.build-cache/npm')
    assert not any('npm_config_' + k in env for k in ('production', 'store_dir', 'enable_global_virtual_store', 'package_import_method'))
`;
  execFileSync('python3', ['-B', '-c', script], { cwd: new URL('../', import.meta.url) });
});
