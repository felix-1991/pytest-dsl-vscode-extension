const assert = require("node:assert/strict");
const test = require("node:test");

const language = require("../out/languageService");

test("keyword snippets keep bracket completion safe", () => {
  const keyword = {
    name: "打印",
    parameters: [{ name: "内容", description: "要打印的文本内容" }],
  };

  assert.deepEqual(language.getCompletionContext("[打", 2), {
    kind: "keyword",
    from: 1,
    to: 2,
    prefix: "打",
    inBracket: true,
    replaceNextBracket: false,
  });
  assert.equal(
    language.buildKeywordSnippet(keyword, { inBracket: true }),
    "打印], 内容: ${1:要打印的文本内容}",
  );
  assert.equal(
    language.buildKeywordSnippet(keyword, { inBracket: false }),
    "[打印], 内容: ${1:要打印的文本内容}",
  );
});

test("parameter completions filter used parameters", () => {
  const keyword = {
    name: "HTTP请求",
    parameters: [
      { name: "客户端", description: "客户端名称" },
      { name: "配置", description: "请求配置" },
      { name: "超时", description: "超时时间", default: 30 },
    ],
  };

  const line = '[HTTP请求], 客户端: "default", 配';
  const context = language.getCompletionContext(line, line.length);
  const candidates = language.createParameterCompletionCandidates(keyword, context.usedParameterNames);

  assert.equal(context.kind, "parameter");
  assert.equal(context.keywordName, "HTTP请求");
  assert.deepEqual(candidates.map((item) => item.name), ["配置", "超时"]);
});

test("definition parsers index resource, dsl, and yaml symbols", () => {
  const resource = language.parseResourceDefinitions(
    'function 登录(用户名, 密码="secret") do\nend\n',
    "/workspace/auth.resource",
  );
  assert.deepEqual(resource.map((item) => ({
    name: item.name,
    path: item.path,
    line: item.line,
    parameterNames: item.parameters.map((param) => param.name),
  })), [{
    name: "登录",
    path: "/workspace/auth.resource",
    line: 1,
    parameterNames: ["用户名", "密码"],
  }]);

  const dslVariables = language.parseDslVariableDefinitions(
    'base_url = "https://example.test"\nresult = [HTTP请求], 客户端: "default"\n',
    "/workspace/tests/demo.dsl",
  );
  assert.deepEqual(dslVariables.map((item) => item.name), ["base_url", "result"]);

  const yamlVariables = language.parseYamlVariableDefinitions(
    "clients:\n  default:\n    base_url: https://example.test\n",
    "/workspace/config/env.yaml",
  );
  assert.deepEqual(yamlVariables.map((item) => item.name), [
    "clients",
    "clients.default",
    "clients.default.base_url",
  ]);
  assert.equal(yamlVariables[2].line, 3);
  assert.equal(yamlVariables[2].valuePreview, "https://example.test");
});

test("configured YAML load order marks the last variable value as effective", () => {
  const base = language.parseYamlVariableDefinitions(
    "service:\n  base_url: https://base.test\n",
    "/workspace/config/base.yaml",
  );
  const local = language.parseYamlVariableDefinitions(
    "service:\n  base_url: https://local.test\n",
    "/workspace/config/local.yaml",
  );
  const definitions = language.markEffectiveVariableDefinitions([...base, ...local]);
  const matches = definitions.filter((item) => item.name === "service.base_url");

  assert.deepEqual(matches.map((item) => item.effective), [false, true]);
  assert.equal(
    language.selectEffectiveVariableDefinition(matches).valuePreview,
    "https://local.test",
  );
});

test("DSL assignments take hover precedence over configured YAML values", () => {
  const yamlDefinition = language.parseYamlVariableDefinitions(
    "base_url: https://config.test\n",
    "/workspace/config/env.yaml",
  )[0];
  const dslDefinition = language.parseDslVariableDefinitions(
    'base_url = "https://runtime.test"\n',
    "/workspace/tests/demo.dsl",
  )[0];

  assert.equal(
    language.selectEffectiveVariableDefinition([dslDefinition, yamlDefinition]).kind,
    "dsl-variable",
  );
});

test("diagnostics catch unknown keywords, missing parameters, duplicate parameters, and unclosed variables", () => {
  const diagnostics = language.collectDslDiagnostics(
    [
      "[未知关键字]",
      '[打印], 内容: "a", 内容: "b"',
      "[HTTP请求]",
      'broken = "${base_url"',
    ].join("\n"),
    [
      { name: "打印", parameters: [{ name: "内容", description: "内容" }] },
      { name: "HTTP请求", parameters: [{ name: "客户端", description: "客户端" }] },
    ],
  );

  assert.deepEqual(diagnostics.map((item) => item.code), [
    "unknown-keyword",
    "duplicate-parameter",
    "missing-parameter",
    "unclosed-variable",
  ]);
});
