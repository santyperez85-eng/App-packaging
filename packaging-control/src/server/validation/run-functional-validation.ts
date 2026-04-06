import { getFunctionalValidationDiagnostics } from "@/server/validation/functional-validation-diagnostics-service";

function main() {
  const report = getFunctionalValidationDiagnostics();

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Functional validation scenarios");
  console.log("==============================");

  for (const scenario of report.scenarios) {
    console.log(
      `${scenario.passed ? "EXPECTED_BEHAVIOR" : "UNEXPECTED_BEHAVIOR"} ${scenario.id} :: ${scenario.title} :: health ${scenario.project.healthScore}`
    );

    for (const detail of scenario.details) {
      console.log(`  - ${detail}`);
    }
  }

  console.log("==============================");
  console.log(`${report.passedScenarios}/${report.totalScenarios} scenarios in expected behavior`);

  if (report.failedScenarios > 0) {
    process.exitCode = 1;
  }
}

main();
