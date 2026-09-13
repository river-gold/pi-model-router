import { describe, expect, it, vi } from "vitest";
import {
  createLoadRouterConfig,
  createParseConfigFile,
  resolveConfigPaths,
  CONFIG_FILE_NAMES,
} from "../../src/config/io";
import type { RouterConfig } from "../../src/types";

describe("io를 검증함", () => {
  describe("createParseConfigFile 동작을 검증함", () => {
    it("파일 없으면 빈 설정을 반환함을 검증함", () => {
      const fs = { existsSync: () => false, readFileSync: vi.fn() };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: (s) => JSON.parse(s) });
      expect(parse("/no/file")).toEqual({ config: {}, warnings: [] });
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });
    it("유효한 JSON object를 파싱함을 검증함", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => JSON.stringify({ debug: true, profiles: {} }),
      };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: (s) => JSON.parse(s) });
      const r = parse("/exists.json");
      expect(r.config).toEqual({ debug: true, profiles: {} });
      expect(r.warnings).toEqual([]);
    });
    it("parseJsonc를 사용함을 검증함", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => '{ "a": 1, // comment\n}',
      };
      const parseJsonc = vi.fn().mockReturnValue({ a: 1 });
      const parse = createParseConfigFile({ fs: fs, parseJsonc: parseJsonc });
      const r = parse("/f");
      expect(parseJsonc).toHaveBeenCalledWith('{ "a": 1, // comment\n}');
      expect(r.config).toEqual({ a: 1 });
    });
    it("object가 아니면 warning 남김을 검증함", () => {
      const fs = { existsSync: () => true, readFileSync: () => "123" };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: (s) => JSON.parse(s) });
      const r = parse("/f");
      expect(r.config).toEqual({});
      expect(r.warnings[0]).toMatch(/expected a JSON object/);
    });
    it("배열이면 object가 아니라고 warning 남김을 검증함", () => {
      const fs = { existsSync: () => true, readFileSync: () => "[]" };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: (s) => JSON.parse(s) });
      expect(parse("/f").warnings[0]).toMatch(/expected a JSON object/);
    });
    it("readFileSync 에러를 포착함을 검증함", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => {
          throw new Error("read fail");
        },
      };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: (s) => JSON.parse(s) });
      expect(parse("/f").warnings[0]).toMatch(/Failed to parse.*read fail/);
    });
    it("JSON 파싱 에러를 포착함을 검증함", () => {
      const fs = { existsSync: () => true, readFileSync: () => "{invalid" };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: (s) => JSON.parse(s) });
      expect(parse("/f").warnings[0]).toMatch(/Failed to parse/);
    });
    it("non-Error throw를 포착함을 검증함", () => {
      const fs = {
        existsSync: () => true,
        readFileSync: () => {
          throw "string error";
        },
      };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: (s) => JSON.parse(s) });
      expect(parse("/f").warnings[0]).toMatch(/string error/);
    });
    it("parseJsonc throw를 포착함을 검증함", () => {
      const fs = { existsSync: () => true, readFileSync: () => "{}" };
      const parseJsonc = () => {
        throw new Error("parse fail");
      };
      const parse = createParseConfigFile({ fs: fs, parseJsonc: parseJsonc });
      expect(parse("/f").warnings[0]).toMatch(/parse fail/);
    });
  });

  describe("resolveConfigPaths 동작을 검증함", () => {
    it("네 개 경로를 해석함을 검증함", () => {
      const getAgentDir = () => "/agent";
      const join = (...parts: string[]) => parts.join("/");
      const r = resolveConfigPaths("/cwd", getAgentDir, join);
      expect(r.globalJsonPath).toBe(`/agent/${CONFIG_FILE_NAMES.globalJson}`);
      expect(r.globalJsoncPath).toBe(`/agent/${CONFIG_FILE_NAMES.globalJsonc}`);
      expect(r.projectJsonPath).toBe(`/cwd/.pi/${CONFIG_FILE_NAMES.projectJson}`);
      expect(r.projectJsoncPath).toBe(`/cwd/.pi/${CONFIG_FILE_NAMES.projectJsonc}`);
    });
  });

  describe("createLoadRouterConfig 동작을 검증함", () => {
    it("네 개 파일을 로드·병합하고 warnings를 집계함을 검증함", () => {
      const deps = {
        fs: { existsSync: () => true, readFileSync: () => "{}" },
        getAgentDir: () => "/agent",
        join: (...parts: string[]) => parts.join("/"),
        parseConfigFile: vi
          .fn()
          .mockReturnValueOnce({
            config: {
              debug: true,
              profiles: { a: { medium: { models: ["openai/a"] } } },
            },
            warnings: ["w1"],
          })
          .mockReturnValueOnce({
            config: {
              profiles: { b: { high: { models: ["openai/b"] } } },
            },
            warnings: ["w2"],
          })
          .mockReturnValueOnce({
            config: { profiles: { c: { low: { models: ["openai/c"] } } } },
            warnings: [],
          })
          .mockReturnValueOnce({
            config: {
              profiles: { d: { minimal: { models: ["openai/d"] } } },
            },
            warnings: ["w4"],
          }),
        mergeConfig: vi.fn((base: RouterConfig, override: Partial<RouterConfig>) => ({
          profiles: { ...base.profiles, ...override.profiles },
          debug: override.debug ?? base.debug,
        })),
        normalizeConfig: vi.fn((c: RouterConfig) => ({ config: c, warnings: ["norm"] })),
      };
      const load = createLoadRouterConfig(deps);
      const result = load("/cwd");
      expect(deps.parseConfigFile).toHaveBeenCalledTimes(4);
      expect(deps.mergeConfig).toHaveBeenCalledTimes(4);
      expect(deps.normalizeConfig).toHaveBeenCalled();
      expect(result.warnings).toEqual(["w1", "w2", "w4", "norm"]);
      expect(result.config.profiles.a).toBeDefined();
      expect(result.config.profiles.b).toBeDefined();
    });
    it("빈 설정을 처리함을 검증함", () => {
      const deps = {
        fs: { existsSync: () => true, readFileSync: () => "{}" },
        getAgentDir: () => "/agent",
        join: (...p: string[]) => p.join("/"),
        parseConfigFile: vi.fn().mockReturnValue({ config: {}, warnings: [] }),
        mergeConfig: (b: RouterConfig, o: Partial<RouterConfig>) => ({
          ...b,
          ...o,
          profiles: { ...b.profiles, ...o.profiles },
        }),
        normalizeConfig: (c: any) => ({ config: c, warnings: [] }),
      };
      const load = createLoadRouterConfig(deps);
      const r = load("/cwd");
      expect(r.warnings).toEqual([]);
    });
    it("기본 설정이 빈 상태로 시작함을 검증함", () => {
      let firstBase: any = null;
      const deps = {
        fs: {},
        getAgentDir: () => "/a",
        join: (...p: string[]) => p.join("/"),
        parseConfigFile: vi.fn().mockReturnValue({ config: {}, warnings: [] }),
        mergeConfig: vi.fn((base: RouterConfig, override: Partial<RouterConfig>) => {
          if (firstBase === null) firstBase = base;
          return { ...base, ...override };
        }),
        normalizeConfig: (c: any) => ({ config: c, warnings: [] }),
      };
      createLoadRouterConfig(deps)("/cwd");
      expect(firstBase).toEqual({ profiles: {} });
    });
  });
});
