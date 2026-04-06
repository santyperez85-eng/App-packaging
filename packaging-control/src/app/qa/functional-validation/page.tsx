import { FunctionalValidationReport } from "@/components/qa/functional-validation-report";
import { getFunctionalValidationDiagnostics } from "@/server/validation/functional-validation-diagnostics-service";

export const dynamic = "force-dynamic";

export default async function FunctionalValidationPage() {
  const report = getFunctionalValidationDiagnostics();

  return <FunctionalValidationReport report={report} />;
}
