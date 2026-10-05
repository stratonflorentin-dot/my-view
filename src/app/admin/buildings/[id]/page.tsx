import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import MapShellLoader from "@/components/map/MapShellLoader";

export default async function BuildingReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "admin") redirect("/map");
  const { id } = await params;
  return (
    <div className="relative">
      <a
        href="/admin"
        className="absolute left-3 top-16 z-40 rounded-md bg-[var(--panel)] px-2.5 py-1.5 text-[11px] ring-1 ring-[var(--line)]"
      >
        ← Dashboard
      </a>
      <MapShellLoader visibility="invite_only" initialBuildingId={id} />
    </div>
  );
}
