import ts from 'typescript';
import { compileMotion } from '../component/build.mjs';

// A product-state search needs all mutable controller state in the JSON ABI.
// Refuse module initializers with hidden state; freeze literal constants and
// helper functions so their properties cannot become an untracked state store.
export async function compileExhaustiveCandidate(source) {
  const original = await compileMotion(source);
  const ast = ts.createSourceFile('component.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const options = { noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = filename => filename === 'component.ts' ? ast : undefined;
  const checker = ts.createProgram(['component.ts'], options, host).getTypeChecker();
  const bindings = new Set();
  const literal = node => ts.isNumericLiteral(node) || ts.isStringLiteral(node)
    || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)
    || (ts.isPrefixUnaryExpression(node) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(node.operator) && literal(node.operand))
    || (ts.isArrayLiteralExpression(node) && node.elements.every(literal))
    || (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Math')
    || (ts.isObjectLiteralExpression(node) && node.properties.every(property => ts.isPropertyAssignment(property)
      && !ts.isComputedPropertyName(property.name) && literal(property.initializer)));
  for (const statement of ast.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEmptyStatement(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      bindings.add(statement.name.text);
    } else if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !literal(declaration.initializer)) {
          throw Error('Exhaustive search requires module constants to be JSON literals or frozen Math members; keep mutable state in the JSON state');
        }
        bindings.add(declaration.name.text);
      }
    } else {
      throw Error('Exhaustive search requires functions and literal constants at module scope; keep mutable state in the JSON state');
    }
  }
  const forbidden = new Set(['globalThis', 'eval', 'Function', 'WebAssembly', 'Date', 'process', 'require']);
  const builtins = new Set(['Object', 'Array', 'Number', 'String', 'Boolean', 'Math', 'JSON', 'Reflect', 'RegExp',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Error', 'TypeError', 'SyntaxError', 'RangeError',
    'URIError', 'EvalError', 'ReferenceError', 'parseInt', 'parseFloat', 'isFinite', 'isNaN', 'undefined', 'NaN', 'Infinity']);
  function inspect(node) {
    if (ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return;
    if (ts.isIdentifier(node) && forbidden.has(node.text)) throw Error(`Unavailable exhaustive candidate capability: ${node.text}`);
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const propertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node);
      const symbol = ts.isShorthandPropertyAssignment(parent)
        ? checker.getShorthandAssignmentValueSymbol(parent) : checker.getSymbolAtLocation(node);
      if (!propertyName && !symbol && !builtins.has(node.text)) {
        throw Error(`Unknown exhaustive candidate binding: ${node.text}`);
      }
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.ImportKeyword) {
      throw Error('Exhaustive candidates cannot access implicit global state');
    }
    const assigned = ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment ? node.left
      : (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator) ? node.operand : null;
    if (assigned && ts.isIdentifier(assigned) && bindings.has(assigned.text)) {
      throw Error('Exhaustive candidates cannot reassign module bindings');
    }
    ts.forEachChild(node, inspect);
  }
  inspect(ast);
  const hardened = await compileMotion(`${source}\n;(() => {
    const seen = new Set();
    function freezeBinding(value) {
      if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) return;
      seen.add(value);
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        if ('value' in descriptor) freezeBinding(descriptor.value);
      }
      Object.freeze(value);
    }
    [${[...bindings].join(',')}].forEach(freezeBinding);
  })();`);
  return { ...original, code: hardened.code };
}
