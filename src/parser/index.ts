import { parseDocument, type Document, type Node as YamlNode, isMap, isSeq, isScalar, isPair } from 'yaml';
import type {
  DocumentNode, GameNode, StoresNode, StoreId, ContextNode, ValueNode, ModTypeNode,
  InstallerNode, InstallerScope, SingleInstallerForm, RouteEntry, CopyInstallerForm, TakeStrategy,
  PatternNode, PredicateNode, ComparisonExpr, ValueRef, DiscoveryNode, HookRefNode,
  FileVersionNode, VersionSourceNode, RegistryProbeNode, RegistryHive,
  TestsNode, TestCaseNode, ExpectNode, CorpusMode,
  ValidatorNode, ValidatorAssertNode, PlacementAssertNode,
  NexusNode, ToolbarActionNode, ToolbarActionTarget, SetupNode, EventsNode, DiagnosticNode,
  RequireFilesNode, RequireFilesLink, RequireFilesTarget,
} from './ast.js';
import type { YamlSpan } from '../errors.js';
import { BuildErrors, type BuildError } from '../errors.js';
import { customTags } from './tags.js';

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

const keyToKind = (key: string): 'storeBranch' | 'osBranch' | 'versionBranch' =>
  key === 'storeBranch' ? 'storeBranch'
  : key === 'osBranch' ? 'osBranch'
  : 'versionBranch';

const parseHookRef = (node: YamlNode | null | undefined, file: string, source: string): HookRefNode => {
  // Object form: { hook: <name> }
  if (isMap(node) && node.items.length === 1) {
    const pair = node.items[0]!;
    if (isScalar(pair.key) && pair.key.value === 'hook'
        && isScalar(pair.value) && typeof pair.value.value === 'string') {
      return { kind: 'hookRef', hookId: pair.value.value, span: spanOf(file, source, node) };
    }
  }
  throw new BuildErrors([{
    code: 'GDL060',
    message: 'expected a hook reference object: { hook: <id> }',
    span: spanOf(file, source, node ?? null),
  }]);
};

const parseVersionSource = (node: YamlNode | null | undefined, file: string, source: string): VersionSourceNode => {
  if (!isMap(node)) {
    throw new BuildErrors([{
      code: 'GDL061',
      message: 'discovery.version must be { hook: <id> } or { file: <path>, regex: <pattern> }',
      span: spanOf(file, source, node ?? null),
    }]);
  }

  const keys = new Set<string>();
  for (const item of node.items) {
    if (isScalar(item.key) && typeof item.key.value === 'string') {
      keys.add(item.key.value);
    }
  }

  // Reject ambiguous form with both hook and file
  if (keys.has('hook') && keys.has('file')) {
    throw new BuildErrors([{
      code: 'GDL061',
      message: 'discovery.version must be { hook: <id> } or { file: <path>, regex: <pattern> }, not both',
      span: spanOf(file, source, node),
    }]);
  }

  // Hook form: { hook: <name> }
  if (keys.has('hook')) return parseHookRef(node, file, source);

  // File+regex form: { file: <path>, regex: <pattern> }
  if (keys.has('file')) {
    const span = spanOf(file, source, node);
    const fileVal = node.get('file');
    const regexVal = node.get('regex');
    if (typeof fileVal !== 'string' || !fileVal.trim()) {
      throw new BuildErrors([{ code: 'GDL062', message: 'discovery.version.file must be a non-empty string', span }]);
    }
    if (typeof regexVal !== 'string' || !regexVal.trim()) {
      throw new BuildErrors([{ code: 'GDL063', message: 'discovery.version.regex must be a non-empty string', span }]);
    }
    try { new RegExp(regexVal); } catch {
      throw new BuildErrors([{ code: 'GDL064', message: `discovery.version.regex is not a valid regular expression: ${regexVal}`, span }]);
    }
    return { kind: 'fileVersion', file: fileVal, regex: regexVal, span } satisfies FileVersionNode;
  }

  throw new BuildErrors([{
    code: 'GDL061',
    message: 'discovery.version must be { hook: <id> } or { file: <path>, regex: <pattern> }',
    span: spanOf(file, source, node ?? null),
  }]);
};

const REGISTRY_HIVES = new Set<RegistryHive>(['HKLM', 'HKCU']);

const parseRegistryProbes = (node: YamlNode, file: string, source: string): RegistryProbeNode[] => {
  if (!isSeq(node)) {
    throw new BuildErrors([{
      code: 'GDL069',
      message: 'discovery.registry must be a list of { hive, key, value } probes',
      span: spanOf(file, source, node),
    }]);
  }
  const probes: RegistryProbeNode[] = [];
  for (const item of node.items) {
    const span = spanOf(file, source, item as YamlNode);
    if (!isMap(item)) {
      throw new BuildErrors([{
        code: 'GDL069',
        message: 'discovery.registry entry must be a { hive, key, value } object',
        span,
      }]);
    }
    const hive = item.get('hive');
    const key = item.get('key');
    const value = item.get('value');
    if (typeof hive !== 'string' || !REGISTRY_HIVES.has(hive as RegistryHive)) {
      throw new BuildErrors([{
        code: 'GDL070',
        message: `discovery.registry hive \`${String(hive)}\` must be one of: ${[...REGISTRY_HIVES].join(', ')}`,
        span,
      }]);
    }
    probes.push({
      kind: 'registryProbe',
      hive: hive as RegistryHive,
      key: typeof key === 'string' ? key : '',
      value: typeof value === 'string' ? value : '',
      span,
    });
  }
  return probes;
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
    message: 'unsupported value (expected scalar literal, interpolated string, or branch object)',
    span,
  }]);
};

const parsePattern = (node: YamlNode | null | undefined, file: string, source: string): PatternNode => {
  const span = spanOf(file, source, node ?? null);
  if (isScalar(node) && typeof node.value === 'string') {
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

  // Object form: single-key discriminator object.
  if (isMap(node)) {
    const keys: string[] = [];
    for (const item of node.items) {
      if (isScalar(item.key) && typeof item.key.value === 'string') {
        keys.push(item.key.value);
      }
    }

    const PRED_KEYS = ['hasFile', 'hasFiles', 'matches', 'extensions', 'any', 'all', 'not'];
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
      if (key === 'extensions' && isMap(value)) {
        const listYaml = value.get('list', true);
        const list: string[] = [];
        if (isSeq(listYaml)) {
          for (const item of listYaml.items) {
            if (isScalar(item) && typeof item.value === 'string') list.push(item.value);
          }
        }
        const modeYaml = value.get('mode', true);
        const mode = (isScalar(modeYaml) && modeYaml.value === 'all') ? 'all' : 'any';
        return { kind: 'extensions', list, mode, span };
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
    message: 'expected a predicate object with one of: hasFile, hasFiles, matches, extensions, any, all, not',
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

  // Optional per-store lifecycle fixtures: each entry overrides the synthetic
  // installPath for that store in the generated lifecycle.gen.ts test. Used
  // when the realistic discovery shape differs from the default
  // `/games/<game.id>` — e.g. Xbox returns the Content/ parent folder.
  let scenarios: Record<string, { installPath?: string }> | undefined;
  const scenariosYaml = node.get('scenarios', true);
  if (scenariosYaml !== undefined && scenariosYaml !== null) {
    if (!isMap(scenariosYaml)) {
      throw new BuildErrors([{
        code: 'GDL082',
        message: '`tests.scenarios` must be a mapping of storeId → { installPath: ... }',
        span: spanOf(file, source, scenariosYaml as YamlNode),
      }]);
    }
    scenarios = {};
    for (const pair of scenariosYaml.items) {
      if (!isPair(pair)) continue;
      const storeId = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const valueNode = pair.value as YamlNode;
      if (!isMap(valueNode)) {
        throw new BuildErrors([{
          code: 'GDL083',
          message: `\`tests.scenarios.${storeId}\` must be a mapping (e.g. \`{ installPath: /foo }\`)`,
          span: spanOf(file, source, valueNode),
        }]);
      }
      const installPath = valueNode.has('installPath')
        ? String(valueNode.get('installPath'))
        : undefined;
      if (installPath !== undefined && installPath.length === 0) {
        throw new BuildErrors([{
          code: 'GDL084',
          message: `\`tests.scenarios.${storeId}.installPath\` must be a non-empty string`,
          span: spanOf(file, source, valueNode),
        }]);
      }
      scenarios[storeId] = installPath !== undefined ? { installPath } : {};
    }
  }

  // Optional synthetic content: filename -> template string served to install
  // hooks that read file contents during corpus runs.
  let syntheticContent: Record<string, string> | undefined;
  const syntheticYaml = node.get('syntheticContent', true);
  if (syntheticYaml !== undefined && syntheticYaml !== null) {
    if (!isMap(syntheticYaml)) {
      throw new BuildErrors([{
        code: 'GDL085',
        message: '`tests.syntheticContent` must be a mapping of filename → template string',
        span: spanOf(file, source, syntheticYaml as YamlNode),
      }]);
    }
    syntheticContent = {};
    for (const pair of syntheticYaml.items) {
      if (!isPair(pair)) continue;
      const filename = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      const value = pair.value;
      if (!isScalar(value) || typeof value.value !== 'string') {
        throw new BuildErrors([{
          code: 'GDL086',
          message: `\`tests.syntheticContent.${filename}\` must be a string template`,
          span: spanOf(file, source, value as YamlNode),
        }]);
      }
      syntheticContent[filename] = value.value;
    }
  }

  return {
    kind: 'tests',
    corpus,
    cases,
    ...(scenarios !== undefined && { scenarios }),
    ...(syntheticContent !== undefined && { syntheticContent }),
    span: spanOf(file, source, node),
  };
};

const parseValidatorsBlock = (node: YamlNode, file: string, source: string): ValidatorNode[] => {
  if (!isSeq(node)) {
    throw new BuildErrors([{
      code: 'GDL160',
      message: '`validators:` must be a sequence',
      span: spanOf(file, source, node),
    }]);
  }

  const validators: ValidatorNode[] = [];
  for (const entry of node.items) {
    if (!isMap(entry)) {
      throw new BuildErrors([{
        code: 'GDL161',
        message: '`validators[]` entries must be mappings',
        span: spanOf(file, source, entry as YamlNode),
      }]);
    }

    const when = parsePredicate(entry.get('when', true) as YamlNode, file, source);

    const assertYaml = entry.get('assert', true);
    let assert: ValidatorAssertNode;
    if (isMap(assertYaml)) {
      const matched = assertYaml.has('matched') ? String(assertYaml.get('matched')) : undefined;
      const modType = assertYaml.has('modType') ? String(assertYaml.get('modType')) : undefined;
      const placementYaml = assertYaml.get('placement', true);
      let placement: PlacementAssertNode[] | undefined;
      if (placementYaml !== undefined && placementYaml !== null) {
        if (!isSeq(placementYaml)) {
          throw new BuildErrors([{
            code: 'GDL176',
            message: '`validators[].assert.placement` must be a sequence',
            span: spanOf(file, source, placementYaml as YamlNode),
          }]);
        }
        placement = placementYaml.items.map((p) => {
          if (!isMap(p)) {
            throw new BuildErrors([{
              code: 'GDL177',
              message: '`validators[].assert.placement[]` entries must be mappings',
              span: spanOf(file, source, p as YamlNode),
            }]);
          }
          return {
            files: p.has('files') ? String(p.get('files')) : '',
            ...(p.has('mustMatch') && { mustMatch: String(p.get('mustMatch')) }),
            ...(p.has('mustNotMatch') && { mustNotMatch: String(p.get('mustNotMatch')) }),
            span: spanOf(file, source, p as YamlNode),
          };
        });
      }
      assert = {
        kind: 'validatorAssert',
        ...(matched !== undefined && { matched }),
        ...(modType !== undefined && { modType }),
        ...(placement !== undefined && { placement }),
        span: spanOf(file, source, assertYaml as YamlNode),
      };
    } else {
      throw new BuildErrors([{
        code: 'GDL162',
        message: '`validators[].assert` must be a mapping',
        span: spanOf(file, source, entry),
      }]);
    }

    validators.push({
      kind: 'validator',
      id: String(entry.get('id') ?? ''),
      name: String(entry.get('name') ?? ''),
      when,
      assert,
      span: spanOf(file, source, entry),
    });
  }

  return validators;
};

function parseRequireFiles(node: YamlNode, file: string, source: string): RequireFilesNode {
  const mapNode = isMap(node) ? node : null;
  if (!mapNode) {
    throw new BuildErrors([{
      code: 'GDL153',
      message: 'setup.requireFiles must be a mapping',
      span: spanOf(file, source, node),
    }]);
  }

  const files: string[] = [];
  const filesYaml = mapNode.get('files', true);
  if (isSeq(filesYaml)) {
    for (const item of filesYaml.items) {
      if (isScalar(item) && typeof item.value === 'string') {
        files.push(item.value);
      } else {
        throw new BuildErrors([{
          code: 'GDL153',
          message: 'setup.requireFiles.files entries must be strings',
          span: spanOf(file, source, item as YamlNode),
        }]);
      }
    }
  }

  const promptYaml = mapNode.get('prompt', true);
  if (!isMap(promptYaml)) {
    throw new BuildErrors([{
      code: 'GDL154',
      message: 'setup.requireFiles.prompt must be a mapping with title and message',
      span: spanOf(file, source, mapNode),
    }]);
  }
  const title = String(promptYaml.get('title') ?? '');
  const message = String(promptYaml.get('message') ?? '');

  let link: RequireFilesLink | undefined;
  const linkYaml = promptYaml.get('link', true);
  if (isMap(linkYaml)) {
    const label = String(linkYaml.get('label') ?? '');
    const modYaml = linkYaml.get('mod', true);
    const urlYaml = linkYaml.get('url', true);
    let target: RequireFilesTarget;
    if (isMap(modYaml) && isScalar(urlYaml) && typeof urlYaml.value === 'string') {
      throw new BuildErrors([{
        code: 'GDL156',
        message: 'setup.requireFiles.prompt.link must set exactly one of `mod` or `url`, not both',
        span: spanOf(file, source, linkYaml),
      }]);
    } else if (isMap(modYaml)) {
      target = {
        kind: 'mod',
        domain: String(modYaml.get('domain') ?? ''),
        modId: Number(modYaml.get('modId') ?? 0),
      };
    } else if (isScalar(urlYaml) && typeof urlYaml.value === 'string') {
      target = { kind: 'url', url: urlYaml.value };
    } else {
      throw new BuildErrors([{
        code: 'GDL156',
        message: 'setup.requireFiles.prompt.link must set exactly one of `mod` or `url`',
        span: spanOf(file, source, linkYaml),
      }]);
    }
    link = { label, target };
  }

  return { files, prompt: { title, message, ...(link !== undefined && { link }) } };
}

const parseToolbarActionTarget = (node: YamlNode, file: string, source: string): ToolbarActionTarget => {
  const span = spanOf(file, source, node);
  if (isMap(node) && (typeof node.tag !== 'string' || node.tag === '')) {
    if (node.items.length === 1) {
      const pair = node.items[0]!;
      if (isScalar(pair.key) && typeof pair.key.value === 'string'
          && isScalar(pair.value) && typeof pair.value.value === 'string') {
        const key = pair.key.value;
        if (key === 'openFile') return { kind: 'openFile', template: pair.value.value };
        if (key === 'openUrl')  return { kind: 'openUrl',  template: pair.value.value };
      }
    }
  }
  throw new BuildErrors([{
    code: 'GDL140',
    message: 'toolbar action `target:` must be `{ openFile: <path> }` or `{ openUrl: <url> }`',
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

  // Optional top-level extension version; coerce to string (YAML may parse 1.0 as a number).
  const versionRaw = root.get('version');
  const version = versionRaw !== undefined && versionRaw !== null ? String(versionRaw) : undefined;

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

  let details: Record<string, string | number | boolean | string[]> | undefined;
  const detailsYaml = gameNode.get('details', true);
  if (isMap(detailsYaml)) {
    details = {};
    for (const pair of detailsYaml.items) {
      if (!isPair(pair)) continue;
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      if (isSeq(pair.value)) {
        details[key] = pair.value.items.map(i => (isScalar(i) ? String(i.value) : String(i)));
      } else if (isScalar(pair.value)) {
        const v = pair.value.value;
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          details[key] = v;
        }
      }
    }
  }

  const game: GameNode = {
    kind: 'game',
    id: String(gameNode.get('id') ?? ''),
    name: String(gameNode.get('name') ?? ''),
    executable: String(gameNode.get('executable') ?? ''),
    requiredFiles,
    ...(gameNode.has('logo')          && { logo:          String(gameNode.get('logo')) }),
    ...(gameNode.has('author')        && { author:        String(gameNode.get('author')) }),
    ...(gameNode.has('nexusDomain')   && { nexusDomain:   String(gameNode.get('nexusDomain')) }),
    ...(gameNode.has('queryModPath')  && { queryModPath:  String(gameNode.get('queryModPath')) }),
    ...(details !== undefined && Object.keys(details).length > 0 && { details }),
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
      const copyYaml = entry.get('copy', true);
      const installYaml = entry.get('install', true);
      let single: SingleInstallerForm | undefined;
      let route: RouteEntry[] | undefined;
      let copy: CopyInstallerForm | undefined;
      let installHook: string | undefined;
      let modType: string | undefined;
      if (isMap(installYaml)) {
        const hookYaml = installYaml.get('hook', true);
        if (isScalar(hookYaml) && typeof hookYaml.value === 'string') {
          installHook = hookYaml.value;
        } else {
          throw new BuildErrors([{
            code: 'GDL052',
            message: 'installer `install:` must be a mapping with a string `hook:` key',
            span: spanOf(file, source, installYaml as YamlNode),
          }]);
        }
        // A hook installer may still declare a modType tag.
        const mt = entry.get('modType');
        if (mt !== undefined && mt !== null) modType = String(mt);
      } else if (isSeq(routeYaml)) {
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
      } else if (isMap(copyYaml)) {
        const stripYaml = copyYaml.get('stripCommonRoot', true);
        const stripCommonRoot = isScalar(stripYaml) ? Boolean(stripYaml.value) : false;
        copy = { stripCommonRoot };
        modType = String(entry.get('modType') ?? '');
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
        ...(copy   !== undefined && { copy }),
        ...(installHook !== undefined && { installHook }),
        ...(modType !== undefined && { modType }),
        span: spanOf(file, source, entry),
      });
    }
  }

  const discoveryYaml = root.get('discovery', true);
  let discovery: DiscoveryNode | undefined;
  if (isMap(discoveryYaml)) {
    const versionYaml = discoveryYaml.get('version', true);
    const version = versionYaml
      ? parseVersionSource(versionYaml as YamlNode, file, source)
      : undefined;
    const steamNameVal = discoveryYaml.get('steamName');
    const steamName = typeof steamNameVal === 'string' ? steamNameVal : undefined;
    const registryYaml = discoveryYaml.get('registry', true);
    const registry = registryYaml
      ? parseRegistryProbes(registryYaml as YamlNode, file, source)
      : undefined;
    discovery = {
      kind: 'discovery',
      ...(version !== undefined && { version }),
      ...(steamName !== undefined && { steamName }),
      ...(registry !== undefined && { registry }),
      span: spanOf(file, source, discoveryYaml),
    };
  }

  const testsYaml = root.get('tests', true);
  let tests: TestsNode | undefined;
  if (testsYaml) {
    tests = parseTestsBlock(testsYaml as YamlNode, file, source);
  }

  const validatorsYaml = root.get('validators', true);
  let validators: ValidatorNode[] | undefined;
  if (validatorsYaml) {
    validators = parseValidatorsBlock(validatorsYaml as YamlNode, file, source);
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
    let requireFiles: RequireFilesNode | undefined;
    const rfYaml = setupYaml.get('requireFiles', true);
    if (isMap(rfYaml)) {
      requireFiles = parseRequireFiles(rfYaml, file, source);
    }
    setup = {
      kind: 'setup',
      ensureDirs: dirs,
      ...(requireFiles !== undefined && { requireFiles }),
      span: spanOf(file, source, setupYaml),
    };
  }

  const diagnosticsYaml = root.get('diagnostics', true);
  let diagnostics: DiagnosticNode[] | undefined;
  if (isSeq(diagnosticsYaml)) {
    diagnostics = [];
    for (const entry of diagnosticsYaml.items) {
      if (!isMap(entry)) {
        throw new BuildErrors([{
          code: 'GDL190',
          message: 'diagnostics entries must be mappings with a `hook:` key',
          span: spanOf(file, source, entry as YamlNode),
        }]);
      }
      const hookYaml = entry.get('hook', true);
      if (!isScalar(hookYaml) || typeof hookYaml.value !== 'string') {
        throw new BuildErrors([{
          code: 'GDL191',
          message: 'diagnostics entry `hook:` must be a string naming an exported IModHealthCheck in src/hooks.ts',
          span: spanOf(file, source, entry),
        }]);
      }
      diagnostics.push({
        kind: 'diagnostic',
        hook: hookYaml.value,
        span: spanOf(file, source, entry),
      });
    }
  }

  const eventsYaml = root.get('events', true);
  let events: EventsNode | undefined;
  if (isMap(eventsYaml)) {
    const didDeployYaml = eventsYaml.get('did-deploy', true);
    let didDeploy: HookRefNode | undefined;
    if (didDeployYaml !== undefined && didDeployYaml !== null) {
      didDeploy = parseHookRef(didDeployYaml as YamlNode, file, source);
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
    ...(version !== undefined && { version }),
    game,
    ...(stores          !== undefined && { stores }),
    ...(context         !== undefined && { context }),
    ...(modTypes        !== undefined && { modTypes }),
    ...(installers      !== undefined && { installers }),
    ...(discovery       !== undefined && { discovery }),
    ...(tests           !== undefined && { tests }),
    ...(validators      !== undefined && { validators }),
    ...(nexus           !== undefined && { nexus }),
    ...(toolbarActions  !== undefined && { toolbarActions }),
    ...(setup           !== undefined && { setup }),
    ...(events          !== undefined && { events }),
    ...(diagnostics     !== undefined && { diagnostics }),
    span: spanOf(file, source, root),
  };
};
