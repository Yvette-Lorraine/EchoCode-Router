/**
 * EchoCode Router — 独立可运行示例
 *
 * 一个 100 行的 Node HTTP server：
 *   POST /v1/chat/completions  →  OpenAI 兼容 + EchoCode Router 调度
 *
 * 不依赖任何 ORM / Next.js / Express。
 * 数据全部用 in-memory（见 examples/data.ts）。
 *
 * 运行：
 *   pnpm add echocode-router
 *   node examples/standalone-server.js
 *   curl -X POST http://localhost:8787/v1/chat/completions \
 *     -H "Content-Type: application/json" \
 *     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
 */

import { createServer } from "node:http";
import { resolveRoute, runCascade, classifyUpstreamError, getAdapter, ErrorClass } from "echocode-router";
import { inMemoryStorage, demoData } from "./data.js";

/* ========== RouterStorage 实现 — 用 demoData 当内存数据源 ========== */
const storage = inMemoryStorage(demoData);

/* ========== KeyStore 实现（Demo：用 markByokSuccess/Failure noop） ========== */
const keyStore = {
  async markSuccess(_byokId) {},
  async markFailure(_byokId, _status) {},
  async markInvalid(_byokId) {},
};

/* ========== 简易 HTTP server ========== */
const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  let reqJson;
  try {
    reqJson = JSON.parse(body);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INVALID_JSON" } }));
    return;
  }

  const { model, messages } = reqJson;
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "INVALID_REQUEST" } }));
    return;
  }

  let ranked, decision;
  try {
    const out = await resolveRoute("org-demo", model, { allowMockFallback: true }, storage);
    ranked = out.ranked;
    decision = out.decision;
  } catch (e) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "UNKNOWN_MODEL", message: e.message } }));
    return;
  }

  // 走 cascade 顺位重试
  const cascade = await runCascade(
    ranked,
    async (providerId, modelId, byokId) => {
      const adapter = getAdapter(providerId);
      try {
        const out = await adapter.completeChat(
          { model: modelId, messages, stream: false },
          {
            apiKey: "demo-key", // 用 mock 时无意义
            orgId: "org-demo",
            keyId: byokId ?? "demo",
          }
        );
        return { ok: true, data: out };
      } catch (e) {
        const err = e as any;
        return { ok: false, status: err?.status, bodyText: err?.message, error: err };
      }
    }
  );

  if (!cascade.ok || !cascade.chosen) {
    const last = cascade.finalError;
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { code: "ALL_ATTEMPTS_FAILED", message: last?.message ?? "no candidate" },
        routeDecision: {
          ...decision,
          chosen: null,
          fallbackChain: cascade.attempts.map(
            (a) => `${a.providerId}:${a.byokId ?? "no-key"}=${a.errorClass ?? "ok"}`
          ),
        },
      })
    );
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ...(cascade.attempts[cascade.attempts.length - 1].response as any),
      _echo: {
        alias: decision.alias,
        strategy: decision.strategy,
        chosen: cascade.chosen,
        candidates: decision.candidates,
        totalRouterMs: decision.totalRouterMs,
      },
    })
  );
});

const PORT = Number(process.env.PORT ?? 8787);
server.listen(PORT, () => {
  console.log(`EchoCode Router standalone demo listening on http://localhost:${PORT}`);
  console.log(`Try:  curl -X POST http://localhost:${PORT}/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'`);
});
