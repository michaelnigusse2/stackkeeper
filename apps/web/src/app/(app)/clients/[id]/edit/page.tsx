import { notFound } from "next/navigation";
import { getClient } from "@stackkeeper/db";
import { ClientForm } from "@/components/client-form";
import { PageHead } from "@/components/page-head";
import { updateClientAction } from "@/lib/actions/clients";
import { withPrincipal } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await withPrincipal((tx) => getClient(tx, id));
  if (!client) notFound();

  // Bound on the server, so the browser never names which record it edits.
  const action = updateClientAction.bind(null, client.id);

  return (
    <>
      <PageHead
        title={`Edit ${client.name}`}
        breadcrumb={[
          { href: "/clients", label: "Clients" },
          { href: `/clients/${client.id}`, label: client.name },
        ]}
      />
      <div className="card">
        <ClientForm action={action} client={client} submitLabel="Save changes" />
      </div>
    </>
  );
}
