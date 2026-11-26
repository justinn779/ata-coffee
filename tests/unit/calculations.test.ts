import { describe, expect, it } from "vitest";
import { computePhases, weightLoss, freshnessOf } from "../../functions/src/domain/roasting";
import { greenCostPerG } from "../../functions/src/domain/green";
import { parseMmSs, restDays, parseTaipeiLocal, monthRangeTaipei } from "@/lib/time";
import { D, percent } from "@/lib/decimal";
import { parsePythonLiteral, withComputedRor, detectMapping, parseCsvCurve, CurveParseError } from "../../functions/src/curves/parse";

describe("烘焙計算", () => {
  it("失重率 = (投入 − 產出) ÷ 投入 × 100%", () => {
    expect(weightLoss(500, 425).toNumber()).toBe(15);
    expect(weightLoss("1000", "843.5").toString()).toBe("15.65");
  });
  it("產出大於投入或為 0 時拒絕", () => {
    expect(() => weightLoss(500, 501)).toThrow();
    expect(() => weightLoss(0, 0)).toThrow();
  });
  it("DTR 與各期時間只依實際事件計算", () => {
    const p = computePhases({ dryEndSec: 240, firstCrackStartSec: 480, dropSec: 600 });
    expect(p).toMatchObject({ totalTimeSec: 600, dryingPhaseSec: 240, maillardPhaseSec: 240, developmentPhaseSec: 120 });
    expect(p.dtrPercent!.toNumber()).toBe(20);
    const partial = computePhases({ dropSec: 600 });
    expect(partial.dtrPercent).toBeNull();
    expect(partial.developmentPhaseSec).toBeNull();
  });
  it("事件順序錯誤時不擋住，只是不計算該段", () => {
    expect(computePhases({ dryEndSec: 300, firstCrackStartSec: 200 }).maillardPhaseSec).toBeNull();
    const p = computePhases({ firstCrackStartSec: 500, dropSec: 400 });
    expect(p.developmentPhaseSec).toBeNull();
    expect(p.dtrPercent).toBeNull();
  });
  it("賞味設定：批次覆寫優先於咖啡豆預設", () => {
    const f = freshnessOf({ restStartDays: null, peakFromDays: 10, peakToDays: null, shelfLifeDays: null }, { restStartDays: 5, peakFromDays: 7, peakToDays: 30, shelfLifeDays: 180 });
    expect(f.peakFrom).toEqual({ value: 10, source: "批次覆寫" });
    expect(f.peakTo).toEqual({ value: 30, source: "咖啡豆預設" });
    expect(f.restStart?.source).toBe("咖啡豆預設");
  });
});

describe("生豆成本（精確 Decimal）", () => {
  it("每克成本 = (kg × 單價 + 運費 + 其他) ÷ 實際入庫 g", () => {
    const c = greenCostPerG({ purchasedWeightG: 10000, unitPricePerKg: 720, shippingCost: 350, otherCost: 0, receivedWeightG: 9980 });
    expect(c.total.toString()).toBe("7550");
    expect(c.perG.toString()).toBe(D(7550).div(9980).toDecimalPlaces(6).toString());
  });
  it("避免浮點誤差", () => {
    expect(D("0.1").add("0.2").toString()).toBe("0.3");
    expect(percent(1, 3, 3)!.toString()).toBe("33.333");
  });
});

describe("時間（Asia/Taipei）", () => {
  it("mm:ss 解析", () => {
    expect(parseMmSs("9:48")).toBe(588);
    expect(parseMmSs("75")).toBe(75);
    expect(parseMmSs("")).toBeNull();
    expect(() => parseMmSs("1:99")).toThrow();
  });
  it("臺北當地時間轉 UTC", () => {
    expect(parseTaipeiLocal("2026-11-21T08:30").toISOString()).toBe("2026-11-21T00:30:00.000Z");
  });
  it("烘後天數以臺北日曆日計算", () => {
    // 臺北 11/20 23:30 烘焙，11/21 00:30 杯測 → 第 1 天
    expect(restDays(new Date("2026-11-20T15:30:00Z"), new Date("2026-11-20T16:30:00Z"))).toBe(1);
    expect(restDays(new Date("2026-11-20T01:00:00Z"), new Date("2026-11-20T10:00:00Z"))).toBe(0);
  });
  it("月份範圍以臺北時區切分", () => {
    const r = monthRangeTaipei("2026-11");
    expect(r.start.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-30T16:00:00.000Z");
  });
});

describe("曲線解析", () => {
  it("Python literal 安全解析（不執行程式碼）", () => {
    expect(parsePythonLiteral("{'a': [1, 2.5, -3], 'b': (True, False, None), u'c': 'x\\'y', 'd': {}}")).toEqual({ a: [1, 2.5, -3], b: [true, false, null], c: "x'y", d: {} });
    expect(() => parsePythonLiteral("__import__('os').system('x')")).toThrow(CurveParseError);
  });
  it("RoR 由實際 BT 計算，資料不足時為 null", () => {
    const pts = [0, 10, 20, 30, 40].map((t) => ({ timeSec: t, btC: 100 + t, etC: null, rorC: null, heat: null, airflow: null, drumSpeed: null }));
    const r = withComputedRor(pts);
    expect(r[0].rorC).toBeNull();
    expect(r[4].rorC).toBe(60);
    const noBt = withComputedRor([{ ...pts[0], btC: null }]);
    expect(noBt[0].rorC).toBeNull();
  });
  it("欄位自動偵測與 °F 轉換", () => {
    expect(detectMapping(["Time", "BT", "ET", "Burner"])).toEqual({ time: "Time", bt: "BT", et: "ET", heat: "Burner" });
    const r = parseCsvCurve("time,BT\n0,392\n0:30,300\n", { time: "time", bt: "BT" }, "F");
    expect(r.points[0].btC).toBe(200);
    expect(r.points[1].timeSec).toBe(30);
  });
  it("缺少溫度欄位對應時給出具體提示", () => {
    expect(() => parseCsvCurve("time,x\n0,1\n1,2\n", { time: "time" })).toThrow(/BT 或 ET/);
  });
});
