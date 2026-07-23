# 接入指南 — 怎么把 EchoCode Router 接到你的后端

本包是 **0 耦合设计**：不知道 Prisma、Drizzle、Mongo 或 Next.js 的存在。
你实现 4 个小 storage 接口，其它一切由路由层接管。

## 1. `RouterStorage` — 必接

`RouterStorage` 是 `resolveRoute()` 所需的全部数据源。**所有方法加起来不到 100 行**。

### Prisma 示例

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const routerStorage = {
  async loadPolicyByAlias(alias) {
    return prisma.routePolicy.findFirst({ where: { alias, enabled: true } });
  },
  async loadActiveModels() {
    return prisma.model.findMany({ where: { status: "ACTIVE" } });
  },
  async loadProviders() {
    return prisma.provider.findMany();
  },
  async loadCandidatesByPolicy(policyId) {
    return prisma.routeCandidate.findMany({
      where: { policyId, enabled: true },
      orderBy: { priority: "asc" },
    });
  },
  async loadByokPool(orgId) {
    return prisma.byokCredential.findMany({
      where: {
        orgId, status: "ACTIVE", revokedAt: null, isHealthy: true,
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
      },
    });
  },
  async loadLatestHealthByProvider() {
    const rows = await prisma.providerHealth.findMany({ orderBy: { checkedAt: "desc" }, take: 200 });
    const seen = new Set<string>();
    return rows.filter((h) => { if (seen.has(h.providerId)) return false; seen.add(h.providerId); return true; });
  },
  async loadPriceBook() {
    return prisma.priceBook.findMany({ where: { expiredAt: null } });
  },
  async loadProviderById(providerId) {
    return prisma.provider.findUnique({ where: { id: providerId } });
  },
};
```

### 内存版（demo / 单测）

见 [`examples/data.ts`](../examples/data.ts) — 一个完整的 in-memory `RouterStorage` 实现，含 demo 数据。

### Drizzle / Kysely / Mongo

`RouterStorage` 只是 8 个 async 函数签名。换成什么 ORM 都一样 — 你只需要满足返回值类型。

## 2. `KeyStore` — 可选，推荐接

Key 的成功 / 失败 / 熔断需要落到你的存储。实现 3 个方法：

```ts
export const keyStore = {
  async markSuccess(byokId) {
    await prisma.byokCredential.update({
      where: { id: byokId },
      data: { failureCount: 0, lastFailureAt: null, cooldownUntil: null },
    });
  },
  async markFailure(byokId, status) {
    if (status === 401 || status === 403) {
      // 凭据失效 — 立即标记不健康
      await prisma.byokCredential.update({
        where: { id: byokId },
        data: { isHealthy: false, lastFailureAt: new Date() },
      });
      return;
    }
    const cur = await prisma.byokCredential.findUnique({ where: { id: byokId } });
    if (!cur) return;
    const failureCount = cur.failureCount + 1;
    const within5 = cur.lastFailureAt && Date.now() - cur.lastFailureAt.getTime() < 5 * 60_000;
    const cooldownUntil = within5 && failureCount > 5
      ? new Date(Date.now() + 5 * 60_000)
      : cur.cooldownUntil;
    await prisma.byokCredential.update({
      where: { id: byokId },
      data: { failureCount, lastFailureAt: new Date(), cooldownUntil },
    });
  },
  async markInvalid(byokId) {
    await prisma.byokCredential.update({
      where: { id: byokId },
      data: { isHealthy: false },
    });
  },
};
```

## 3. `DecisionStore` — 推荐接

每次路由决策写入 `routeDecision` JSON：

```ts
export const decisionStore = {
  async writeRouteDecision(eventId, json) {
    await prisma.usageEvent.update({
      where: { id: eventId },
      data: { routeDecision: json },
    });
  },
};
```

## 4. `HealthStorage` — 接探针

```ts
export const healthStorage = {
  async loadActiveProviders() {
    return prisma.provider.findMany({ where: { status: "ACTIVE" } });
  },
  async loadLatestHealth(providerId) {
    return prisma.providerHealth.findFirst({
      where: { providerId }, orderBy: { checkedAt: "desc" },
    });
  },
  async loadRecentHealth(providerId, take) {
    return prisma.providerHealth.findMany({
      where: { providerId }, orderBy: { checkedAt: "desc" }, take,
    });
  },
  async saveHealth(record) {
    await prisma.providerHealth.create({ data: record });
  },
};
```

## 5. 启动探针

```ts
import { configureProbeScheduler, startProbeScheduler, evaluateHealthAlerts } from "echocode-router";

configureProbeScheduler({
  storage: healthStorage,
  async load24hUsage() { /* ... */ },
  async loadHealthSnapshots() { /* ... */ },
  alertHooks: {
    async emit(alert) {
      console.warn("[告警]", alert.level, alert.message);
      // TODO: 飞书 / 钉钉 / Slack webhook
    },
  },
});
startProbeScheduler(); // 每 60s 自动跑
```

## 6. Admin 鉴权（可选）

```ts
import { configureAdminAuth } from "echocode-router";

configureAdminAuth({
  async loadCurrentUser() {
    // 读 session cookie / JWT → 返回用户或 null
  },
  async hasVerifiedMfa(userId) {
    return prisma.mfaDevice.count({ where: { userId, verifiedAt: { not: null } } }) > 0;
  },
  async writeAuditLog(entry) {
    await prisma.auditLog.create({ data: entry });
  },
});
```

## 7. 缓存

`resolveRoute` 自带 50ms 进程内缓存（同 `orgId + modelId + ctx`）。想加更长的缓存，在你自己的 `RouterStorage` 方法上加 Redis / LRU。

## 8. 限流

```ts
import { consume } from "echocode-router";

const rl = consume(orgId, { limitPerMin: 600 });
if (!rl.allowed) {
  return new Response("请求过于频繁", { status: 429 });
}
```

进程内 token bucket。多实例部署建议换成 Redis 限流。
