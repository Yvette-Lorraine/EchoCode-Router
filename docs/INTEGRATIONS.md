# Integrations — how to wire EchoCode Router to your backend

This package is **0-coupling**: it doesn't know about Prisma, Drizzle, Mongo, or Next.js.
You implement 4 small storage interfaces; everything else is up to you.

## 1. `RouterStorage` — the big one

`RouterStorage` is what `resolveRoute()` calls to read everything it needs. **All methods can be implemented in <100 lines** with your DB of choice.

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
        orgId,
        status: "ACTIVE",
        revokedAt: null,
        isHealthy: true,
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
      },
    });
  },
  async loadLatestHealthByProvider() {
    // each provider → latest row
    const rows = await prisma.providerHealth.findMany({
      orderBy: { checkedAt: "desc" },
      take: 200,
    });
    const seen = new Set<string>();
    return rows.filter((h) => {
      if (seen.has(h.providerId)) return false;
      seen.add(h.providerId);
      return true;
    });
  },
  async loadPriceBook() {
    return prisma.priceBook.findMany({ where: { expiredAt: null } });
  },
  async loadProviderById(providerId) {
    return prisma.provider.findUnique({ where: { id: providerId } });
  },
};
```

## 2. `KeyStore` — for `markByokSuccess / markByokFailure / markByokInvalidate`

When cascade marks a key (success / cooldown / 401 invalidate), it asks your DB to update.
`markByokFailure` is the only one with a time / threshold decision logic:

```ts
// Pseudocode for what the call expects from your storage
export const keyStore = {
  async markSuccess(byokId) {
    await prisma.byokCredential.update({
      where: { id: byokId },
      data: { failureCount: 0, lastFailureAt: null, cooldownUntil: null },
    });
  },
  async markFailure(byokId, status) {
    // 5/5min → cooldown; status 401/403 handled by markInvalid below
    if (status === 401 || status === 403) {
      await prisma.byokCredential.update({
        where: { id: byokId },
        data: { isHealthy: false, lastFailureAt: new Date() },
      });
      return;
    }
    const cur = await prisma.byokCredential.findUnique({ where: { id: byokId } });
    if (!cur) return;
    const failureCount = cur.failureCount + 1;
    const within5 =
      cur.lastFailureAt && Date.now() - cur.lastFailureAt.getTime() < 5 * 60_000;
    const cooldownUntil = within5 && failureCount > 5 ? new Date(Date.now() + 5 * 60_000) : cur.cooldownUntil;
    await prisma.byokCredential.update({
      where: { id: byokId },
      data: { failureCount, lastFailureAt: new Date(), cooldownUntil },
    });
  },
  async markInvalid(byokId) {
    // Same as 401/403 path in markFailure, but called via markByokFailure(status=401/403) too.
  },
};
```

## 3. `DecisionStore` — for writing `routeDecision` to your DB

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

## 4. `HealthStorage` — for the probe

Same shape as `RouterStorage` but used by the probe background task:

```ts
export const healthStorage = {
  async loadActiveProviders() {
    return prisma.provider.findMany({ where: { status: "ACTIVE" } });
  },
  async loadLatestHealth(providerId) {
    return prisma.providerHealth.findFirst({
      where: { providerId },
      orderBy: { checkedAt: "desc" },
    });
  },
  async loadRecentHealth(providerId, take) {
    return prisma.providerHealth.findMany({
      where: { providerId },
      orderBy: { checkedAt: "desc" },
      take,
    });
  },
  async saveHealth(record) {
    await prisma.providerHealth.create({ data: record });
  },
};
```

## 5. `AdminAuthHooks` — if you want admin auth

```ts
import { configureAdminAuth } from "echocode-router";

configureAdminAuth({
  async loadCurrentUser() {
    // Read session cookie / JWT, return the user or null
  },
  async hasVerifiedMfa(userId) {
    return prisma.mfaDevice.count({ where: { userId, verifiedAt: { not: null } } }) > 0;
  },
  async writeAuditLog(entry) {
    await prisma.auditLog.create({ data: entry });
  },
});
```

## 6. Triggering the probe

```ts
import { probeProvider, evaluateHealthAlerts } from "echocode-router";

setInterval(async () => {
  await probeProvider({ storage: healthStorage });
  await evaluateHealthAlerts({
    async loadHealthSnapshots() {
      return prisma.providerHealth.findMany({ orderBy: { checkedAt: "desc" }, take: 200 });
    },
    async load24hUsage() {
      const since = new Date(Date.now() - 86_400_000);
      const events = await prisma.usageEvent.findMany({
        where: { startedAt: { gte: since } },
        select: { routeDecision: true },
      });
      let total = 0,
        fbCount = 0,
        sumLen = 0,
        maxLen = 0;
      for (const e of events) {
        total++;
        const d: any = e.routeDecision;
        const len = d?.fallbackChain?.length ?? 0;
        if (len > 0) fbCount++;
        sumLen += len;
        if (len > maxLen) maxLen = len;
      }
      return { total, fallbackCount: fbCount, avgFallbackLen: total ? sumLen / total : 0, maxFallbackLen: maxLen };
    },
    async emit(alert) {
      console.warn("[alert]", alert.level, alert.message);
      // TODO: 飞书 / 钉钉 / Slack webhook
    },
  });
}, 60_000);
```

## 7. Caching

`resolveRoute` caches its result for 50ms (in-process, per `orgId + modelId + ctx`).
If you need wider caching, layer a Redis / LRU around your `RouterStorage` methods.

## 8. Rate limiting

`consume(orgId, { limitPerMin })` is a pure function. Wrap your gateway entry point:

```ts
import { consume } from "echocode-router";

const rl = consume(orgId, { limitPerMin: 600 });
if (!rl.allowed) {
  return new Response("rate limited", { status: 429 });
}
```

State is process-local. For multi-instance deployments, replace with Redis-backed token bucket.

## 9. Reading the docs

- [`README.md`](./README.md) — overview, install, comparison
- [`CHANGELOG.md`](./CHANGELOG.md) — version history
- [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) — this file
- [`docs/STANDALONE-DEPLOY.md`](./docs/STANDALONE-DEPLOY.md) — full docker-compose deploy
