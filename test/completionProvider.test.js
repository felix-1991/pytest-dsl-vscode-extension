const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

let activeConfig = {};

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }

  with(change) {
    return new Position(
      change.line === undefined ? this.line : change.line,
      change.character === undefined ? this.character : change.character,
    );
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class MarkdownString {
  constructor(value) {
    this.value = value;
  }
}

class SnippetString {
  constructor(value) {
    this.value = value;
  }
}

class TextEdit {
  constructor(range, newText) {
    this.range = range;
    this.newText = newText;
  }

  static delete(range) {
    return new TextEdit(range, "");
  }
}

const vscodeStub = {
  workspace: {
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
  CompletionItem,
  CompletionItemKind: {
    Function: 1,
    Property: 2,
    Variable: 3,
  },
  CompletionTriggerKind: {
    Invoke: 0,
    TriggerCharacter: 1,
  },
  MarkdownString,
  Position,
  Range,
  SnippetString,
  TextEdit,
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { KeywordCompletionProvider } = require("../out/completionProvider");

function completionText(item) {
  return item.insertText && typeof item.insertText === "object" && "value" in item.insertText
    ? item.insertText.value
    : item.insertText;
}

function applyCompletionInInsertMode(lineText, item) {
  const range = item.range && item.range.inserting ? item.range.inserting : item.range;
  let result = [
    lineText.slice(0, range.start.character),
    completionText(item),
    lineText.slice(range.end.character),
  ].join("");
  const mainDelta = completionText(item).length - (range.end.character - range.start.character);
  for (const edit of item.additionalTextEdits || []) {
    const start = edit.range.start.character;
    const end = edit.range.end.character;
    const adjustedStart = start >= range.end.character ? start + mainDelta : start;
    const adjustedEnd = end >= range.end.character ? end + mainDelta : end;
    result = result.slice(0, adjustedStart) + edit.newText + result.slice(adjustedEnd);
  }
  return result;
}

test("keyword completion consumes an auto-closed bracket in insert mode", async () => {
  activeConfig = { enableAutoCompletion: true };
  const provider = new KeywordCompletionProvider({
    getKeywords: async () => [
      {
        name: "打印",
        category: "builtin",
        parameters: [{ name: "内容", description: "要打印的文本内容" }],
      },
    ],
  });
  const position = new Position(0, 1);
  const document = {
    lineAt() {
      return { text: "[]" };
    },
  };

  const [item] = await provider.provideCompletionItems(
    document,
    position,
    {},
    { triggerKind: vscodeStub.CompletionTriggerKind.TriggerCharacter },
  );

  assert.deepEqual(item.range, new Range(position.with({ character: 1 }), position.with({ character: 1 })));
  assert.deepEqual(item.additionalTextEdits, [
    TextEdit.delete(new Range(position.with({ character: 1 }), position.with({ character: 2 }))),
  ]);
  assert.equal(
    applyCompletionInInsertMode("[]", item),
    "[打印], 内容: ${1:要打印的文本内容}",
  );
});

test("variable completion leaves an auto-closed brace in place", async () => {
  activeConfig = { enableAutoCompletion: true };
  const provider = new KeywordCompletionProvider(
    { getKeywords: async () => [] },
    {
      getWorkspaceVariableDefinitions: async () => [
        {
          name: "base_url",
          path: "/workspace/config/env.yaml",
          line: 1,
          column: 1,
          kind: "yaml-variable",
        },
      ],
    },
  );
  const position = new Position(0, 2);
  const document = {
    lineAt() {
      return { text: "${}" };
    },
  };

  const [item] = await provider.provideCompletionItems(
    document,
    position,
    {},
    { triggerKind: vscodeStub.CompletionTriggerKind.TriggerCharacter },
  );

  assert.equal(item.insertText, "base_url");
  assert.deepEqual(item.range, new Range(position.with({ character: 2 }), position.with({ character: 2 })));
  assert.equal(applyCompletionInInsertMode("${}", item), "${base_url}");
});
