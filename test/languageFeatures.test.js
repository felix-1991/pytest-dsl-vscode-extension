const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class MarkdownString {
  constructor() {
    this.value = '';
  }

  appendMarkdown(value) {
    this.value += value;
    return this;
  }
}

class Hover {
  constructor(contents, range) {
    this.contents = contents;
    this.range = range;
  }
}

const vscodeStub = {
  MarkdownString,
  Hover,
  Position,
  Range,
  workspace: {
    findFiles: async () => [],
    textDocuments: [],
    fs: { readFile: async () => Buffer.from('') },
  },
  languages: {
    createDiagnosticCollection() {
      return { dispose() {}, delete() {}, set() {} };
    },
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { DslHoverProvider } = require('../out/languageFeatures');

test('variable hover displays the effective configured YAML value and source', async () => {
  const text = 'url = "${service.base_url}"';
  const document = {
    getText: () => text,
    offsetAt: (position) => position.character,
    positionAt: (offset) => new Position(0, offset),
  };
  const provider = new DslHoverProvider(
    { getKeywords: async () => [] },
    {
      findVariableDefinitions: async () => [
        {
          name: 'service.base_url',
          path: '/workspace/config/base.yaml',
          line: 2,
          column: 3,
          kind: 'yaml-variable',
          valuePreview: 'https://base.test',
          effective: false,
        },
        {
          name: 'service.base_url',
          path: '/workspace/config/local.yaml',
          line: 4,
          column: 3,
          kind: 'yaml-variable',
          valuePreview: 'https://local.test',
          effective: true,
        },
      ],
    },
  );

  const hover = await provider.provideHover(document, new Position(0, 12));

  assert.match(hover.contents.value, /\*\*变量\*\* `\$\{service\.base_url\}`/);
  assert.match(hover.contents.value, /\*\*当前值\*\* `https:\/\/local\.test`/);
  assert.match(hover.contents.value, /\*\*来源\*\* local\\\.yaml:4/);
  assert.match(hover.contents.value, /其他定义: 1 个/);
  assert.deepEqual(hover.range, new Range(new Position(0, 9), new Position(0, 25)));
});
