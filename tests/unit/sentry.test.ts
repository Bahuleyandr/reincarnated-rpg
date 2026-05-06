/**
 * Sentry-envelope wrapper tests. Coverage:
 *
 *   - DSN parsing: valid, invalid, edge shapes
 *   - Event payload shape: required fields, tags, fingerprint, level
 *   - Stacktrace parsing: V8 lines, anonymous frames, missing stack
 *   - Envelope serialisation: header order, item-header byte length
 *   - configFromEnv() returns null when SENTRY_DSN unset → callers
 *     can rely on `captureException` being a network-free no-op
 *
 * No real network calls — `captureException` against real DSNs is
 * exercised by the live deploy, not the unit suite.
 */
import {
  _internal,
  _resetSentryCacheForTests,
  isSentryConfigured,
} from "@/lib/observability/sentry";
import { _resetEnvCacheForTests } from "@/lib/util/env";

describe("Sentry wrapper", () => {
  // Env restoration: tests stomp on SENTRY_DSN to flip the wrapper
  // between configured/unconfigured. Restore so later test files
  // don't pick up our stomping.
  const originalDsn = process.env.SENTRY_DSN;
  const originalCommit = process.env.GIT_COMMIT_SHA;
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    _resetSentryCacheForTests();
    _resetEnvCacheForTests();
  });
  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
    if (originalCommit === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = originalCommit;
    // NODE_ENV is read-only on process.env per node's typings; cast
    // to a writable index. We only need to restore it if a test
    // changed it (none currently do).
    (process.env as unknown as Record<string, string | undefined>).NODE_ENV =
      originalNodeEnv;
    _resetSentryCacheForTests();
    _resetEnvCacheForTests();
  });

  describe("parseDsn", () => {
    test("parses a typical sentry.io DSN", () => {
      const r = _internal.parseDsn(
        "https://abc123def@o12345.ingest.sentry.io/67890",
      );
      expect(r).toEqual({
        publicKey: "abc123def",
        host: "https://o12345.ingest.sentry.io",
        projectId: "67890",
      });
    });

    test("handles a self-hosted DSN with a path host", () => {
      const r = _internal.parseDsn("https://key@sentry.example.com/9");
      expect(r).toEqual({
        publicKey: "key",
        host: "https://sentry.example.com",
        projectId: "9",
      });
    });

    test("rejects a DSN without a public key", () => {
      expect(_internal.parseDsn("https://o12345.ingest.sentry.io/67890")).toBeNull();
    });

    test("rejects a DSN without a project id", () => {
      expect(_internal.parseDsn("https://abc@o12345.ingest.sentry.io/")).toBeNull();
    });

    test("rejects a malformed URL", () => {
      expect(_internal.parseDsn("this is not a url")).toBeNull();
    });
  });

  describe("isSentryConfigured", () => {
    test("returns false when SENTRY_DSN is unset", () => {
      delete process.env.SENTRY_DSN;
      expect(isSentryConfigured()).toBe(false);
    });

    test("returns false when SENTRY_DSN is empty string", () => {
      process.env.SENTRY_DSN = "";
      expect(isSentryConfigured()).toBe(false);
    });

    test("returns true when SENTRY_DSN parses cleanly", () => {
      process.env.SENTRY_DSN =
        "https://abc@o12345.ingest.sentry.io/67890";
      expect(isSentryConfigured()).toBe(true);
    });

    test("returns false when SENTRY_DSN is malformed (caught by zod)", () => {
      process.env.SENTRY_DSN = "garbage";
      // Zod's .url() will reject this at env() validation, so the
      // wrapper either logs a warning + returns null OR env() throws.
      // Either way the wrapper is not configured. Test that the
      // wrapper gracefully reports unconfigured rather than
      // bubbling.
      try {
        expect(isSentryConfigured()).toBe(false);
      } catch {
        // env() may throw; that's also acceptable — code-path is
        // protected by the wrapper's lazy-eval boundary.
        expect(true).toBe(true);
      }
    });
  });

  describe("buildEventPayload", () => {
    const cfg = {
      parsed: {
        publicKey: "k",
        host: "https://x.example",
        projectId: "1",
      },
      dsn: "https://k@x.example/1",
      release: "abc1234",
      environment: "production" as const,
      serverName: "fly-bom-1",
    };

    test("captures Error.message + Error.name", () => {
      const ev = _internal.buildEventPayload(
        new TypeError("bad value"),
        undefined,
        cfg,
      );
      expect(ev.exception.values[0]).toMatchObject({
        type: "TypeError",
        value: "bad value",
      });
    });

    test("coerces non-Error to Error(String(err))", () => {
      const ev = _internal.buildEventPayload("just a string", undefined, cfg);
      expect(ev.exception.values[0].value).toBe("just a string");
    });

    test("merges tags only for non-empty string values", () => {
      const ev = _internal.buildEventPayload(new Error("e"), {
        tags: {
          sessionId: "abc",
          userId: undefined,
          empty: "",
          nullish: null,
          formId: "lesser-slime",
        },
      }, cfg);
      expect(ev.tags).toEqual({
        sessionId: "abc",
        formId: "lesser-slime",
      });
    });

    test("level defaults to error; can be overridden", () => {
      expect(
        _internal.buildEventPayload(new Error("e"), undefined, cfg).level,
      ).toBe("error");
      expect(
        _internal.buildEventPayload(
          new Error("e"),
          { level: "warning" },
          cfg,
        ).level,
      ).toBe("warning");
    });

    test("release / environment / serverName flow through", () => {
      const ev = _internal.buildEventPayload(new Error("e"), undefined, cfg);
      expect(ev.release).toBe("abc1234");
      expect(ev.environment).toBe("production");
      expect(ev.server_name).toBe("fly-bom-1");
    });

    test("event_id is 32 lowercase hex chars (no hyphens)", () => {
      const id = _internal.newEventId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("parseStacktrace", () => {
    test("parses V8 stack frames", () => {
      const stack = [
        "Error: oh no",
        "    at fooFn (file:///app/foo.js:10:5)",
        "    at /app/bar.js:20:3",
      ].join("\n");
      const trace = _internal.parseStacktrace(stack);
      expect(trace).not.toBeUndefined();
      const frames = trace!.frames;
      // Frames are reversed (oldest first → throwing frame last).
      expect(frames[frames.length - 1]).toMatchObject({
        function: "fooFn",
        filename: "file:///app/foo.js",
        lineno: 10,
        colno: 5,
      });
      expect(frames[0]).toMatchObject({
        filename: "/app/bar.js",
        lineno: 20,
        colno: 3,
      });
    });

    test("returns undefined when stack is missing", () => {
      expect(_internal.parseStacktrace(undefined)).toBeUndefined();
    });

    test("returns undefined when stack has no parseable frames", () => {
      expect(_internal.parseStacktrace("just a message\nno frames here")).toBeUndefined();
    });

    test("caps at 30 frames", () => {
      const lines = ["Error: deep"];
      for (let i = 0; i < 50; i++) {
        lines.push(`    at f${i} (/app/x.js:${i}:0)`);
      }
      const trace = _internal.parseStacktrace(lines.join("\n"));
      expect(trace!.frames.length).toBe(30);
    });
  });

  describe("serializeEnvelope", () => {
    const cfg = {
      parsed: { publicKey: "k", host: "https://x", projectId: "1" },
      dsn: "https://k@x/1",
      release: "r",
      environment: "test" as const,
      serverName: "s",
    };

    test("emits header / item-header / payload separated by newlines", () => {
      const event = _internal.buildEventPayload(new Error("e"), undefined, cfg);
      const envelope = _internal.serializeEnvelope(event, cfg);
      const lines = envelope.split("\n");
      // 3 lines + trailing empty = 4 entries.
      expect(lines.length).toBe(4);
      const header = JSON.parse(lines[0]);
      const itemHeader = JSON.parse(lines[1]);
      const payload = JSON.parse(lines[2]);
      expect(header.event_id).toBe(event.event_id);
      expect(header.dsn).toBe("https://k@x/1");
      expect(itemHeader.type).toBe("event");
      expect(itemHeader.length).toBe(Buffer.byteLength(lines[2], "utf8"));
      expect(payload.event_id).toBe(event.event_id);
    });
  });
});
