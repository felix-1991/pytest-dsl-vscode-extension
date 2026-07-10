const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const runtime = require("../out/pythonRuntimeResolver");

function makeExecutable(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "#!/usr/bin/env python\n");
  fs.chmodSync(filePath, 0o755);
}

test("resolves project .venv before venv and PATH fallback by default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pytest-dsl-runtime-"));
  const dotVenvPython = path.join(root, ".venv", "bin", "python");
  const venvPython = path.join(root, "venv", "bin", "python");
  makeExecutable(dotVenvPython);
  makeExecutable(venvPython);

  const targets = runtime.resolvePythonTargets(root, {
    configuredPython: "",
    platform: "darwin",
    env: {},
  });

  assert.deepEqual(targets.slice(0, 4).map((target) => ({
    command: target.command,
    source: target.source,
  })), [
    { command: dotVenvPython, source: "project-venv" },
    { command: venvPython, source: "project-venv" },
    { command: "python3", source: "path" },
    { command: "python", source: "path" },
  ]);
});

test("explicit configured python takes precedence over project venvs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pytest-dsl-runtime-"));
  makeExecutable(path.join(root, ".venv", "bin", "python"));

  const targets = runtime.resolvePythonTargets(root, {
    configuredPython: "/opt/python/bin/python",
    platform: "darwin",
    env: {},
  });

  assert.deepEqual(targets, [{
    command: "/opt/python/bin/python",
    args: [],
    source: "configuration",
    required: true,
  }]);
});

test("uses Windows virtualenv python candidates on win32", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pytest-dsl-runtime-"));
  const dotVenvPython = path.join(root, ".venv", "Scripts", "python.exe");
  makeExecutable(dotVenvPython);

  const targets = runtime.resolvePythonTargets(root, {
    configuredPython: "",
    platform: "win32",
    env: {},
  });

  assert.equal(targets[0].command, dotVenvPython);
  assert.equal(targets[0].source, "project-venv");
  assert.deepEqual(targets.slice(1, 3).map((target) => [target.command, target.args]), [
    ["python", []],
    ["py", ["-3"]],
  ]);
});

test("adds UTF-8 Python process environment for indexing", () => {
  assert.deepEqual(runtime.withPythonProcessEnv({ PYTHONPATH: "src" }), {
    PYTHONPATH: "src",
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  });
});
