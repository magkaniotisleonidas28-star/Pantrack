import assert from 'node:assert/strict';
import ts from 'typescript';

function parse(source, filename) {
  const tree = /\.jsonc?$/i.test(filename)
    ? ts.parseJsonText(filename, source)
    : ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  assert.equal(tree.parseDiagnostics.length, 0, `Cannot verify invalid syntax: ${filename}`);
  return tree;
}

function syntaxSignature(tree, runtime = false) {
  function visit(node) {
    if (ts.isParenthesizedExpression(node)) return visit(node.expression);
    if (ts.isParenthesizedTypeNode(node)) return visit(node.type);
    if (ts.isEmptyStatement(node) || node.kind === ts.SyntaxKind.SemicolonClassElement) return null;

    // JSX layout can become explicit whitespace expressions. The emitted-runtime
    // comparison below verifies the resulting children and their exact text.
    if (
      !runtime &&
      (ts.isJsxText(node) ||
        (ts.isJsxExpression(node) &&
          node.expression &&
          ts.isStringLiteral(node.expression) &&
          !node.expression.text.trim()))
    ) {
      return null;
    }

    const children = [];
    ts.forEachChild(node, (child) => {
      const signature = visit(child);
      if (signature !== null) children.push(signature);
    });
    const signature = { kind: ts.SyntaxKind[node.kind], children };
    if (ts.isSourceFile(node)) signature.shebang = node.text.match(/^#![^\r\n]*/)?.[0] ?? null;
    if (!ts.isSourceFile(node) && typeof node.text === 'string') signature.text = node.text;
    if (ts.isVariableDeclarationList(node)) {
      signature.declaration =
        node.flags &
        (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing);
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node) ||
      ts.isCallExpression(node)
    ) {
      signature.optionalChain = Boolean(node.flags & ts.NodeFlags.OptionalChain);
    }
    for (const property of ['isTypeOnly', 'isExportEquals']) {
      if (property in node) signature[property] = node[property];
    }
    // Tagged templates observe raw text, so cooked string equality is insufficient.
    if (ts.isTemplateLiteralToken(node)) signature.raw = node.getText(tree);
    return signature;
  }
  return visit(tree);
}

function commentSignature(tree) {
  const comments = new Map();
  const remember = (ranges = []) => {
    for (const range of ranges) {
      comments.set(
        range.pos,
        tree.text
          .slice(range.pos, range.end)
          .replace(/\r?\n\s*\*\s?/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
  };
  function visit(node) {
    remember(ts.getLeadingCommentRanges(tree.text, node.pos));
    remember(ts.getTrailingCommentRanges(tree.text, node.end));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...comments].sort(([left], [right]) => left - right).map(([, text]) => text);
}

function runtimeSignature(source, filename) {
  const emitted = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: true,
      removeComments: true,
    },
  });
  return syntaxSignature(parse(emitted.outputText, 'formatted-runtime.js'), true);
}

/** Refuses a formatting candidate before any write; regression tests remain required. */
export function assertFormattingEquivalent(before, after, filename) {
  const original = parse(before, filename);
  const formatted = parse(after, filename);
  assert.deepEqual(
    syntaxSignature(formatted),
    syntaxSignature(original),
    `Formatting changed syntax, types or literal values: ${filename}`,
  );
  assert.deepEqual(
    commentSignature(formatted),
    commentSignature(original),
    `Formatting changed comments or compiler/linter annotations: ${filename}`,
  );
  if (!/\.jsonc?$|\.d\.[cm]?ts$/i.test(filename)) {
    assert.deepEqual(
      runtimeSignature(after, filename),
      runtimeSignature(before, filename),
      `Formatting changed emitted JavaScript or JSX children: ${filename}`,
    );
  }
}
