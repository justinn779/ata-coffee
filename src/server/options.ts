import "server-only";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { D } from "@/lib/decimal";

/** 表單選項（僅供伺服器元件使用，不可放在 "use server" 檔案以免成為公開端點） */
export async function coffeeOptions() {
  const cs = await prisma.coffee.findMany({ where: { archivedAt: null }, orderBy: { code: "asc" } });
  return cs.map((c) => ({ value: c.id, label: `${c.code}｜${c.nameZh}` }));
}

export async function greenLotOptions() {
  const lots = await prisma.inventoryLot.findMany({
    where: { item: { kind: "GREEN" }, onHand: { gt: 0 } },
    include: { greenLot: { include: { coffee: true } } },
    orderBy: { createdAt: "desc" },
  });
  return lots
    .filter((l) => l.greenLot)
    .map((l) => ({ value: l.greenLot!.id, label: `${l.lotCode}｜${l.greenLot!.coffee.nameZh}（可用 ${D(l.onHand).sub(l.reserved).toFixed(0)}g）` }));
}

export async function roastBatchOptions(limit = 200) {
  const rbs = await prisma.roastBatch.findMany({ orderBy: { roastedAt: "desc" }, take: limit, include: { greenLot: { include: { coffee: true } } } });
  return rbs.map((r) => ({ value: r.id, label: `${r.batchNo}｜${r.greenLot.coffee.nameZh}（${fmtDate(r.roastedAt)}）` }));
}

export async function roastedLotOptions() {
  const lots = await prisma.inventoryLot.findMany({
    where: { item: { kind: "ROASTED" }, status: "AVAILABLE", onHand: { gt: 0 } },
    include: { item: { include: { coffee: true } }, roastBatch: true },
    orderBy: { createdAt: "desc" },
  });
  return lots.map((l) => ({
    value: l.id,
    label: `${l.lotCode}｜${l.item.coffee?.nameZh ?? l.item.name}（可用 ${D(l.onHand).sub(l.reserved).toFixed(1)}g）`,
  }));
}

export async function equipmentOptions(type: "GRINDER" | "DRIPPER" | "FILTER") {
  const eq = await prisma.equipment.findMany({ where: { type, isActive: true }, orderBy: { name: "asc" } });
  return eq.map((e) => ({ value: e.id, label: e.name }));
}

export async function variantOptions(opts?: { includeBundles?: boolean; activeOnly?: boolean }) {
  const vs = await prisma.productVariant.findMany({
    where: { status: { not: "ARCHIVED" }, ...(opts?.includeBundles === false ? { isBundle: false } : {}), product: opts?.activeOnly ? { status: "ACTIVE" } : { status: { not: "ARCHIVED" } } },
    include: { product: true },
    orderBy: { sku: "asc" },
  });
  return vs.map((v) => ({ value: v.id, label: `${v.sku}｜${v.product.name} ${v.name}（NT$${D(v.salePrice).toFixed(0)}）` }));
}
