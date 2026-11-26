"use client";

import { useState } from "react";
import { useShop } from "./_shell";
import { Price, Qty, Sheet, StateText } from "./_ui";
import type { PublicProduct } from "@/lib/shop";

/** 研磨選擇：預設原豆；選「代客研磨」才出現沖煮方式 */
export function GrindPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { settings } = useShop();
  const opts = settings?.grindOptions ?? [];
  if (!opts.length) return null;
  return (
    <div>
      <div className="flex gap-2" role="radiogroup" aria-label="研磨">
        <button type="button" role="radio" aria-checked={!value} className="s-chip flex-1" onClick={() => onChange(null)}>
          原豆
        </button>
        <button type="button" role="radio" aria-checked={!!value} className="s-chip flex-1" onClick={() => onChange(value ?? opts[0].key)}>
          免費代客研磨
        </button>
      </div>
      {value && (
        <select className="s-input mt-2" aria-label="沖煮方式" value={value} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** 快速加入購物袋：多規格必須先選規格 */
export function QuickAdd({ p, onClose }: { p: PublicProduct; onClose: () => void }) {
  const { add, toast } = useShop();
  const buyable = p.variants.filter((v) => v.state === "IN_STOCK" || v.state === "PREORDER");
  const [vid, setVid] = useState<string | null>(buyable.length === 1 ? buyable[0].id : null);
  const [grind, setGrind] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const v = p.variants.find((x) => x.id === vid) ?? null;
  return (
    <Sheet title={p.name} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="規格">
          {p.variants.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={vid === x.id} disabled={!(x.state === "IN_STOCK" || x.state === "PREORDER")} className="s-chip" onClick={() => setVid(x.id)}>
              {x.name}
            </button>
          ))}
        </div>
        {v && (
          <div className="flex items-center justify-between">
            <Price value={v.price} list={v.listPrice} className="text-lg" />
            <StateText v={v} />
          </div>
        )}
        {p.grindable && <GrindPicker value={grind} onChange={setGrind} />}
        <div className="flex items-center gap-3">
          <Qty value={qty} onChange={setQty} max={Math.max(1, v?.maxQty ?? 1)} />
          <button
            type="button"
            className="s-btn flex-1"
            disabled={!v}
            onClick={() => {
              if (!v) return;
              add({ variantId: v.id, qty, grind });
              toast("已加入購物袋");
              onClose();
            }}
          >
            {v ? (v.state === "PREORDER" ? "預購" : "加入購物袋") : "請選擇規格"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
