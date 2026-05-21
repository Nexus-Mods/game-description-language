import { parseDocument, type Document, type Node as YamlNode, isMap, isSeq, isScalar, isPair } from 'yaml';
import type {
  DocumentNode, GameNode, StoresNode, StoreId, ContextNode, ValueNode, ModTypeNode,
  InstallerNode, InstallerScope, SingleInstallerForm, RouteEntry, TakeStrategy,
  PatternNode, PredicateNode, ComparisonExpr, ValueRef, DiscoveryNode, HookRefNode,
  TestsNode, TestCaseNode, ExpectNode, CorpusMode, NexusNode,
  ToolbarActionNode, ToolbarActionTarget, SetupNode, EventsNode,
} from './ast.js';
import type { YamlSpan } from '../errors.js';
import { BuildErrors, type BuildError } from '../errors.js';
import {
  BRANCH_TAG_NAMES, type BranchTagName,
  PATTERN_TAG_NAMES, type PatternTagName,
  PREDICATE_TAG_NAMES, type PredicateTagName,
  HOOK_TAG,
  customTags,
} from './tags.js';

const spanOf = (file: string, source: string, node: YamlNode | null | undefined): YamlSpan => {
  const range = (node as { range?: [number, number, number] } | null)?.range;
  if (!range) return { file, line: 1, column: 1, offset: 0, length: 0 };
  const [start, , end] = range;
  const before = source.slice(0, start);
  const line = before.split('\n').length;
  const lastNl = before.lastIndexOf('\n');
  const column = start - (lastNl + 1) + 1;
  return { file, line, column, offset: start, length: end - start };
};

const STORE_IDS = new Set<StoreId>([
  'steam', 'epic', 'gog', 'xbox', 'ea', 'microsoftStore', 'manual',
]);

const isInterpolated = (s: string): boolean => s.includes('${');

const tagToKind = (tag: BranchTagName): 'storeBranch' | 'osBranch' | 'versionBranch' =>
  tag === '!storeBranch' ? 'storeBranch'
  : tag === '!osBranch' ? 'osBranch'
  : 'versionBranch';

const keyToKind = (key: string): 'storeBranch' | 'osBranch' | 'versionBranch' =>
  key === 'storeBranch' ? 'storeBranch'
  : key === 'osBranch' ? 'osBranch'
  : 'versionBranch';

const parseHookRef = (node: YamlNode | null | undefined, file: string, source: string): HookRefNode => {
  if (isScalar(node) && (node as { tag?: unknown }).tag === HOOK_TAG && typeof node.value === 'string') {
    return { kind: 'hookRef', hookId: node.value, span: spanOf(file, source, node) };
  }
  throw new BuildErrors([{
    code: 'GDL060',
    message: 'expected `!hook <id>` reference',
    span: spanOf(file, source, node ?? null),
  }]);
};

const parseBranchArms = (
  inner: { items: unknown[] },
  label: string,
  span: YamlSpan,
  file: string,
  source: string,
): { arms: Record<string, ValueNode>; default: ValueNode } => {
  const arms: Record<string, ValueNode> = {};
  let defaultArm: ValueNode | undefined;
  for (const pair of inner.items) {
    if (!isPair(pair)) continue;
    const armKey = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const armValue = parseValueNode(pair.value as YamlNode, file, source);
    if (armKey === 'default') defaultArm = armValue;
    else arms[armKey] = armValue;
  }
  if (!defaultArm) {
    throw new BuildErrors([{
      code: 'GDL022',
      message: `\`${label}\` requires a \`default:\` arm`,
      span,
    }]);
  }
  return { arms, default: defaultArm };
};

const parseValueNode = (node: YamlNode | null | undefined, file: string, source: string): ValueNode => {
  const span = spanOf(file, source, node ?? null);

  // Hook reference: scalar with !hook tag.
  if (isScalar(node) && (node as { tag?: unknown }).tag === HOOK_TAG && typeof node.value === 'string') {
    return { kind: 'hookRef', hookId: node.value, span };
  }

  // Branch tag: tagged YAMLMap with one of the known branch tag names.
  if (isMap(node) && typeof node.tag === 'string' && BRANCH_TAG_NAMES.has(node.tag as BranchTagName)) {
    const tag = node.tag as BranchTagName;
    const { arms, default: defaultArm } = parseBranchArms(node, tag, span, file, source);
    return { kind: tagToKind(tag), arms, default: defaultArm, span };
  }

  // Object form for branches: { storeBranch | osBranch | versionBranch: { arm: value, ... } }
  if (isMap(node) && (typeof node.tag !== 'string' || node.tag === '')) {
    const keys: string[] = [];
    for (const item of node.items) {
      if (isScalar(item.key) && typeof item.key.value === 'string') {
        keys.push(item.key.value);
      }
    }
    const BRANCH_KEYS = ['storeBranch', 'osBranch', 'versionBranch'];
    const matched = keys.filter(k => BRANCH_KEYS.includes(k));
    if (matched.length === 1 && keys.length === 1) {
      const key = matched[0]!;
      const inner = node.get(key, true);
      if (!isMap(inner)) {
        throw new BuildErrors([{
          code: 'GDL171',
          message: `${key} must be a mapping of arm names to values`,
          span,
        }]);
      }
      const { arms, default: defaultArm } = parseBranchArms(inner, key, span, file, source);
      return { kind: keyToKind(key), arms, default: defaultArm, span };
    }
  }

  if (isScalar(node)) {
    const raw = node.value;
    if (typeof raw === 'string' && isInterpolated(raw)) {
      return { kind: 'interpolated', template: raw, span: spanOf(file, source, node) };
    }
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      return { kind: 'literal', raw, span: spanOf(file, source, node) };
    }
  }

  throw new BuildErrors([{
    code: 'GDL020',
    message: 'unsupported value (expected scalar literal, interpolated string, or branch tag)',
    span,
  }]);
};

const parsePattern = (node: YamlNode | null | undefined, file: string, source: string): PatternNode => {
  const span = spanOf(file, source, node ?? null);
  if (isScalar(node) && typeof node.value === 'string') {
    const tag = typeof node.tag === 'string' ? node.tag : '!hasFile';
    if (tag === '!matches') return { kind: 'regex', pattern: node.value, span };
    return { kind: 'glob', pattern: node.value, span };
  }
  throw new BuildErrors([{
    code: 'GDL040',
    message: 'expected a pattern string',
    span,
  }]);
};

const parseTakeStrategy = (node: YamlNode | null | undefined, file: string, source: string): TakeStrategy => {
  if (isScalar(node)) {
    const v = node.value;
    if (v === 'self' || v === 'parent' || v === 'parent.parent' || v === 'archive-root') return v;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return { depth: v };
  }
  throw new BuildErrors([{
    code: 'GDL041',
    message: '`take:` must be one of `self`, `parent`, `parent.parent`, `archive-root`, or a non-negative integer depth',
    span: spanOf(file, source, node ?? null),
  }]);
};

const parseValueRef = (node: YamlNode, file: string, source: string): ValueRef => {
  if (!isScalar(node)) {
    throw new BuildErrors([{
      code: 'GDL046',
      message: 'expected a scalar reference or literal',
      span: spanOf(file, source, node),
    }]);
  }
  const v = node.value;
  if (typeof v === 'string') {
    const m = /^\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/.exec(v);
    if (m) return { kind: 'ref', name: m[1]! };
    return { kind: 'literal', raw: v };
  }
  if (typeof v === 'number' || typeof v === 'boolean') return { kind: 'literal', raw: v };
  throw new BuildErrors([{
    code: 'GDL046',
    message: 'expected a scalar reference or literal',
    span: spanOf(file, source, node),
  }]);
};

const parseComparison = (node: YamlNode, file: string, source: string): ComparisonExpr => {
  if (!isMap(node)) {
    throw new BuildErrors([{
      code: 'GDL043',
      message: '`!when` requires a mapping with `op`, `left`, `right`',
      span: spanOf(file, source, node),
    }]);
  }
  const op = String(node.get('op') ?? '');
  if (!['==', '!=', '>=', '<=', '>', '<', 'in'].includes(op)) {
    throw new BuildErrors([{
      code: 'GDL044',
      message: `unknown comparison operator \`${op}\``,
      span: spanOf(file, source, node),
      hint: 'one of: ==, !=, >=, <=, >, <, in',
    }]);
  }
  const leftRaw = node.get('left', true) as YamlNode;
  const rightRaw = node.get('right', true) as YamlNode;
  const left = parseValueRef(leftRaw, file, source);
  if (op === 'in') {
    if (!isSeq(rightRaw)) {
      throw new BuildErrors([{
        code: 'GDL045',
        message: '`in` operator requires `right` to be a sequence',
        span: spanOf(file, source, rightRaw),
      }]);
    }
    const right = rightRaw.items.map(i => parseValueRef(i as YamlNode, file, source));
    return { op: 'in', left, right };
  }
  const right = parseValueRef(rightRaw, file, source);
  return { op: op as ComparisonExpr['op'], left, right } as ComparisonExpr;
};

const parsePredicate = (node: YamlNode | null | undefined, file: string, source: string): PredicateNode => {
  const span = spanOf(file, source, node ?? null);
  const tag = (node as { tag?: unknown } | null)?.tag;

  if (typeof tag === 'string') {
    if (tag === '!hasFile') {
      return { kind: 'hasFile', pattern: parsePattern(node, file, source), span };
    }
    if (tag === '!hasFiles' && isSeq(node)) {
      const patterns = node.items.map(i => parsePattern(i as YamlNode, file, source));
      return { kind: 'hasFiles', patterns, span };
    }
    if (tag === '!matches') {
      return { kind: 'matches', pattern: parsePattern(node, file, source), span };
    }
    if (tag === '!any' && isSeq(node)) {
      return { kind: 'any', arms: node.items.map(i => parsePredicate(i as YamlNode, file, source)), span };
    }
    if (tag === '!all' && isSeq(node)) {
      return { kind: 'all', arms: node.items.map(i => parsePredicate(i as YamlNode, file, source)), span };
    }
    if (tag === '!not' && isSeq(node) && node.items.length === 1) {
      return { kind: 'not', arm: parsePredicate(node.items[0] as YamlNode, file, source), span };
    }
    if (tag === '!when' && isMap(node)) {
      return { kind: 'when', expr: parseComparison(node, file, source), span };
    }
  }

  // Object form: single-key discriminator object.
  if (isMap(node) && (typeof tag !== 'string' || tag === '')) {
    const keys: string[] = [];
    for (const item of node.items) {
      if (isScalar(item.key) && typeof item.key.value === 'string') {
        keys.push(item.key.value);
      }
    }

    const PRED_KEYS = ['hasFile', 'hasFiles', 'matches', 'any', 'all', 'not'];
    const matched = keys.filter(k => PRED_KEYS.includes(k));
    if (matched.length > 1) {
      throw new BuildErrors([{
        code: 'GDL170',
        message: `predicate object must have exactly one discriminator key; got [${matched.join(', ')}]`,
        span,
      }]);
    }
    if (matched.length === 1) {
      const key = matched[0]!;
      const value = node.get(key, true);
      if (key === 'hasFile') {
        return { kind: 'hasFile', pattern: parsePattern(value as YamlNode, file, source), span };
      }
      if (key === 'hasFiles' && isSeq(value)) {
        const patterns = value.items.map(i => parsePattern(i as YamlNode, file, source));
        return { kind: 'hasFiles', patterns, span };
      }
      if (key === 'matches') {
        return { kind: 'matches', pattern: parsePattern(value as YamlNode, file, source), span };
      }
      if (key === 'any' && isSeq(value)) {
        const arms = value.items.map(i => parsePredicate(i as YamlNode, file, source));
        return { kind: 'any', arms, span };
      }
      if (key === 'all' && isSeq(value)) {
        const arms = value.items.map(i => parsePredicate(i as YamlNode, file, source));
        return { kind: 'all', arms, span };
      }
      if (key === 'not') {
        return { kind: 'not', arm: parsePredicate(value as YamlNode, file, source), span };
      }
    }
  }

  throw new BuildErrors([{
    code: 'GDL042',
    message: 'expected a predicate (`!hasFile`/`!hasFiles`/`!matches`/`!when`/`!any`/`!all`/`!not`)',
    span,
  }]);
};

const parseTestsBlock = (node: YamlNode, file: string, source: string): TestsNode => {
  if (!isMap(node)) {
    throw new BuildErrors([{
      code: 'GDL080',
      message: '`tests:` must be a mapping',
      span: spanOf(file, source, node),
    }]);
  }

  const corpusRaw = node.get('corpus');
  const corpus: CorpusMode = corpusRaw === 'nexus' ? 'nexus' : 'off';

  const casesYaml = node.get('cases', true);
  const cases: TestCaseNode[] = [];
  if (isSeq(casesYaml)) {
    for (const entry of casesYaml.items) {
      if (!isMap(entry)) {
        throw new BuildErrors([{
          code: 'GDL081',
          message: '`tests.cases[]` entries must be mappings',
          span: spanOf(file, source, entry as YamlNode),
        }]);
      }
      const archiveYaml = entry.get('archive', true);
      const archive: string[] = isSeq(archiveYaml)
        ? archiveYaml.items.map(i => (isScalar(i) ? String(i.value) : String(i)))
        : [];

      let expectNode: ExpectNode | undefined;
      const expectYaml = entry.get('expect', true);
      if (isMap(expectYaml)) {
        const planYaml = expectYaml.get('plan', true);
        const plan: string[] | undefined = isSeq(planYaml)
          ? planYaml.items.map(i => (isScalar(i) ? String(i.value) : String(i)))
          : undefined;
        const matched = expectYaml.has('matched') ? String(expectYaml.get('matched')) : undefined;
        const modType = expectYaml.has('modType') ? String(expectYaml.get('modType')) : undefined;
        expectNode = {
          kind: 'expect',
          ...(matched !== undefined && { matched }),
          ...(modType !== undefined && { modType }),
          ...(plan    !== undefined && { plan }),
          span: spanOf(file, source, expectYaml as YamlNode),
        };
      }

      cases.push({
        kind: 'testCase',
        name: String(entry.get('name') ?? ''),
        archive,
        ...(expectNode !== undefined && { expect: expectNode }),
        span: spanOf(file, source, entry),
      });
    }
  }

  return {
    kind: 'tests',
    corpus,
    cases,
    span: spanOf(file, source, node),
  };
};

const parseToolbarActionTarget = (node: YamlNode, file: string, source: string): ToolbarActionTarget => {
  const span = spanOf(file, source, node);
  if (isScalar(node) && typeof node.value === 'string') {
    const tag = typeof node.tag === 'string' ? node.tag : '';
    if (tag === '!openFile') return { kind: 'openFile', template: node.value };
    if (tag === '!openUrl')  return { kind: 'openUrl',  template: node.value };
  }
  throw new BuildErrors([{
    code: 'GDL140',
    message: 'toolbar action `target:` must be `!openFile <path>` or `!openUrl <url>`',
    span,
  }]);
};

export const parseYaml = (source: string, file: string): DocumentNode => {
  const doc: Document = parseDocument(source, { customTags, keepSourceTokens: true });
  const errors: BuildError[] = doc.errors.map((e) => {
    const linePos = e.linePos?.[0];
    const span: YamlSpan = linePos
      ? { file, line: linePos.line, column: linePos.col, offset: e.pos[0], length: e.pos[1] - e.pos[0] }
      : { file, line: 1, column: 1, offset: 0, length: 0 };
    return {
      code: 'GDL001',
      message: e.message,
      span,
    };
  });
  if (errors.length) throw new BuildErrors(errors);

  const root = doc.contents;
  if (!isMap(root)) {
    throw new BuildErrors([{
      code: 'GDL002',
      message: 'document root must be a mapping',
      span: spanOf(file, source, root),
    }]);
  }

  const gdl = root.get('gdl');
  if (typeof gdl !== 'number') {
    throw new BuildErrors([{
      code: 'GDL003',
      message: 'missing or non-numeric `gdl:` schema version',
      span: spanOf(file, source, root),
    }]);
  }

  const gameNode = root.get('game', true);
  if (!isMap(gameNode)) {
    throw new BuildErrors([{
      code: 'GDL004',
      message: '`game:` is required and must be a mapping',
      span: spanOf(file, source, root),
    }]);
  }

  // Use the key node's range so the span points to the `game:` line (line 2, col 1),
  // not the first child of the mapping (which starts on the following line).
  const gamePair = root.items.find(p => isPair(p) && isScalar(p.key) && p.key.value === 'game');
  const gameSpanNode = (gamePair && isPair(gamePair) ? gamePair.key : gameNode) as YamlNode | null | undefined;

  const requiredFilesYaml = gameNode.get('requiredFiles', true);
  const requiredFiles: string[] = isSeq(requiredFilesYaml)
    ? requiredFilesYaml.items.map(i => (isScalar(i) ? String(i.value) : String(i)))
    : [];

  const game: GameNode = {
    kind: 'game',
    id: String(gameNode.get('id') ?? ''),
    name: String(gameNode.get('name') ?? ''),
    executable: String(gameNode.get('executable') ?? ''),
    requiredFiles,
    ...(gameNode.has('logo')          && { logo:          String(gameNode.get('logo')) }),
    ...(gameNode.has('contributedBy') && { contributedBy: String(gameNode.get('contributedBy')) }),
    span: spanOf(file, source, gameSpanNode),
  };

  const storesYaml = root.get('stores', true);
  let stores: StoresNode | undefined;
  if (isMap(storesYaml)) {
    const entries: StoresNode['entries'] = [];
    for (const pair of storesYaml.items) {
      if (!isPair(pair)) continue;
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (!STORE_IDS.has(key as StoreId)) {
        throw new BuildErrors([{
          code: 'GDL010',
          message: `unknown store \`${key}\``,
          span: spanOf(file, source, pair.key as YamlNode),
          hint: `expected one of: ${[...STORE_IDS].join(', ')}`,
        }]);
      }
      const valueNode = pair.value;
      const value = isScalar(valueNode) ? valueNode.value : null;
      if (typeof value !== 'string' && typeof value !== 'number') {
        throw new BuildErrors([{
          code: 'GDL011',
          message: `store \`${key}\` value must be string or number`,
          span: spanOf(file, source, valueNode as YamlNode),
        }]);
      }
      entries.push({
        id: key as StoreId,
        value,
        span: spanOf(file, source, pair.key as YamlNode),
      });
    }
    stores = { kind: 'stores', entries, span: spanOf(file, source, storesYaml) };
  }

  const contextYaml = root.get('context', true);
  let context: ContextNode | undefined;
  if (isMap(contextYaml)) {
    const bindings: ContextNode['bindings'] = [];
    for (const pair of contextYaml.items) {
      if (!isPair(pair)) continue;
      const name = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const value = parseValueNode(pair.value as YamlNode, file, source);
      bindings.push({ name, value, span: spanOf(file, source, pair.key as YamlNode) });
    }
    context = { kind: 'context', bindings, span: spanOf(file, source, contextYaml) };
  }

  const modTypesYaml = root.get('modTypes', true);
  let modTypes: ModTypeNode[] | undefined;
  if (isSeq(modTypesYaml)) {
    modTypes = [];
    for (const entry of modTypesYaml.items) {
      if (!isMap(entry)) {
        throw new BuildErrors([{
          code: 'GDL030',
          message: 'modTypes entries must be mappings',
          span: spanOf(file, source, entry as YamlNode),
        }]);
      }
      modTypes.push({
        kind: 'modType',
        id: String(entry.get('id') ?? ''),
        name: String(entry.get('name') ?? ''),
        path: parseValueNode(entry.get('path', true) as YamlNode, file, source),
        span: spanOf(file, source, entry),
      });
    }
  }

  const installersYaml = root.get('installers', true);
  let installers: InstallerNode[] | undefined;
  if (isSeq(installersYaml)) {
    installers = [];
    for (const entry of installersYaml.items) {
      if (!isMap(entry)) {
        throw new BuildErrors([{
          code: 'GDL050',
          message: 'installer entries must be mappings',
          span: spanOf(file, source, entry as YamlNode),
        }]);
      }
      const id = String(entry.get('id') ?? '');
      const priority = Number(entry.get('priority') ?? 50);
      const when = parsePredicate(entry.get('when', true) as YamlNode, file, source);
      const unlessYaml = entry.get('unless', true);
      const unless = unlessYaml ? parsePredicate(unlessYaml as YamlNode, file, source) : undefined;

      const scopeYaml = entry.get('scope', true);
      let scope: InstallerScope | undefined;
      if (isMap(scopeYaml)) {
        const storesYaml = scopeYaml.get('stores', true);
        const stores: string[] = [];
        if (isSeq(storesYaml)) {
          for (const item of storesYaml.items) {
            if (isScalar(item) && typeof item.value === 'string') {
              stores.push(item.value);
            } else {
              throw new BuildErrors([{
                code: 'GDL160',
                message: 'installer.scope.stores entries must be strings',
                span: spanOf(file, source, item as YamlNode),
              }]);
            }
          }
        }
        scope = { ...(stores.length > 0 && { stores }) };
      }

      const routeYaml = entry.get('route', true);
      let single: SingleInstallerForm | undefined;
      let route: RouteEntry[] | undefined;
      let modType: string | undefined;
      if (isSeq(routeYaml)) {
        route = routeYaml.items.map(rEntry => {
          if (!isMap(rEntry)) {
            throw new BuildErrors([{
              code: 'GDL051',
              message: 'route entries must be mappings',
              span: spanOf(file, source, rEntry as YamlNode),
            }]);
          }
          return {
            match:   parsePattern(rEntry.get('match', true)  as YamlNode, file, source),
            anchor:  parsePattern(rEntry.get('anchor', true) as YamlNode, file, source),
            take:    parseTakeStrategy(rEntry.get('take', true) as YamlNode, file, source),
            placeAt: parseValueNode(rEntry.get('placeAt', true) as YamlNode, file, source),
            modType: String(rEntry.get('modType') ?? ''),
            span:    spanOf(file, source, rEntry),
          };
        });
      } else {
        single = {
          anchor:  parsePattern(entry.get('anchor', true) as YamlNode, file, source),
          take:    parseTakeStrategy(entry.get('take', true) as YamlNode, file, source),
          placeAt: parseValueNode(entry.get('placeAt', true) as YamlNode, file, source),
        };
        modType = String(entry.get('modType') ?? '');
      }

      installers.push({
        kind: 'installer',
        id,
        priority,
        when,
        ...(unless !== undefined && { unless }),
        ...(scope  !== undefined && { scope }),
        ...(single !== undefined && { single }),
        ...(route  !== undefined && { route }),
        ...(modType !== undefined && { modType }),
        span: spanOf(file, source, entry),
      });
    }
  }

  const discoveryYaml = root.get('discovery', true);
  let discovery: DiscoveryNode | undefined;
  if (isMap(discoveryYaml)) {
    const versionYaml = discoveryYaml.get('version', true);
    if (versionYaml) {
      const version = parseHookRef(versionYaml as YamlNode, file, source);
      discovery = { kind: 'discovery', version, span: spanOf(file, source, discoveryYaml) };
    } else {
      discovery = { kind: 'discovery', span: spanOf(file, source, discoveryYaml) };
    }
  }

  const testsYaml = root.get('tests', true);
  let tests: TestsNode | undefined;
  if (testsYaml) {
    tests = parseTestsBlock(testsYaml as YamlNode, file, source);
  }

  const nexusYaml = root.get('nexus', true);
  let nexus: NexusNode | undefined;
  if (isMap(nexusYaml)) {
    nexus = {
      kind: 'nexus',
      modId:       Number(nexusYaml.get('modId') ?? 0),
      fileGroupId: Number(nexusYaml.get('fileGroupId') ?? 0),
      displayName: String(nexusYaml.get('displayName') ?? ''),
      span: spanOf(file, source, nexusYaml as YamlNode),
    };
  }

  const toolbarYaml = root.get('toolbarActions', true);
  let toolbarActions: ToolbarActionNode[] | undefined;
  if (isSeq(toolbarYaml)) {
    toolbarActions = [];
    for (const entry of toolbarYaml.items) {
      if (!isMap(entry)) {
        throw new BuildErrors([{
          code: 'GDL141',
          message: 'toolbarActions entries must be mappings',
          span: spanOf(file, source, entry as YamlNode),
        }]);
      }
      toolbarActions.push({
        kind: 'toolbarAction',
        id:       String(entry.get('id') ?? ''),
        title:    String(entry.get('title') ?? ''),
        priority: Number(entry.get('priority') ?? 100),
        target:   parseToolbarActionTarget(entry.get('target', true) as YamlNode, file, source),
        span:     spanOf(file, source, entry),
      });
    }
  }

  const setupYaml = root.get('setup', true);
  let setup: SetupNode | undefined;
  if (isMap(setupYaml)) {
    const ensureDirsYaml = setupYaml.get('ensureDirs', true);
    const dirs: string[] = [];
    if (isSeq(ensureDirsYaml)) {
      for (const item of ensureDirsYaml.items) {
        if (isScalar(item) && typeof item.value === 'string') {
          dirs.push(item.value);
        } else {
          throw new BuildErrors([{
            code: 'GDL150',
            message: 'setup.ensureDirs entries must be strings',
            span: spanOf(file, source, item as YamlNode),
          }]);
        }
      }
    }
    setup = {
      kind: 'setup',
      ensureDirs: dirs,
      span: spanOf(file, source, setupYaml),
    };
  }

  const eventsYaml = root.get('events', true);
  let events: EventsNode | undefined;
  if (isMap(eventsYaml)) {
    const didDeployYaml = eventsYaml.get('did-deploy', true);
    let didDeploy: HookRefNode | undefined;
    if (didDeployYaml !== undefined && didDeployYaml !== null) {
      if (isScalar(didDeployYaml) && typeof didDeployYaml.tag === 'string' && didDeployYaml.tag === '!hook' && typeof didDeployYaml.value === 'string') {
        didDeploy = {
          kind: 'hookRef',
          hookId: didDeployYaml.value,
          span: spanOf(file, source, didDeployYaml),
        };
      } else {
        throw new BuildErrors([{
          code: 'GDL151',
          message: 'events.did-deploy must be a `!hook <name>` reference',
          span: spanOf(file, source, didDeployYaml as YamlNode),
        }]);
      }
    }
    events = {
      kind: 'events',
      ...(didDeploy !== undefined && { didDeploy }),
      span: spanOf(file, source, eventsYaml),
    };
  }

  return {
    kind: 'document',
    gdl,
    game,
    ...(stores          !== undefined && { stores }),
    ...(context         !== undefined && { context }),
    ...(modTypes        !== undefined && { modTypes }),
    ...(installers      !== undefined && { installers }),
    ...(discovery       !== undefined && { discovery }),
    ...(tests           !== undefined && { tests }),
    ...(nexus           !== undefined && { nexus }),
    ...(toolbarActions  !== undefined && { toolbarActions }),
    ...(setup           !== undefined && { setup }),
    ...(events          !== undefined && { events }),
    span: spanOf(file, source, root),
  };
};
