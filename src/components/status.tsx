import { Badge, type Tone } from "./ui";

export function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value: string }) {
  const [label, tone] = map[value] ?? [value, "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}
