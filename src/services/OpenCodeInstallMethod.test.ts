import { describe, expect, it, vi } from "vitest";
import {
  classifyPath,
  detectInstallMethod,
  detectNvmWindows,
  getDefaultMethod,
  parseUpgradeMethodChoices,
  type RunFn,
} from "./OpenCodeInstallMethod";

describe("OpenCodeInstallMethod", () => {
  describe("parseUpgradeMethodChoices", () => {
    it("parses the vp-era choices line", () => {
      const help = [
        "Upgrade opencode to the latest version",
        "",
        "Flags:",
        "  -h, --help          help for upgrade",
        "  -m, --method string   installation method (choices: curl, npm, pnpm, bun, yarn, vp, brew)",
        "  -y, --yes             skip confirmation prompt",
      ].join("\n");
      expect(parseUpgradeMethodChoices(help)).toEqual([
        "curl",
        "npm",
        "pnpm",
        "bun",
        "yarn",
        "vp",
        "brew",
      ]);
    });

    it("parses the scoop/choco-era choices line", () => {
      const help =
        "  -m, --method string   Install method (choices: curl, npm, pnpm, bun, brew, choco, scoop)";
      expect(parseUpgradeMethodChoices(help)).toEqual([
        "curl",
        "npm",
        "pnpm",
        "bun",
        "brew",
        "choco",
        "scoop",
      ]);
    });

    it("parses choices wrapped onto a following line", () => {
      const help = [
        "  -m, --method string",
        "        installation method (choices: curl, npm, brew)",
      ].join("\n");
      expect(parseUpgradeMethodChoices(help)).toEqual([
        "curl",
        "npm",
        "brew",
      ]);
    });

    it("returns undefined for garbage output", () => {
      expect(parseUpgradeMethodChoices("Usage:\n  opencode upgrade")).toBeUndefined();
      expect(parseUpgradeMethodChoices("")).toBeUndefined();
    });

    it("returns undefined for an empty choices list", () => {
      expect(parseUpgradeMethodChoices("  -m, --method (choices: )")).toBeUndefined();
    });
  });

  describe("classifyPath", () => {
    it("classifies win32 paths with backslashes", () => {
      expect(classifyPath("C:\\Users\\sage\\.opencode\\bin\\opencode.exe", "win32")).toBe("curl");
      expect(classifyPath("C:\\Users\\sage\\.local\\bin\\opencode.exe", "win32")).toBe("curl");
      expect(classifyPath("C:\\Users\\sage\\AppData\\Roaming\\npm\\opencode.cmd", "win32")).toBe("npm");
      expect(classifyPath("C:\\Users\\sage\\AppData\\Local\\pnpm\\opencode.cmd", "win32")).toBe("pnpm");
      expect(classifyPath("C:\\Users\\sage\\.bun\\bin\\opencode.exe", "win32")).toBe("bun");
      expect(classifyPath("C:\\Users\\sage\\AppData\\Local\\Yarn\\bin\\opencode.cmd", "win32")).toBe("yarn");
      expect(classifyPath("C:\\Users\\sage\\.yarn\\bin\\opencode", "win32")).toBe("yarn");
    });

    it("classifies win32 paths with forward slashes too", () => {
      expect(classifyPath("C:/Users/sage/AppData/Local/pnpm/opencode.cmd", "win32")).toBe("pnpm");
      expect(classifyPath("C:/Users/sage/.opencode/bin/opencode.exe", "win32")).toBe("curl");
    });

    it("leaves win32 nvm shims and unknown dirs to package-manager probes", () => {
      expect(classifyPath("C:\\Users\\sage\\AppData\\Roaming\\nvm\\opencode.exe", "win32")).toBeUndefined();
      expect(classifyPath("C:\\Program Files\\opencode\\opencode.exe", "win32")).toBeUndefined();
    });

    it("classifies darwin paths", () => {
      expect(classifyPath("/Users/dev/.opencode/bin/opencode", "darwin")).toBe("curl");
      expect(classifyPath("/Users/dev/.local/bin/opencode", "darwin")).toBe("curl");
      expect(classifyPath("/opt/homebrew/bin/opencode", "darwin")).toBe("brew");
      expect(classifyPath("/usr/local/Cellar/opencode/2.0.6/bin/opencode", "darwin")).toBe("brew");
      expect(classifyPath("/Users/dev/.nvm/versions/node/v20.11.1/bin/opencode", "darwin")).toBe("npm");
      expect(classifyPath("/Users/dev/Library/pnpm/opencode", "darwin")).toBe("pnpm");
      expect(classifyPath("/Users/dev/.bun/bin/opencode", "darwin")).toBe("bun");
      expect(classifyPath("/Users/dev/.yarn/bin/opencode", "darwin")).toBe("yarn");
      expect(classifyPath("/usr/local/bin/opencode", "darwin")).toBeUndefined();
    });

    it("classifies linux paths", () => {
      expect(classifyPath("/home/dev/.local/bin/opencode", "linux")).toBe("curl");
      expect(classifyPath("/home/dev/.local/share/pnpm/opencode", "linux")).toBe("pnpm");
      expect(classifyPath("/home/linuxbrew/.linuxbrew/bin/opencode", "linux")).toBe("brew");
      expect(classifyPath("/home/dev/.opencode/bin/opencode", "linux")).toBe("curl");
      expect(classifyPath("/usr/bin/opencode", "linux")).toBeUndefined();
    });

    it("ignores homebrew prefixes on win32", () => {
      expect(classifyPath("/opt/homebrew/bin/opencode", "win32")).toBeUndefined();
    });
  });

  describe("detectInstallMethod", () => {
    it("returns path classification without running probes", async () => {
      const run = vi.fn(async () => {
        throw new Error("unexpected exec");
      });
      await expect(
        detectInstallMethod("/home/dev/.opencode/bin/opencode", "linux", run),
      ).resolves.toEqual({ method: "curl", nvmManaged: false });
      expect(run).not.toHaveBeenCalled();
    });

    it("flags nvm-managed npm installs from the path", async () => {
      const run = vi.fn(async () => {
        throw new Error("unexpected exec");
      });
      await expect(
        detectInstallMethod(
          "/Users/dev/.nvm/versions/node/v20.11.1/bin/opencode",
          "darwin",
          run,
        ),
      ).resolves.toEqual({ method: "npm", nvmManaged: true });
      expect(run).not.toHaveBeenCalled();
    });

    it("probes package managers in order and treats errors as no-match", async () => {
      const run = vi.fn(async (file: string) => {
        if (file === "npm") {
          throw new Error("npm not found");
        }
        if (file === "yarn") {
          return 'yarn global v1.22.19\ninfo "webpack@5.0.0"';
        }
        if (file === "pnpm") {
          return "@opencode/cli 2.0.20\n";
        }
        throw new Error("should not get here");
      });
      await expect(
        detectInstallMethod("/usr/local/bin/opencode", "linux", run),
      ).resolves.toEqual({ method: "pnpm", nvmManaged: false });
      expect(run.mock.calls.map(([file]) => file)).toEqual([
        "npm",
        "yarn",
        "pnpm",
      ]);
    });

    it("does not match npm output containing only the legacy opencode-ai package", async () => {
      const run = vi.fn(async (file: string) => {
        if (file === "npm") {
          return "/usr/lib\n├── opencode-ai@1.18.33\n└── typescript@5.6.0\n";
        }
        throw new Error("not installed");
      });
      await expect(
        detectInstallMethod("/usr/local/bin/opencode", "linux", run),
      ).resolves.toEqual({ method: "unknown", nvmManaged: false });
    });

    it("matches the v2 scoped package @opencode/cli in npm output", async () => {
      const run = vi.fn(async () =>
        "/usr/lib\n├── @opencode/cli@2.0.20\n└── typescript@5.6.0\n",
      );
      await expect(
        detectInstallMethod("/usr/local/bin/opencode", "linux", run),
      ).resolves.toEqual({ method: "npm", nvmManaged: false });
    });

    it("matches @opencode/cli in pnpm output too", async () => {
      const run = vi.fn(async (file: string) => {
        if (file === "pnpm") {
          return "@opencode/cli 2.0.20\n";
        }
        throw new Error("not installed");
      });
      await expect(
        detectInstallMethod("/usr/local/bin/opencode", "linux", run),
      ).resolves.toEqual({ method: "pnpm", nvmManaged: false });
    });

    it("falls through when package-manager output has no opencode package", async () => {
      const run = vi.fn(async () =>
        "/usr/lib\n├── typescript@5.6.0\n└── webpack@5.0.0\n",
      );
      await expect(
        detectInstallMethod("/usr/local/bin/opencode", "linux", run),
      ).resolves.toEqual({ method: "unknown", nvmManaged: false });
    });

    it("matches scoop and choco outputs after js package managers miss", async () => {
      const scoopRun = vi.fn(async (file: string) => {
        if (file === "scoop") {
          return "opencode 2.0.6 2.0.5\n";
        }
        throw new Error("not installed");
      });
      await expect(
        detectInstallMethod("C:\\Users\\sage\\bin\\opencode.exe", "win32", scoopRun),
      ).resolves.toEqual({ method: "scoop", nvmManaged: false });

      const chocoRun = vi.fn(async (file: string) => {
        if (file === "choco") {
          return "opencode|2.0.6";
        }
        throw new Error("not installed");
      });
      await expect(
        detectInstallMethod("C:\\Users\\sage\\bin\\opencode.exe", "win32", chocoRun),
      ).resolves.toEqual({ method: "choco", nvmManaged: false });
    });

    it("falls back to unknown when every probe fails", async () => {
      const run = vi.fn(async () => {
        throw new Error("command not found");
      });
      await expect(
        detectInstallMethod("/usr/bin/opencode", "linux", run),
      ).resolves.toEqual({ method: "unknown", nvmManaged: false });
      expect(run.mock.calls.map(([file]) => file)).toEqual([
        "npm",
        "yarn",
        "pnpm",
        "bun",
        "brew",
        "scoop",
        "choco",
      ]);
      expect(run.mock.calls[0][1]).toEqual(["list", "-g", "--depth=0"]);
      expect(run.mock.calls[3][1]).toEqual(["pm", "ls", "-g"]);
      expect(run.mock.calls[4][1]).toEqual(["list", "--formula", "opencode"]);
      expect(run.mock.calls[6][1]).toEqual(["list", "--limit-output", "opencode"]);
    });
  });

  describe("detectNvmWindows", () => {
    it("returns true for nvm-windows 2.x", async () => {
      const run: RunFn = async () => "2.0.1-hotfix.2";
      await expect(detectNvmWindows(run)).resolves.toBe(true);
    });

    it("returns false for nvm-windows 1.x", async () => {
      const run: RunFn = async () => "1.1.12";
      await expect(detectNvmWindows(run)).resolves.toBe(false);
    });

    it("returns false when nvm is missing or silent", async () => {
      const failing: RunFn = async () => {
        throw new Error("nvm not found");
      };
      await expect(detectNvmWindows(failing)).resolves.toBe(false);
      const silent: RunFn = async () => "";
      await expect(detectNvmWindows(silent)).resolves.toBe(false);
    });
  });

  describe("getDefaultMethod", () => {
    it("prefers the persisted last-used method when offered", () => {
      expect(getDefaultMethod(["curl", "npm", "pnpm"], "pnpm", "curl")).toBe("pnpm");
    });

    it("falls back to the detected method when last-used is gone", () => {
      expect(getDefaultMethod(["curl", "npm"], "vp", "npm")).toBe("npm");
      expect(getDefaultMethod(["curl", "pnpm"], undefined, "pnpm")).toBe("pnpm");
    });

    it("defaults to npm when neither hint applies", () => {
      expect(getDefaultMethod(["curl", "npm"], undefined, undefined)).toBe("npm");
    });

    it("guards against choices without npm", () => {
      expect(getDefaultMethod(["curl", "pnpm"], undefined, "npm")).toBe("curl");
      expect(getDefaultMethod([], undefined, undefined)).toBe("npm");
    });
  });
});
