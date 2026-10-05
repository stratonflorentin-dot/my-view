import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { projectAccess } from "@/lib/tenancy";
import ProjectWorkspace from "@/components/dashboard/ProjectWorkspace";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSession();
  const { id } = await params;
  if (!user) redirect(`/login?next=/dashboard/projects/${id}`);
  const { level, project } = await projectAccess(user, id);
  if (!level) redirect("/dashboard");
  return <ProjectWorkspace me={user} projectId={project.id} access={level} />;
}
