"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTx } from "@/lib/db";
import { DomainError, errorMessage } from "@/lib/errors";
import { bool, optDec, optId, optStr, reqDec, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { generateApiKey, hashPassword, requireActor } from "@/server/auth";
import { audit } from "@/server/domain/audit";
import { saveSetting } from "@/server/domain/settings";
import { putObject, validateUpload } from "@/server/storage";

const R = { revalidate: ["/settings"] };

export const updateAccount = action(
  z.object({ name: reqStr("名稱", 100), currentPassword: optStr(200), newPassword: optStr(200) }),
  async (i, actor) => {
    await withTx(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: actor.userId! } });
      const data: { name: string; passwordHash?: string } = { name: i.name };
      if (i.newPassword) {
        if (i.newPassword.length < 12) throw new DomainError("新密碼至少 12 個字元");
        if (!i.currentPassword || !(await bcrypt.compare(i.currentPassword, u.passwordHash))) throw new DomainError("目前密碼不正確");
        data.passwordHash = await hashPassword(i.newPassword);
        await tx.session.deleteMany({ where: { userId: u.id } }); // 變更密碼後其他 Session 失效
      }
      await tx.user.update({ where: { id: u.id }, data });
      await audit(tx, actor, "user.update", "User", u.id, i.newPassword ? "更新帳號並變更密碼" : "更新帳號");
    });
    return { ok: true as const, message: i.newPassword ? "已更新，請重新登入" : "已更新" };
  },
  R,
);

export const saveRoaster = action(
  z.object({ id: optId(), name: reqStr("名稱"), brand: reqStr("品牌"), model: reqStr("型號"), maxCapacityG: optDec("最大容量", { min: 0 }), tempChannels: optStr(200), heatControl: optStr(200), airflowControl: optStr(200), drumSpeedControl: optStr(200), sensorNote: optStr(500), note: optStr() }),
  async ({ id, tempChannels, sensorNote, ...d }, actor) => {
    const data = { ...d, tempChannels: (tempChannels ?? "").split(/[,，\s]+/).filter(Boolean), sensorConfig: sensorNote ? { note: sensorNote } : undefined };
    await withTx(async (tx) => {
      const r = id ? await tx.roasterProfile.update({ where: { id }, data }) : await tx.roasterProfile.create({ data });
      await audit(tx, actor, "roaster.save", "RoasterProfile", r.id, r.name);
    });
    return { ok: true as const, message: "已儲存烘豆機" };
  },
  R,
);

export const saveSupplier = action(
  z.object({ id: optId(), code: reqStr("代碼", 40), name: reqStr("名稱"), contact: optStr(100), phone: optStr(50), email: optStr(200), country: optStr(100), note: optStr() }),
  async ({ id, ...data }, actor) => {
    await withTx(async (tx) => {
      const s = id ? await tx.supplier.update({ where: { id }, data }) : await tx.supplier.create({ data });
      await audit(tx, actor, "supplier.save", "Supplier", s.id, s.name);
    });
    return { ok: true as const, message: "已儲存供應商" };
  },
  R,
);

export const saveEquipment = action(
  z.object({ id: optId(), type: z.enum(["GRINDER", "DRIPPER", "FILTER", "KETTLE", "SCALE", "OTHER"]), name: reqStr("名稱"), brand: optStr(100), model: optStr(100), note: optStr() }),
  async ({ id, ...data }, actor) => {
    await withTx(async (tx) => {
      const e = id ? await tx.equipment.update({ where: { id }, data }) : await tx.equipment.create({ data });
      await audit(tx, actor, "equipment.save", "Equipment", e.id, e.name);
    });
    return { ok: true as const, message: "已儲存器材" };
  },
  R,
);

export const saveFlavorTag = action(z.object({ id: optId(), name: reqStr("詞彙", 50), category: optStr(50) }), async ({ id, ...data }, actor) => {
  await withTx(async (tx) => {
    const t = id ? await tx.flavorTag.update({ where: { id }, data }) : await tx.flavorTag.create({ data });
    await audit(tx, actor, "flavor.save", "FlavorTag", t.id, t.name);
  });
  return { ok: true as const, message: "已儲存風味詞彙" };
}, R);

export const saveTemplate = action(
  z.object({ name: reqStr("模板名稱"), description: optStr(), scaleMin: reqDec("最低分", { min: 0 }), scaleMax: reqDec("最高分", { positive: true }), step: reqDec("間距", { positive: true }), attributes: reqStr("評分項目", 2000), isDefault: bool() }),
  async (i, actor) => {
    const attrs = i.attributes
      .split("\n")
      .map((l) => l.split(/[:：]/).map((x) => x.trim()))
      .filter((p) => p[0])
      .map(([key, label]) => ({ key: key.replace(/[^a-zA-Z0-9_]/g, "") || "attr", label: label || key }));
    if (new Set(attrs.map((a) => a.key)).size !== attrs.length || attrs.some((a) => a.key === "attr")) throw new DomainError("評分項目代碼需為英數字且不可重複（格式：代碼:名稱）");
    await withTx(async (tx) => {
      if (i.isDefault) await tx.cuppingTemplate.updateMany({ data: { isDefault: false } });
      const t = await tx.cuppingTemplate.create({ data: { ...i, attributes: attrs } });
      await audit(tx, actor, "template.create", "CuppingTemplate", t.id, t.name);
    });
    return { ok: true as const, message: "已建立評分模板" };
  },
  R,
);

export const saveMaterial = action(
  z.object({ id: optId(), code: reqStr("代碼", 40), name: reqStr("名稱"), category: z.enum(["BAG", "LABEL", "DRIP_BAG", "BOX", "SEAL", "OTHER"]), spec: optStr(200), note: optStr() }),
  async ({ id, ...data }, actor) => {
    await withTx(async (tx) => {
      const m = id ? await tx.material.update({ where: { id }, data }) : await tx.material.create({ data });
      await audit(tx, actor, "material.save", "Material", m.id, m.name);
    });
    return { ok: true as const, message: "已儲存包材" };
  },
  R,
);

export const saveLocation = action(z.object({ id: optId(), code: reqStr("代碼", 40), name: reqStr("名稱"), note: optStr() }), async ({ id, ...data }, actor) => {
  await withTx(async (tx) => {
    const l = id ? await tx.inventoryLocation.update({ where: { id }, data }) : await tx.inventoryLocation.create({ data });
    await audit(tx, actor, "location.save", "InventoryLocation", l.id, l.name);
  });
  return { ok: true as const, message: "已儲存儲位" };
}, R);

export const saveDefaults = action(
  z.object({
    taxMode: z.enum(["INCLUSIVE", "EXCLUSIVE", "NONE"]),
    taxRate: reqDec("稅率", { min: 0 }),
    requirePaymentBeforeShip: z.enum(["true", "false"]),
    lowGreenG: reqDec("生豆預警", { min: 0 }),
    lowRoastedG: reqDec("熟豆預警", { min: 0 }),
    lowFinishedPcs: reqDec("成品預警", { min: 0 }),
    expiryWarnDays: reqDec("到期提醒天數", { min: 0 }),
  }),
  async (i, actor) => {
    if (Number(i.taxRate) >= 1) throw new DomainError("稅率請以小數表示，例如 5% 填 0.05");
    await withTx(async (tx) => {
      await saveSetting(tx, "tax", { mode: i.taxMode, rate: i.taxRate });
      await saveSetting(tx, "order", { requirePaymentBeforeShip: i.requirePaymentBeforeShip === "true" });
      await saveSetting(tx, "inventory", { lowGreenG: Number(i.lowGreenG), lowRoastedG: Number(i.lowRoastedG), lowFinishedPcs: Number(i.lowFinishedPcs), expiryWarnDays: Number(i.expiryWarnDays) });
      await audit(tx, actor, "settings.update", "SystemSetting", null, "更新系統預設值", i);
    });
    return { ok: true as const, message: "已更新系統預設值（僅影響新交易）" };
  },
  R,
);

export const createApiKey = action(z.object({ name: reqStr("名稱", 100) }), async ({ name }, actor) => {
  const k = generateApiKey();
  await withTx(async (tx) => {
    const r = await tx.apiKey.create({ data: { name, prefix: k.prefix, keyHash: k.hash, scopes: ["orders:create", "products:read"] } });
    await audit(tx, actor, "apikey.create", "ApiKey", r.id, `建立 API 金鑰 ${name}（${k.prefix}…）`);
  });
  return { ok: true as const, message: `API 金鑰（只會顯示這一次，請立即存入官網伺服器環境變數）：\n${k.full}` };
}, R);

export const revokeApiKey = action(z.object({ id: z.string().uuid() }), async ({ id }, actor) => {
  await withTx(async (tx) => {
    await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, actor, "apikey.revoke", "ApiKey", id, "撤銷 API 金鑰");
  });
  return { ok: true as const, message: "已撤銷" };
}, R);

export async function uploadBrandAsset(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const actor = await requireActor();
    const file = fd.get("file");
    if (!(file instanceof File)) return { ok: false, error: "請選擇圖片" };
    const kind = z.enum(["LOGO", "MASCOT_ATI", "MASCOT_ATO", "PACKAGING", "OTHER"]).parse(fd.get("kind"));
    const buf = await validateUpload(file, "image");
    const key = await putObject(buf, "brand", file.name);
    await withTx(async (tx) => {
      const a = await tx.brandAsset.create({ data: { kind, name: String(fd.get("name") || file.name).slice(0, 100), storageKey: key, mimeType: file.type, isOfficial: fd.get("isOfficial") === "on", note: String(fd.get("note") ?? "").slice(0, 500) || null } });
      await audit(tx, actor, "brand.upload", "BrandAsset", a.id, `上傳品牌素材 ${a.name}`);
    });
    revalidatePath("/settings/brand");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

