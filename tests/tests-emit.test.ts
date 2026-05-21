import { describe, it, expect } from 'vitest';
import { parseYaml } from '../src/parser/index.js';
import { emit } from '../src/codegen/emit.js';

const TINY = `
gdl: 1
game:
  id: helloworld
  name: Hello World
  executable: HelloWorld.exe
  requiredFiles: [HelloWorld.exe]
context:
  modsRoot: /games/Hello/Mods
modTypes:
  - { id: pak, name: Pak Mod, path: "/games/Hello/Mods" }
installers:
  - id: pak
    priority: 10
    when: { hasFile: "**/*.pak" }
    anchor: "**/*.pak"
    take: parent
    placeAt: "/games/Hello/Mods"
    modType: pak
tests:
  corpus: off
  cases:
    - name: typical
      archive: [a.pak, b.txt]
      expect: { matched: pak }
`;

describe('renderTestsFile', () => {
  it('emits a vitest file that imports rules and uses assertPlan', () => {
    const doc = parseYaml(TINY, 'tiny.yaml');
    const files = emit(doc);
    const testsFile = files.find(f => f.path === 'tests.gen.ts');
    expect(testsFile).toBeDefined();
    expect(testsFile!.contents).toContain("import { describe, it } from 'vitest'");
    expect(testsFile!.contents).toContain("import { buildInstallPlan");
    expect(testsFile!.contents).toContain("from '../gdl/src/runtime/index.js'");
    expect(testsFile!.contents).toContain("import { rules } from './installers.gen.js'");
    expect(testsFile!.contents).toContain("it('typical'");
    expect(testsFile!.contents).toContain("matched: 'pak'");
  });

  it('does not emit tests.gen.ts when no cases are declared', () => {
    const noTests = `
gdl: 1
game:
  id: x
  name: X
  executable: X.exe
  requiredFiles: [X.exe]
`;
    const doc = parseYaml(noTests, 'no.yaml');
    const files = emit(doc);
    expect(files.find(f => f.path === 'tests.gen.ts')).toBeUndefined();
  });
});
