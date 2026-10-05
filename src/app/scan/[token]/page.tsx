import ContributeLoader from "@/components/ContributeLoader";

/**
 * Scan link entry point: https://YOURDOMAIN.com/scan/ABC123
 * Mobile-first, install-free — opens the guided capture flow directly.
 */
export const metadata = {
  title: "Scan — contribute to the map",
};

export default async function ScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ContributeLoader token={token.toUpperCase()} />;
}
