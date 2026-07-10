const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = require('../out/configSelectionService');

function writeFile(root, relativePath, content = 'value: 1\n') {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

test('discovers ordered YAML configs under config and ignores runtime directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pytest-dsl-config-'));
  writeFile(root, 'config/local.yaml');
  writeFile(root, 'config/base.yml');
  writeFile(root, 'config/env/test.yaml');
  writeFile(root, 'config/node_modules/ignored.yaml');
  writeFile(root, 'outside.yaml');

  const files = config.discoverConfigFiles(root);
  assert.deepEqual(files.map((item) => [item.relativePath, item.defaultConfig]), [
    ['config/base.yml', true],
    ['config/local.yaml', true],
    ['config/env/test.yaml', false],
  ]);
  assert.deepEqual(config.defaultConfigPaths(files), [
    'config/base.yml',
    'config/local.yaml',
  ]);
});

test('resolves stored profiles in declared order and reports missing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pytest-dsl-config-'));
  writeFile(root, 'config/base.yaml');
  writeFile(root, 'config/test.yaml');
  const profiles = config.normalizeConfigProfiles({
    test: ['config/base.yaml', 'config/test.yaml', 'config/missing.yaml'],
  });

  const selection = config.resolveConfigSelection(
    root,
    { kind: 'profile', name: 'test' },
    profiles,
    '',
    [],
  );

  assert.equal(selection.kind, 'profile');
  assert.equal(selection.label, 'test');
  assert.deepEqual(selection.paths, [
    'config/base.yaml',
    'config/test.yaml',
    'config/missing.yaml',
  ]);
  assert.deepEqual(selection.missingPaths, ['config/missing.yaml']);
});

test('falls back from active profile to legacy yamlVars and then automatic mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pytest-dsl-config-'));
  writeFile(root, 'config/local.yaml');
  const profiles = { local: ['config/local.yaml'] };

  assert.equal(
    config.resolveConfigSelection(root, undefined, profiles, 'local', []).label,
    'local',
  );
  const legacy = config.resolveConfigSelection(root, undefined, {}, '', ['config/local.yaml']);
  assert.equal(legacy.kind, 'settings');
  assert.deepEqual(legacy.paths, ['config/local.yaml']);
  assert.equal(config.resolveConfigSelection(root, undefined, {}, '', []).kind, 'auto');
});
