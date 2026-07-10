const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DslExecutionService,
  buildExecutionArgs,
  projectRelativePath,
} = require('../out/executionService');

test('builds run and debug commands from the shared pytest-dsl workbench contract', () => {
  assert.deepEqual(buildExecutionArgs({
    mode: 'run',
    projectRoot: '/workspace',
    filePath: '/workspace/tests/case.dsl',
    yamlVars: ['config/env.yaml'],
  }, 'tests/case.dsl'), [
    '-m', 'pytest_dsl.cli', 'tests/case.dsl',
    '--yaml-vars', 'config/env.yaml',
  ]);

  assert.deepEqual(buildExecutionArgs({
    mode: 'debug',
    projectRoot: '/workspace',
    filePath: '/workspace/tests/case.dsl',
    pauseFromLine: 8,
  }, 'tests/case.dsl'), [
    '-m', 'pytest_dsl.workbench.runner', 'debug', 'tests/case.dsl',
    '--pause-from-line', '8',
  ]);
});

test('rejects files outside the configured project root', () => {
  assert.throws(
    () => projectRelativePath('/workspace/project', '/workspace/other.dsl'),
    /不在 pytest-DSL 项目目录内/,
  );
});

test('parses structured debug events and forwards step commands over stdin', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pytest-dsl-vscode-run-'));
  const dslFile = path.join(root, 'case.dsl');
  const fakeRuntime = path.join(root, 'fake-runtime.js');
  fs.writeFileSync(dslFile, '[打印], 内容: "ok"\n');
  fs.writeFileSync(fakeRuntime, `
if (process.argv.includes('-c')) process.exit(0);
console.log('__PYTEST_DSL_GUI_EVENT__' + JSON.stringify({
  type: 'debug_step', phase: 'start', line: 3,
  nodeType: 'KeywordCall', description: '打印', status: 'running'
}));
process.stdin.once('data', (chunk) => {
  console.log('command=' + chunk.toString().trim());
  console.log('__PYTEST_DSL_GUI_EVENT__' + JSON.stringify({
    type: 'debug_step', phase: 'finish', line: 3,
    nodeType: 'KeywordCall', description: '打印', status: 'success'
  }));
  process.exit(0);
});
`);

  const events = [];
  const service = new DslExecutionService((event) => {
    events.push(event);
    if (event.type === 'debug-step' && event.phase === 'start') {
      service.sendDebugCommand('next');
    }
  });
  const result = await service.start({
    mode: 'debug',
    projectRoot: root,
    filePath: dslFile,
    configuredPython: `${process.execPath} ${fakeRuntime}`,
  });

  assert.equal(result.status, 'passed');
  assert.ok(events.some((event) => event.type === 'debug-step' && event.phase === 'start' && event.line === 3));
  assert.ok(events.some((event) => event.type === 'stdout' && event.text.includes('command=next')));
  assert.ok(events.some((event) => event.type === 'completed' && event.status === 'passed'));
});
