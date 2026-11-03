import ts from 'typescript';

const forbidden = new Set(['globalThis', 'window', 'self', 'parent', 'document', 'location', 'process', 'require', 'module',
  'eval', 'Function', 'Date', 'performance', 'crypto', 'fetch', 'Worker', 'postMessage', 'setTimeout', 'setInterval',
  'constructor', 'prototype', '__proto__', 'Reflect', 'Proxy', 'WebAssembly']);

/** Additional recipient capability gate; container isolation remains mandatory. */
export function assertParallaxiaSource(source) {
  const file = ts.createSourceFile('adapter.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const visit = node => {
    if (ts.isIdentifier(node) && forbidden.has(node.text)) throw Error('PARALLAXIA adapters cannot access ' + node.text);
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isNewExpression(node)
      || node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.ImportKeyword) throw Error('PARALLAXIA adapter capability is outside the movement boundary');
    if (ts.isElementAccessExpression(node) && !(ts.isNumericLiteral(node.argumentExpression)
      || (ts.isStringLiteral(node.argumentExpression) && !forbidden.has(node.argumentExpression.text)))) throw Error('Dynamic capability lookup is not allowed');
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(file) === 'Math' && !['abs', 'ceil', 'floor', 'min', 'max', 'sign', 'round'].includes(node.name.text)) throw Error('Nondeterministic Math capability is not allowed');
    ts.forEachChild(node, visit);
  };
  visit(file);
}
