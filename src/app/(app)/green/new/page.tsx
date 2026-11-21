import { prisma } from "@/lib/db";
import { nowTaipeiLocal, todayTaipei } from "@/lib/time";
import { EntityForm } from "@/components/entity-form";
import { Notice, PageHeader } from "@/components/ui";
import { receiveGreen } from "../../coffees/actions";
import { coffeeOptions } from "@/server/options";

export const metadata = { title: "新增生豆採購" };

export default async function NewGreenPage({ searchParams }: { searchParams: Promise<{ coffee?: string }> }) {
  const { coffee } = await searchParams;
  const [coffees, suppliers, locations] = await Promise.all([
    coffeeOptions(),
    prisma.supplier.findMany({ where: { isActive: true } }),
    prisma.inventoryLocation.findMany(),
  ]);
  return (
    <>
      <PageHeader title="新增生豆採購" description="入庫時建立生豆批次與入庫帳；每克成本 = (採購重量 × 每公斤單價 + 運費 + 其他) ÷ 實際入庫重量" back={{ href: "/green", label: "生豆採購批次" }} />
      {coffees.length === 0 ? (
        <Notice tone="warning">請先建立咖啡豆主檔。</Notice>
      ) : (
        <EntityForm
          draftKey="green-new"
          submitLabel="入庫"
          successMessage="生豆已入庫"
          sections={[
            { key: "a", title: "採購資訊" },
            { key: "b", title: "數量與成本" },
            { key: "c", title: "品質與儲存" },
          ]}
          defaultValues={{ coffeeId: coffee ?? "", purchaseDate: todayTaipei(), receivedAt: nowTaipeiLocal(), shippingCost: "0", otherCost: "0" }}
          fields={[
            { name: "coffeeId", label: "咖啡豆", type: "select", required: true, options: coffees, section: "a" },
            { name: "supplierId", label: "供應商", type: "select", options: suppliers.map((s) => ({ value: s.id, label: s.name })), section: "a" },
            { name: "purchaseDate", label: "採購日期", type: "date", required: true, section: "a" },
            { name: "receivedAt", label: "入庫時間", type: "datetime", required: true, section: "a" },
            { name: "invoiceNo", label: "發票／單據號碼", section: "a" },
            { name: "lotCode", label: "批次編號", hint: "留空則自動產生（GB-日期-序號）", section: "a" },
            { name: "purchasedWeightG", label: "採購數量", type: "number", unit: "g", required: true, section: "b" },
            { name: "receivedWeightG", label: "實際入庫數量", type: "number", unit: "g", required: true, hint: "實際秤重，作為庫存與成本分母", section: "b" },
            { name: "unitPricePerKg", label: "單價（每公斤）", type: "number", unit: "TWD", required: true, section: "b" },
            { name: "shippingCost", label: "運費", type: "number", unit: "TWD", section: "b" },
            { name: "otherCost", label: "其他採購費用", type: "number", unit: "TWD", section: "b" },
            { name: "moisturePercent", label: "含水率", type: "number", unit: "%", section: "c" },
            { name: "densityGPerL", label: "密度", type: "number", unit: "g/L", section: "c" },
            { name: "waterActivity", label: "水活性（選填）", type: "number", unit: "aw", section: "c" },
            { name: "locationId", label: "儲存位置", type: "select", options: locations.map((l) => ({ value: l.id, label: l.name })), section: "c" },
            { name: "note", label: "備註", type: "textarea", wide: true, section: "c" },
          ]}
          action={receiveGreen}
        />
      )}
    </>
  );
}
