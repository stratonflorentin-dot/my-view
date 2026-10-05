import { redirect } from "next/navigation";
import MapShellLoader from "@/components/map/MapShellLoader";
import { getSettings } from "@/lib/config";
import { getSession } from "@/lib/auth";

export default async function MapPage() {
  const settings = await getSettings();
  const session = await getSession();
  if (settings.map_visibility === "private" && !session) {
    redirect("/login?next=/map");
  }
  return <MapShellLoader visibility={settings.map_visibility} />;
}
