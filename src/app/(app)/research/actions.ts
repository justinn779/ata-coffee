"use server";

import { z } from "zod";
import { withTx } from "@/lib/db";
import { bool, optDate, optId, optStr, reqDate, reqId, reqStr } from "@/lib/zod";
import { action } from "@/server/action";
import { audit } from "@/server/domain/audit";
import { nextNumber } from "@/server/domain/sequence";

const projectSchema = z.object({
  id: optId(),
  name: reqStr("專案名稱"),
  hypothesis: optStr(),
  objective: optStr(),
  controlledVariables: optStr(),
  independentVariables: optStr(),
  status: z.enum(["PLANNING", "RUNNING", "CONCLUDED", "ARCHIVED"]).default("PLANNING"),
  startDate: optDate(),
  result: optStr(),
  conclusion: optStr(),
  nextSteps: optStr(),
});

export const saveProject = action(projectSchema, async ({ id, ...data }, actor) => {
  const p = await withTx(async (tx) => {
    const p = id ? await tx.researchProject.update({ where: { id }, data }) : await tx.researchProject.create({ data: { ...data, code: await nextNumber(tx, "RP", { daily: false }) } });
    await audit(tx, actor, id ? "research.update" : "research.create", "ResearchProject", p.id, p.name);
    return p;
  });
  return { id: p.id, redirect: `/research/${p.id}` };
}, { revalidate: ["/research"] });

export const addExperiment = action(
  z.object({
    projectId: reqId("專案"),
    label: reqStr("實驗名稱"),
    experimentDate: reqDate("實驗日期"),
    isBaseline: bool(),
    variableValues: optStr(),
    observation: optStr(),
    roastBatchId: optId(),
    cuppingSessionIds: optStr(2000),
    brewSessionIds: optStr(2000),
  }),
  async (i, actor) => {
    await withTx(async (tx) => {
      const last = await tx.researchExperiment.findFirst({ where: { projectId: i.projectId }, orderBy: { version: "desc" } });
      if (i.isBaseline) await tx.researchExperiment.updateMany({ where: { projectId: i.projectId }, data: { isBaseline: false } });
      const vars = Object.fromEntries((i.variableValues ?? "").split(/\n|；|;/).map((l) => l.split(/[:：=]/).map((x) => x.trim())).filter((kv) => kv.length === 2 && kv[0]));
      const ids = (s: string | null) => (s ?? "").split(/[\s,，]+/).filter((x) => /^[0-9a-f-]{36}$/.test(x));
      const e = await tx.researchExperiment.create({
        data: {
          projectId: i.projectId,
          version: (last?.version ?? 0) + 1,
          label: i.label,
          experimentDate: i.experimentDate,
          isBaseline: i.isBaseline,
          variableValues: vars,
          observation: i.observation,
          links: {
            create: [
              ...(i.roastBatchId ? [{ roastBatchId: i.roastBatchId }] : []),
              ...ids(i.cuppingSessionIds).map((cuppingSessionId) => ({ cuppingSessionId })),
              ...ids(i.brewSessionIds).map((brewSessionId) => ({ brewSessionId })),
            ],
          },
        },
      });
      await audit(tx, actor, "research.experiment", "ResearchExperiment", e.id, `新增實驗 v${e.version} ${e.label}`);
    });
    return { ok: true as const, message: "已新增實驗版本" };
  },
  { revalidate: ["/research"] },
);

export const setBaseline = action(z.object({ id: reqId("實驗") }), async ({ id }, actor) => {
  await withTx(async (tx) => {
    const e = await tx.researchExperiment.findUniqueOrThrow({ where: { id } });
    await tx.researchExperiment.updateMany({ where: { projectId: e.projectId }, data: { isBaseline: false } });
    await tx.researchExperiment.update({ where: { id }, data: { isBaseline: true } });
    await audit(tx, actor, "research.baseline", "ResearchExperiment", id, "設為基準組");
  });
}, { revalidate: ["/research"] });
