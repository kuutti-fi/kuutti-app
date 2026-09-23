import { describe, expect, it } from "vitest";
import { createApp, PUBLIC_ROUTES } from "./app.ts";
import { captureLogger, testConfig, testPool } from "./test/harness.ts";

/**
 * Rule 6's structural half (#35): a route that is not on the public list is
 * registered behind the session middleware, so no handler can read user data
 * without an account id on the context. Routes come from the router, so a new
 * route is checked the day it is added.
 */
describe("route table", () => {
  it("every route outside PUBLIC_ROUTES sits behind requireSession", async () => {
    const { logger } = await captureLogger();
    const app = createApp({ config: testConfig(), logger, db: testPool() });
    // Registration order is execution order: the guard counts only when it was
    // registered on the handler's exact path before the handler. Middleware is
    // what takes (c, next); everything else, on any method or pattern, is a route.
    const guardedAt = new Map<string, number>();
    const routes: { key: string; path: string; index: number }[] = [];
    app.routes.forEach(({ method, path, handler }, index) => {
      if (handler.name === "requireSession") {
        if (!guardedAt.has(path)) guardedAt.set(path, index);
        return;
      }
      if (handler.length === 2) return;
      routes.push({ key: `${method} ${path}`, path, index });
    });
    expect(routes.length).toBeGreaterThan(0);
    const unguarded = routes
      .filter(({ key, path, index }) => {
        const guard = guardedAt.get(path);
        return !PUBLIC_ROUTES.has(key) && (guard === undefined || guard > index);
      })
      .map(({ key }) => key);
    expect(unguarded).toEqual([]);
    // And the public list is not silently wider than the router.
    const keys = new Set(routes.map((r) => r.key));
    for (const key of PUBLIC_ROUTES) expect(keys.has(key)).toBe(true);
  });
});
