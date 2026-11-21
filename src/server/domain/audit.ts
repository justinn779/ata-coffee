import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

export interface Actor {
  userId: string | null;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { userId: null };

export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId: string | null,
  summary?: string,
  data?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: { actorId: actor.userId, ip: actor.ip ?? null, action, entityType, entityId, summary, data },
  });
}
