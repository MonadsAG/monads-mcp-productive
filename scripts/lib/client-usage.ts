/**
 * Extract what `src/api/` actually asks of the Productive API, via the
 * TypeScript AST.
 *
 * Regex does not survive `client.ts`'s nested template literals -- paths are
 * built as `` `people${queryString ? `?${queryString}` : ''}` `` -- so this
 * walks the real syntax tree instead.
 */

import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { API_PREFIX, type HttpMethod } from './spec.ts';

export interface EndpointUsage {
  /** Client method the call sits in, e.g. `listPeople`. */
  member: string;
  httpMethod: HttpMethod;
  /** Normalised spec path, e.g. `/api/v2/people/{id}`. */
  path: string;
  /** `filter[x]` keys built in the same method. */
  filters: string[];
  line: number;
}

export interface TypeUsage {
  /** Interface name, e.g. `ProductivePerson`. */
  interfaceName: string;
  /** JSON:API type literal, e.g. `people`. */
  jsonApiType: string;
  /** Explicitly declared attribute names (index signatures excluded). */
  attributes: string[];
  line: number;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

const lineOf = (node: ts.Node): number =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

/**
 * Render a path expression to its spec shape.
 *
 * Interpolations that name a value (`personId`) become `{id}`; anything more
 * complex is query-string assembly, which always comes last -- so we stop there.
 */
function renderPath(node: ts.Expression, locals: Map<string, ts.Expression>): string | null {
  if (ts.isIdentifier(node)) {
    const target = locals.get(node.text);
    return target ? renderPath(target, locals) : null;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;

  let out = node.head.text;
  for (const span of node.templateSpans) {
    const isSimple =
      ts.isIdentifier(span.expression) || ts.isPropertyAccessExpression(span.expression);
    if (!isSimple) break; // query building -- everything past here is not part of the path
    out += `{id}${span.literal.text}`;
  }
  return out;
}

function toSpecPath(raw: string): string | null {
  const withoutQuery = raw.split('?')[0].replace(/^\/+|\/+$/g, '');
  if (withoutQuery === '') return null;
  return `${API_PREFIX}/${withoutQuery}`;
}

/** `{ method: 'POST' }` -> `post`; absent means GET. */
function httpMethodOf(options: ts.Expression | undefined): HttpMethod {
  if (!options || !ts.isObjectLiteralExpression(options)) return 'get';
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'method') continue;
    if (ts.isStringLiteral(property.initializer)) {
      return property.initializer.text.toLowerCase() as HttpMethod;
    }
  }
  return 'get';
}

function isMakeRequest(node: ts.CallExpression): boolean {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'makeRequest' &&
    node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
  );
}

/** `queryParams.append('filter[status]', …)` -> `status`. */
function filterKeyOf(node: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'append') {
    return null;
  }
  const [first] = node.arguments;
  if (!first || !ts.isStringLiteral(first)) return null;
  return /^filter\[([^\]]+)\]$/.exec(first.text)?.[1] ?? null;
}

function collect(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => collect(child, visit));
}

function scanMember(member: ts.MethodDeclaration): EndpointUsage[] {
  const locals = new Map<string, ts.Expression>();
  const calls: ts.CallExpression[] = [];
  const filters = new Set<string>();

  collect(member, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, node.initializer);
    }
    if (!ts.isCallExpression(node)) return;
    if (isMakeRequest(node)) calls.push(node);
    const key = filterKeyOf(node);
    if (key) filters.add(key);
  });

  const usages: EndpointUsage[] = [];
  for (const call of calls) {
    const raw = call.arguments[0] ? renderPath(call.arguments[0], locals) : null;
    const path = raw ? toSpecPath(raw) : null;
    if (!path) continue;
    usages.push({
      member: member.name.getText(),
      httpMethod: httpMethodOf(call.arguments[1]),
      path,
      filters: [...filters].sort(),
      line: lineOf(call),
    });
  }
  return usages;
}

export function extractEndpointUsage(file: string): EndpointUsage[] {
  const source = parse(file);
  const usages: EndpointUsage[] = [];
  collect(source, (node) => {
    if (ts.isMethodDeclaration(node)) usages.push(...scanMember(node));
  });
  return usages;
}

function attributesOf(member: ts.TypeElement): string[] {
  if (!ts.isPropertySignature(member) || member.name.getText() !== 'attributes') return [];
  const type = member.type;
  if (!type || !ts.isTypeLiteralNode(type)) return [];
  return type.members
    .filter(ts.isPropertySignature)
    .map((property) => property.name.getText().replace(/^['"]|['"]$/g, ''));
}

/** `type: 'people'` on the interface itself. */
function jsonApiTypeOf(declaration: ts.InterfaceDeclaration): string | null {
  for (const member of declaration.members) {
    if (!ts.isPropertySignature(member) || member.name.getText() !== 'type') continue;
    const type = member.type;
    if (type && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal))
      return type.literal.text;
  }
  return null;
}

export function extractTypeUsage(file: string): TypeUsage[] {
  const source = parse(file);
  const usages: TypeUsage[] = [];
  collect(source, (node) => {
    if (!ts.isInterfaceDeclaration(node)) return;
    const jsonApiType = jsonApiTypeOf(node);
    if (!jsonApiType) return;
    const attributes = node.members.flatMap(attributesOf);
    if (attributes.length === 0) return;
    usages.push({
      interfaceName: node.name.text,
      jsonApiType,
      attributes: [...new Set(attributes)].sort(),
      line: lineOf(node),
    });
  });
  return usages;
}
