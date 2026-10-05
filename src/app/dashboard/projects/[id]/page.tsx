import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { projectAccess } from "@/lib/tenancy";
import ProjectWorkspace from "@/components/dashboard/ProjectWorkspace";

export const dynamic = "force-dynamic";

const TABS = [
  "overview",
  "links",
  "submissions",
  "objects",
  "developers",
  "webhooks",
  "embed",
] as const;

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await getSession();
  const { id } = await params;
  const { tab } = await searchParams;
  if (!user) redirect(`/login?next=/dashboard/projects/${id}`);
  const { level, project } = await projectAccess(user, id);
  if (!level || !project) redirect("/dashboard");
  const initialTab = TABS.includes((tab ?? "") as (typeof TABS)[number])
    ? (tab as (typeof TABS)[number])
    : undefined;
  return (
    <ProjectWorkspace
      me={user}
      projectId={project.id}
      access={level}
      initialTab={initialTab}
    />
  );
}
