import ContributeLoader from "@/components/ContributeLoader";

export default async function ContributePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ContributeLoader token={token.toUpperCase()} />;
}
