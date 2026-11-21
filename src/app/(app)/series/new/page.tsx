"use client";

import { PageHeader } from "@/components/ui";
import { SeriesForm } from "../series-form";

export default function NewSeries() {
  return (
    <>
      <PageHeader title="新增品牌系列" back={{ href: "/series/", label: "品牌系列" }} />
      <SeriesForm />
    </>
  );
}
