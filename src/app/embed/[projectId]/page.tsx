import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { getSession } from "@/lib/auth";
import MapLoader from "@/components/map/MapLoader";

export const dynamic = "force-dynamic";

/**
 * Embeddable map: <iframe src="/embed/{projectId}">
 * Access: public/shared projects embed without a session; private
 * projects require the embedder to be signed in (cookie travels with the
 * iframe). No admin chrome — just the live map.
 */
export default async function EmbedPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await getSession();
  let project = null;
  try {
    const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    project = rows[0] ?? null;
  } catch {
    project = null;
  }

  const allowed =
    project &&
    (["public", "shared"].includes(project.visibility) || session);

  if (!allowed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--bg)] text-[var(--fg)]">
        <div className="mwm-panel max-w-sm p-6 text-center">
          <h1 className="font-display text-lg font-semibold">This map is private</h1>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            The map owner has not made this project embeddable. Sign in with an
            account that has access, or ask the owner to change visibility.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh w-full bg-[var(--bg)]">
      <MapLoader preview={false} />
    </div>
  );
}
