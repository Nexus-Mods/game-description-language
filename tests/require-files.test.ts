import { describe, it, expect } from "vitest";
import { parseYaml } from "../src/parser/index.js";
import { validate } from "../src/schema/validator.js";

const YAML = `gdl: 1
game:
  id: g
  name: G
  executable: G.exe
  requiredFiles: [G.exe]
stores:
  steam: "1"
setup:
  ensureDirs:
    - \${installPath}/Mods
  requireFiles:
    files:
      - \${installPath}/UnityModManager/UnityModManager.dll
    prompt:
      title: Action required
      message: Install UMM
      link:
        label: Get UMM
        mod: { domain: site, modId: 21 }
`;

describe("parser: setup.requireFiles", () => {
    it("parses files, prompt, and a mod link target", () => {
        const doc = parseYaml(YAML, "rf.yaml");
        const rf = doc.setup?.requireFiles;
        expect(rf?.files).toEqual(["${installPath}/UnityModManager/UnityModManager.dll"]);
        expect(rf?.prompt.title).toBe("Action required");
        expect(rf?.prompt.message).toBe("Install UMM");
        expect(rf?.prompt.link?.label).toBe("Get UMM");
        expect(rf?.prompt.link?.target).toEqual({ kind: "mod", domain: "site", modId: 21 });
    });

    it("parses a url link target", () => {
        const doc = parseYaml(
            YAML.replace("mod: { domain: site, modId: 21 }", "url: https://example.com/umm"),
            "rf.yaml",
        );
        expect(doc.setup?.requireFiles?.prompt.link?.target).toEqual({
            kind: "url",
            url: "https://example.com/umm",
        });
    });
});

const baseYaml = (rf: string) => `gdl: 1
game:
  id: g
  name: G
  executable: G.exe
  requiredFiles: [G.exe]
stores:
  steam: "1"
setup:
  ensureDirs:
    - \${installPath}/Mods
  requireFiles:
${rf}
`;

describe("validator: setup.requireFiles", () => {
    it("accepts a well-formed requireFiles block", () => {
        const doc = parseYaml(
            baseYaml(
                `    files:
      - \${installPath}/x.dll
    prompt:
      title: T
      message: M
      link:
        label: L
        mod: { domain: site, modId: 21 }`,
            ),
            "rf.yaml",
        );
        expect(validate(doc).filter((e) => e.code.startsWith("GDL15"))).toEqual([]);
    });

    it("rejects an empty files list", () => {
        const doc = parseYaml(
            baseYaml(
                `    files: []
    prompt:
      title: T
      message: M`,
            ),
            "rf.yaml",
        );
        expect(validate(doc).some((e) => e.code === "GDL153")).toBe(true);
    });

    it("rejects a missing prompt title", () => {
        const doc = parseYaml(
            baseYaml(
                `    files:
      - \${installPath}/x.dll
    prompt:
      title: ""
      message: M`,
            ),
            "rf.yaml",
        );
        expect(validate(doc).some((e) => e.code === "GDL154")).toBe(true);
    });

    it("rejects a link with an empty mod domain", () => {
        const doc = parseYaml(
            baseYaml(
                `    files:
      - \${installPath}/x.dll
    prompt:
      title: T
      message: M
      link:
        label: L
        mod: { domain: "", modId: 21 }`,
            ),
            "rf.yaml",
        );
        expect(validate(doc).some((e) => e.code === "GDL155")).toBe(true);
    });
});
