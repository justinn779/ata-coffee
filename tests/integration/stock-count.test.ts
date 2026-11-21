/** 整批盤點（於 Firestore 模擬器執行）：差異入帳、冪等、盤點期間異動與保留量保護 */
import { beforeEach, describe, expect, it } from "vitest";
import { C } from "../../functions/src/types";
import { baseFixture, docs, expectReconciled, lotOf, n, op, order, packageUnits, receiveGreen, resetDb, roast } from "../helpers";

beforeEach(async () => {
  await resetDb();
});

async function setup() {
  const f = await baseFixture();
  const g = await receiveGreen(f.coffee.id, 5000);
  const r = await roast(g.id, f.roaster.id, 500, 425);
  return { f, g, r };
}

describe("整批盤點", () => {
  it("多批一次送出：只有差異的批次產生盤點調整，帳本一致", async () => {
    const { g, r } = await setup();
    const res = await op<{ id: string; message: string }>("inventory.count", {
      countId: "c-1",
      note: "月底盤點",
      lines: [
        { lotId: g.lotId, expected: "4500", counted: "4480.5" },
        { lotId: r.roastedLotId, expected: "425", counted: "425" },
      ],
    });
    expect(res.message).toMatch(/1 批有差異/);
    expect(n((await lotOf(g.lotId)).onHand)).toBe(4480.5);
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425);
    const adj = (await docs(C.txs, "lotId", g.lotId)).filter((t) => t.type === "ADJUSTMENT");
    expect(adj).toHaveLength(1);
    expect(n(adj[0].quantity)).toBe(-19.5);
    const sc = (await docs(C.stockCounts))[0];
    expect(sc).toMatchObject({ lineCount: 2, changedCount: 1, note: "月底盤點" });
    expect(String(sc.code)).toMatch(/^SC-\d{8}-001$/);
    await expectReconciled();
  });

  it("相同 countId 重送不會重複調整", async () => {
    const { g } = await setup();
    const body = { countId: "c-dup", lines: [{ lotId: g.lotId, expected: "4500", counted: "4400" }] };
    await op("inventory.count", body);
    const again = await op<{ duplicate: boolean }>("inventory.count", body);
    expect(again.duplicate).toBe(true);
    expect(n((await lotOf(g.lotId)).onHand)).toBe(4400);
    expect(await docs(C.stockCounts)).toHaveLength(1);
    await expectReconciled();
  });

  it("盤點期間帳面有異動時整批拒絕（任何批次都不調整）", async () => {
    const { g, r } = await setup();
    await expect(
      op("inventory.count", {
        countId: "c-stale",
        lines: [
          { lotId: r.roastedLotId, expected: "425", counted: "420" },
          { lotId: g.lotId, expected: "5000", counted: "4000" },
        ],
      }),
    ).rejects.toThrow(/盤點期間有異動/);
    expect(n((await lotOf(r.roastedLotId)).onHand)).toBe(425);
    expect(await docs(C.stockCounts)).toHaveLength(0);
    await expectReconciled();
  });

  it("實盤少於已保留量時拒絕；件數需為整數", async () => {
    const { f, r } = await setup();
    const pk = await packageUnits(r.roastedLotId, f.v100.id, 4);
    await order(f.v100.id, 3);
    await expect(op("inventory.count", { countId: "c-resv", lines: [{ lotId: pk.lotId, expected: "4", counted: "2" }] })).rejects.toThrow(/少於已保留/);
    await expect(op("inventory.count", { countId: "c-int", lines: [{ lotId: pk.lotId, expected: "4", counted: "3.5" }] })).rejects.toThrow(/整數/);
    await op("inventory.count", { countId: "c-ok", lines: [{ lotId: pk.lotId, expected: "4", counted: "3" }] });
    expect(n((await lotOf(pk.lotId)).onHand)).toBe(3);
    await expectReconciled();
  });
});
