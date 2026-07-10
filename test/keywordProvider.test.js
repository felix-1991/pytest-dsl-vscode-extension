const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Module = require("node:module");

let activeConfig = {};

const vscodeStub = {
  workspace: {
    workspaceFolders: [],
    getConfiguration() {
      return {
        get(key, defaultValue) {
          return Object.prototype.hasOwnProperty.call(activeConfig, key)
            ? activeConfig[key]
            : defaultValue;
        },
      };
    },
  },
  window: {
    showWarningMessage() {
      return Promise.resolve(undefined);
    },
    showErrorMessage() {
      return Promise.resolve(undefined);
    },
  },
  env: {
    openExternal() {
      return Promise.resolve(true);
    },
  },
  Uri: {
    file(filePath) {
      return { fsPath: filePath };
    },
  },
  commands: {
    executeCommand() {
      return Promise.resolve(undefined);
    },
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { KeywordProvider } = require("../out/keywordProvider");

test("dynamic keyword indexing reads JSON from the CLI output file despite stdout logs", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pytest-dsl-keywords-"));
  const fakeCli = path.join(projectRoot, "fake-pytest-dsl-cli.js");
  fs.writeFileSync(fakeCli, `
const fs = require("node:fs");
const outputIndex = process.argv.indexOf("--output");
process.stdout.write("正在加载关键字...\\n");
if (outputIndex !== -1) {
  fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify({
    summary: {
      total_count: 1,
      category_counts: { builtin: 1 }
    },
    keywords: [{
      name: "访问页面",
      category: "builtin",
      parameters: []
    }]
  }));
}
`);

  activeConfig = {
    projectRoot,
    pythonPath: `${process.execPath} ${fakeCli}`,
    keywordsJsonPath: "",
    cacheTimeout: 300,
  };

  const provider = new KeywordProvider({});
  const keywords = await provider.executeKeywordCommand();

  assert.deepEqual(keywords, [{
    name: "访问页面",
    category: "builtin",
    parameters: [],
  }]);
});
