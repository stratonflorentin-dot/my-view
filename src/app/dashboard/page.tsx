import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ProjectsDashboard from "@/components/dashboard/ProjectsDashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/dashboard");
  return <ProjectsDashboard me={user} />;
}
