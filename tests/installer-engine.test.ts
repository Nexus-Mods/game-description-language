import { describe, it, expect } from 'vitest';
import { buildInstallPlan, type InstallerRule } from '../src/runtime/installer-engine.js';

const ctx = { archivePaths: [] as string[], vars: { modsRoot: '/games/Hello/Mods', store: 'steam', os: 'windows' } };

describe('buildInstallPlan — single form', () => {
  it('anchor: parent, take: parent → strips paths above the parent of the anchor match', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 10,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '${modsRoot}',
      },
      modType: 'pak',
    };
    const archive = ['MyMod/CoolPak.pak', 'MyMod/Readme.md'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan).toEqual([
      { source: 'MyMod/CoolPak.pak', destination: '/games/Hello/Mods/CoolPak.pak', modType: 'pak' },
      { source: 'MyMod/Readme.md',   destination: '/games/Hello/Mods/Readme.md',   modType: 'pak' },
    ]);
  });

  it('anchor matches directory, take: self → keeps the matched dir as the install root', () => {
    const rule: InstallerRule = {
      id: 'logic-mod',
      priority: 20,
      when: { kind: 'hasFile', glob: '**/LogicMods/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/LogicMods/' },
        take: 'self',
        placeAt: '${modsRoot}',
      },
      modType: 'logic-mod',
    };
    const archive = ['MyMod/LogicMods/BPFolder/X.pak', 'MyMod/LogicMods/Y.pak', 'MyMod/Readme.md'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan).toEqual([
      { source: 'MyMod/LogicMods/BPFolder/X.pak', destination: '/games/Hello/Mods/LogicMods/BPFolder/X.pak', modType: 'logic-mod' },
      { source: 'MyMod/LogicMods/Y.pak',          destination: '/games/Hello/Mods/LogicMods/Y.pak',          modType: 'logic-mod' },
    ]);
  });

  it('parent.parent climbs two levels above the anchor match', () => {
    const rule: InstallerRule = {
      id: 'ue4ss',
      priority: 10,
      when: { kind: 'hasFile', glob: '**/Scripts/*.lua' },
      single: {
        anchor: { kind: 'glob', pattern: '**/Scripts/*.lua' },
        take: 'parent.parent',
        placeAt: '${modsRoot}',
      },
      modType: 'ue4ss-lua',
    };
    const archive = ['Outer/MyMod/Scripts/main.lua', 'Outer/MyMod/Scripts/util.lua', 'Outer/MyMod/extras.txt'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan).toEqual([
      { source: 'Outer/MyMod/Scripts/main.lua', destination: '/games/Hello/Mods/MyMod/Scripts/main.lua', modType: 'ue4ss-lua' },
      { source: 'Outer/MyMod/Scripts/util.lua', destination: '/games/Hello/Mods/MyMod/Scripts/util.lua', modType: 'ue4ss-lua' },
      { source: 'Outer/MyMod/extras.txt',       destination: '/games/Hello/Mods/MyMod/extras.txt',       modType: 'ue4ss-lua' },
    ]);
  });
});

describe('buildInstallPlan — route form', () => {
  it('routes each file via the first matching route entry', () => {
    const rule: InstallerRule = {
      id: 'composite',
      priority: 90,
      when: { kind: 'all', arms: [
        { kind: 'hasFile', glob: '**/*.pak' },
        { kind: 'hasFile', glob: '**/Scripts/*.lua' },
      ] },
      route: [
        {
          match: { kind: 'glob', pattern: '**/Scripts/*.lua' },
          anchor: { kind: 'glob', pattern: '**/Scripts/' },
          take: 'parent',
          placeAt: '${modsRoot}/lua',
          modType: 'ue4ss-lua',
        },
        {
          match: { kind: 'glob', pattern: '**/*.pak' },
          anchor: { kind: 'glob', pattern: '**/*.pak' },
          take: 'parent',
          placeAt: '${modsRoot}/paks',
          modType: 'pak',
        },
      ],
    };
    const archive = ['A/Scripts/main.lua', 'A/Cool.pak', 'A/Readme.md'];
    const plan = buildInstallPlan(rule, archive, { ...ctx, archivePaths: archive });
    expect(plan.find(p => p.source === 'A/Scripts/main.lua')).toMatchObject({ modType: 'ue4ss-lua', destination: '/games/Hello/Mods/lua/Scripts/main.lua' });
    expect(plan.find(p => p.source === 'A/Cool.pak')).toMatchObject({ modType: 'pak',       destination: '/games/Hello/Mods/paks/Cool.pak' });
    expect(plan.find(p => p.source === 'A/Readme.md')).toBeUndefined();
  });
});

describe('buildInstallPlan — unless predicate', () => {
  it('returns empty plan when unless evaluates true', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 30,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      unless: { kind: 'hasFile', glob: '**/LogicMods/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '/mods',
      },
      modType: 'pak',
    };
    const archive = ['Mod/LogicMods/Cool.pak'];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([]);
  });

  it('returns plan normally when unless evaluates false', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 30,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      unless: { kind: 'hasFile', glob: '**/LogicMods/**' },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '/mods',
      },
      modType: 'pak',
    };
    const archive = ['Mod/Cool.pak'];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([
      { source: 'Mod/Cool.pak', destination: '/mods/Cool.pak', modType: 'pak' },
    ]);
  });

  it('unless is composable with !any', () => {
    const rule: InstallerRule = {
      id: 'pak',
      priority: 30,
      when: { kind: 'hasFile', glob: '**/*.pak' },
      unless: {
        kind: 'any',
        arms: [
          { kind: 'hasFile', glob: '**/LogicMods/**' },
          { kind: 'hasFile', glob: '**/Scripts/*.lua' },
        ],
      },
      single: {
        anchor: { kind: 'glob', pattern: '**/*.pak' },
        take: 'parent',
        placeAt: '/mods',
      },
      modType: 'pak',
    };
    const archive = ['Mod/Cool.pak', 'Mod/Scripts/main.lua'];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toEqual([]);
  });
});

describe('buildInstallPlan — shallowest anchor selection', () => {
  it('picks the shallowest matching file as the anchor, not the first in archive order', () => {
    const rule: InstallerRule = {
      id: 'injector',
      priority: 15,
      when: { kind: 'hasFile', glob: '**/dwmapi.dll' },
      single: {
        anchor: { kind: 'glob', pattern: '**/dwmapi.dll' },
        take: 'parent',
        placeAt: '/binaries',
      },
      modType: 'injector',
    };
    const archive = [
      'Pack/backup/old/dwmapi.dll',
      'Pack/dwmapi.dll',
    ];
    const plan = buildInstallPlan(rule, archive, { archivePaths: archive, vars: {} });
    expect(plan).toContainEqual({
      source: 'Pack/dwmapi.dll',
      destination: '/binaries/dwmapi.dll',
      modType: 'injector',
    });
    expect(plan).toContainEqual({
      source: 'Pack/backup/old/dwmapi.dll',
      destination: '/binaries/backup/old/dwmapi.dll',
      modType: 'injector',
    });
  });
});
