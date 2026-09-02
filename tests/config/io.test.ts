import { describe, expect, it, vi } from "vitest";
import {
  createLoadRouterConfig,
  createParseConfigFile,
  resolveConfigPaths,
  CONFIG_FILE_NAMES,
} from "../../src/config/io";
import type { RouterConfig } from "../../src/types";

describe("io", () => {
  describe("createParseConfigFile", () => {
    it("returns empty if not exists", () => {
      const fs = { existsSync: () => false, readFileSync: vi.fn() };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: (s) => s });
      expect(parse("/no/file")).toEqual({ config: {}, warnings: [] });
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });
    it("parses valid JSON object", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ debug: true, profiles: {} }),
      };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: (s) => s });
      const r = parse("/exists.json");
      expect(r.config).toEqual({ debug: true, profiles: {} });
      expect(r.warnings).toEqual([]);
    });
    it("uses stripJsonc", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => '{ "a": 1, // comment\n}',
      };
      const strip = vi.fn().mockReturnValue('{"a":1}');
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: strip });
      const r = parse("/f");
      expect(strip).toHaveBeenCalledWith('{ "a": 1, // comment\n}');
      expect(r.config).toEqual({ a: 1 } as any);
    });
    it("warns if not object", () => {
      const fs = { existsSync: () => true, readFileSync: () => "123" };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: (s) => s });
      const r = parse("/f");
      expect(r.config).toEqual({});
      expect(r.warnings[0]).toMatch(/expected a JSON object/);
    });
    it("warns on array not object", () => {
      const fs = { existsSync: () => true, readFileSync: () => "[]" };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: (s) => s });
      expect(parse("/f").warnings[0]).toMatch(/expected a JSON object/);
    });
    it("catches readFileSync error", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => {
          throw new Error("read fail");
        },
      };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: (s) => s });
      expect(parse("/f").warnings[0]).toMatch(/Failed to parse.*read fail/);
    });
    it("catches JSON parse error", () => {
      const fs = { existsSync: () => true, readFileSync: () => "{invalid" };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: (s) => s });
      expect(parse("/f").warnings[0]).toMatch(/Failed to parse/);
    });
    it("catches non-Error throw", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => {
          throw "string error";
        },
      };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: (s) => s });
      expect(parse("/f").warnings[0]).toMatch(/string error/);
    });
    it("stripJsonc throws -> caught", () => {
      const fs = { existsSync: () => true, readFileSync: () => "{}" };
      const strip = () => {
        throw new Error("strip fail");
      };
      const parse = createParseConfigFile({ fs: fs as any, stripJsonc: strip });
      expect(parse("/f").warnings[0]).toMatch(/strip fail/);
    });
  });

  describe("resolveConfigPaths", () => {
    it("resolves four paths", () => {
      const getAgentDir = () => "/agent";
      const join = (...parts: string[]) => parts.join("/");
      const r = resolveConfigPaths("/cwd", getAgentDir, join);
      expect(r.globalJsonPath).toBe(`/agent/${CONFIG_FILE_NAMES.globalJson}`);
      expect(r.globalJsoncPath).toBe(`/agent/${CONFIG_FILE_NAMES.globalJsonc}`);
      expect(r.projectJsonPath).toBe(`/cwd/.pi/${CONFIG_FILE_NAMES.projectJson}`);
      expect(r.projectJsoncPath).toBe(`/cwd/.pi/${CONFIG_FILE_NAMES.projectJsonc}`);
    });
  });

  describe("createLoadRouterConfig", () => {
    it("loads and merges four files and aggregates warnings", () => {
      const deps = {
        fs: { existsSync: () => true, readFileSync: () => "{}" } as any,
        getAgentDir: () => "/agent",
        join: (...parts: string[]) => parts.join("/"),
        parseConfigFile: vi
          .fn()
          .mockReturnValueOnce({
            config: {
              debug: true,
              profiles: { a: { medium: { models: ["openai/a"] } } },
            } as Partial<RouterConfig>,
            warnings: ["w1"],
          })
          .mockReturnValueOnce({
            config: {
              profiles: { b: { high: { models: ["openai/b"] } } },
            } as Partial<RouterConfig>,
            warnings: ["w2"],
          })
          .mockReturnValueOnce({
            config: { profiles: { c: { low: { models: ["openai/c"] } } } } as Partial<RouterConfig>,
            warnings: [],
          })
          .mockReturnValueOnce({
            config: {
              profiles: { d: { minimal: { models: ["openai/d"] } } },
            } as Partial<RouterConfig>,
            warnings: ["w4"],
          }),
        mergeConfig: vi.fn(
          (base, override) =>
            ({
              profiles: { ...base.profiles, ...override.profiles },
              debug: override.debug ?? base.debug,
            }) as RouterConfig,
        ),
        normalizeConfig: vi.fn((c) => ({ config: c as RouterConfig, warnings: ["norm"] })),
      };
      const load = createLoadRouterConfig(deps as any);
      const result = load("/cwd");
      expect(deps.parseConfigFile).toHaveBeenCalledTimes(4);
      expect(deps.mergeConfig).toHaveBeenCalledTimes(4);
      expect(deps.normalizeConfig).toHaveBeenCalled();
      expect(result.warnings).toEqual(["w1", "w2", "w4", "norm"]);
      expect(result.config.profiles.a).toBeDefined();
      expect(result.config.profiles.b).toBeDefined();
    });
    it("handles empty configs", () => {
      const deps = {
        fs: { existsSync: () => true, readFileSync: () => "{}" } as any,
        getAgentDir: () => "/agent",
        join: (...p: string[]) => p.join("/"),
        parseConfigFile: vi.fn().mockReturnValue({ config: {}, warnings: [] }),
        mergeConfig: (b: any, o: any) =>
          ({ ...b, ...o, profiles: { ...b.profiles, ...o.profiles } }) as RouterConfig,
        normalizeConfig: (c: any) => ({ config: c, warnings: [] }),
      };
      const load = createLoadRouterConfig(deps as any);
      const r = load("/cwd");
      expect(r.warnings).toEqual([]);
    });
    it("base config starts empty", () => {
      let firstBase: any = null;
      const deps = {
        fs: {} as any,
        getAgentDir: () => "/a",
        join: (...p: string[]) => p.join("/"),
        parseConfigFile: vi.fn().mockReturnValue({ config: {}, warnings: [] }),
        mergeConfig: vi.fn((base, override) => {
          if (firstBase === null) firstBase = base;
          return { ...base, ...override } as any;
        }),
        normalizeConfig: (c: any) => ({ config: c, warnings: [] }),
      };
      createLoadRouterConfig(deps as any)("/cwd");
      expect(firstBase).toEqual({ profiles: {} });
    });
  });
});
