import { ImportWizard } from "@/components/import-wizard";
import { PageHead } from "@/components/page-head";

export default function ImportPage() {
  return (
    <>
      <PageHead
        title="Import a spreadsheet"
        description="Bring in the sheet you keep today. Nothing is saved until you have seen the preview and confirmed which column is which."
      />
      <div className="card">
        <ImportWizard />
      </div>
    </>
  );
}
