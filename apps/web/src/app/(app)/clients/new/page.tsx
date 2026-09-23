import { ClientForm } from "@/components/client-form";
import { PageHead } from "@/components/page-head";
import { createClientAction } from "@/lib/actions/clients";

export default function NewClientPage() {
  return (
    <>
      <PageHead title="Add a client" breadcrumb={[{ href: "/clients", label: "Clients" }]} />
      <div className="card">
        <ClientForm action={createClientAction} submitLabel="Create client" />
      </div>
    </>
  );
}
