import { PageHeader } from "@/components/ui";
import { ProjectForm } from "../project-form";

export const metadata = { title: "新增研究專案" };

export default function NewResearch() {
  return (
    <>
      <PageHeader title="新增研究專案" back={{ href: "/research", label: "研究專案" }} />
      <ProjectForm />
    </>
  );
}
