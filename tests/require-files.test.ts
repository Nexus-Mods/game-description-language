import { describe, it, expect, beforeEach } from "vitest";
import { parseYaml } from "../src/parser/index.js";
import { validate } from "../src/schema/validator.js";
import { GdlRuntime } from "../src/runtime/index.js";
import { createFakeContext } from "../src/runtime/testing/index.js";
import type { IExtensionContext } from "vortex-api";
import { vi } from "vitest";

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

const RT_DECL = { id: "g", name: "G", executable: "G.exe", requiredFiles: ["G.exe"] };
const RT_STORES = [{ id: "steam", value: "1" }];
const RT_CTX = { bindings: [] };
const RT_MODTYPES: never[] = [];
const RT_RF = {
    files: ["${installPath}/UnityModManager/UnityModManager.dll"],
    prompt: {
        title: "Action required",
        message: "Install UMM",
        link: { label: "Get UMM", url: "https://www.nexusmods.com/site/mods/21" },
    },
};

const dialogMock = (h: ReturnType<typeof createFakeContext>) =>
    (h.context as unknown as { api: { showDialog: ReturnType<typeof vi.fn> } }).api.showDialog;

describe("runtime: setup.requireFiles", () => {
    beforeEach(() => vi.clearAllMocks());

    it("shows the prompt when a required file is missing", async () => {
        const { fs } = await import("vortex-api");
        vi.mocked(fs.statAsync).mockRejectedValue(new Error("ENOENT"));
        const h = createFakeContext();
        const runtime = new GdlRuntime(h.context as IExtensionContext);
        runtime.registerGame(
            RT_DECL,
            RT_STORES,
            RT_CTX,
            RT_MODTYPES,
            [],
            {},
            [],
            [],
            {},
            [],
            RT_RF,
        );
        const g = h.registered.game!;
        await g.setup!({ path: "/games/g", store: "steam" });
        expect(dialogMock(h)).toHaveBeenCalledTimes(1);
        expect(dialogMock(h).mock.calls[0][1]).toBe("Action required");
    });

    it("stays silent when all required files exist", async () => {
        const { fs } = await import("vortex-api");
        vi.mocked(fs.statAsync).mockResolvedValue({ isDirectory: () => false });
        const h = createFakeContext();
        const runtime = new GdlRuntime(h.context as IExtensionContext);
        runtime.registerGame(
            RT_DECL,
            RT_STORES,
            RT_CTX,
            RT_MODTYPES,
            [],
            {},
            [],
            [],
            {},
            [],
            RT_RF,
        );
        await h.registered.game!.setup!({ path: "/games/g", store: "steam" });
        expect(dialogMock(h)).not.toHaveBeenCalled();
    });
});
