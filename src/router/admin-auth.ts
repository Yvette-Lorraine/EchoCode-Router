/**
 * Admin 访问控制 — 用 hook 抽象。
 *
 * 为什么用 hook：router-core 不直接绑 Next.js / Prisma / 任何后端框架。
 * 调用方实现 loadCurrentUser / hasVerifiedMfa / writeAuditLog 三个 hook，
 * 即可在 Express / Next.js / Hono / Fastify / Lambda 中复用。
 *
 * 默认 dev bypass：`ECHO_ADMIN_BYPASS_MFA=1` 时跳过 MFA 检查。
 */

export class AdminForbiddenError extends Error {
  code: "MFA_REQUIRED" | "UNAUTHENTICATED" | "FORBIDDEN";
  constructor(code: "MFA_REQUIRED" | "UNAUTHENTICATED" | "FORBIDDEN", message: string) {
    super(message);
    this.code = code;
  }
}

export interface AdminUser {
  id: string;
  email?: string | null;
}

export interface AdminAuthHooks {
  /** 解析当前请求的已登录用户。返回 null = 未登录 */
  loadCurrentUser(): Promise<AdminUser | null>;
  /** 该用户是否至少有 1 台已验证 MFA 设备 */
  hasVerifiedMfa(userId: string): Promise<boolean>;
  /** 写一条 audit 记录。失败不应阻塞主流程 — 内置 try/catch */
  writeAuditLog(entry: {
    actorId: string | null;
    action: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
}

let hooks: AdminAuthHooks | null = null;

/** 在 app 启动时调用一次，注册依赖后端的具体实现 */
export function configureAdminAuth(h: AdminAuthHooks): void {
  hooks = h;
}

export async function requireAdmin(): Promise<AdminUser> {
  if (!hooks) {
    throw new Error(
      "admin-auth 未初始化：先调用 configureAdminAuth({ loadCurrentUser, hasVerifiedMfa, writeAuditLog })"
    );
  }
  const user = await hooks.loadCurrentUser();
  if (!user) {
    await hooks
      .writeAuditLog({ actorId: null, action: "admin.denied", payload: { reason: "UNAUTHENTICATED" } })
      .catch(() => null);
    throw new AdminForbiddenError("UNAUTHENTICATED", "not signed in");
  }
  if (process.env.ECHO_ADMIN_BYPASS_MFA === "1") return user;
  const ok = await hooks.hasVerifiedMfa(user.id);
  if (!ok) {
    await hooks
      .writeAuditLog({
        actorId: user.id,
        action: "admin.denied",
        payload: { reason: "MFA_REQUIRED" },
      })
      .catch(() => null);
    throw new AdminForbiddenError(
      "MFA_REQUIRED",
      "Admin 操作需要先启用至少 1 台 MFA 设备（ECHO_ADMIN_BYPASS_MFA=1 可在开发环境绕过）"
    );
  }
  return user;
}
