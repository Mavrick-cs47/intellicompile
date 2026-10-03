/**
 * End-to-end tests against a RUNNING server (npm start in backend/ first).
 * Exercises real javac / g++ compilation and execution, not mocks.
 *
 * Run with: node tests/test-e2e.js   (server must be running on :4000)
 */
const BASE = process.env.INTELLICOMPILE_URL || "http://localhost:4000";

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
  else { failed++; console.log(`  \u2717 FAILED: ${msg}`); }
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function main() {
  console.log(`Testing against ${BASE}\n`);

  // -----------------------------------------------------------------
  console.log("Test case 1: Java valid code -> compiles and runs, output 30");
  {
    const code = [
      "public class Main {",
      "    public static void main(String[] args) {",
      "        int a = 10;",
      "        int b = 20;",
      "        System.out.println(a + b);",
      "    }",
      "}",
    ].join("\n");
    const { json } = await post("/api/run", { language: "java", code });
    assert(json.success === true, "run succeeded");
    assert(json.stdout.trim() === "30", `stdout is "30" (got "${json.stdout.trim()}")`);
    assert(json.wasAutoCorrected === false, "no auto-correction needed for valid code");
  }

  // -----------------------------------------------------------------
  console.log("\nTest case 2: Java missing semicolon -> detected, auto-fixed, runs, output 30");
  {
    const code = [
      "public class Main {",
      "    public static void main(String[] args) {",
      "        int a = 10",
      "        int b = 20;",
      "        System.out.println(a + b);",
      "    }",
      "}",
    ].join("\n");
    const { json: analysis } = await post("/api/analyze", { language: "java", code });
    assert(analysis.hasErrors === true, "analyzer flags the missing semicolon");
    assert(
      analysis.errors.some(e => e.type === "MISSING_SEMICOLON" && e.line === 3),
      "missing semicolon reported on line 3"
    );

    const { json: runResult } = await post("/api/run", { language: "java", code });
    assert(runResult.wasAutoCorrected === true, "code was auto-corrected before compiling");
    assert(runResult.success === true, "corrected code compiled and ran successfully");
    assert(runResult.stdout.trim() === "30", `stdout is "30" after auto-fix (got "${runResult.stdout.trim()}")`);
  }

  // -----------------------------------------------------------------
  console.log("\nTest case 3: C++ missing semicolon -> detected, auto-fixed, runs, output 10");
  {
    const code = [
      "#include <iostream>",
      "using namespace std;",
      "",
      "int main() {",
      "    int a = 10",
      "    cout << a << endl;",
      "    return 0;",
      "}",
    ].join("\n");
    const { json: runResult } = await post("/api/run", { language: "cpp", code });
    assert(runResult.wasAutoCorrected === true, "C++ code was auto-corrected");
    assert(runResult.success === true, "corrected C++ code compiled and ran");
    assert(runResult.stdout.trim() === "10", `stdout is "10" (got "${runResult.stdout.trim()}")`);
  }

  // -----------------------------------------------------------------
  console.log("\nTest case 4: C++ valid code -> compiles and runs directly");
  {
    const code = [
      "#include <iostream>",
      "using namespace std;",
      "",
      "int main() {",
      "    int a = 10;",
      "    int b = 20;",
      "    cout << a + b << endl;",
      "    return 0;",
      "}",
    ].join("\n");
    const { json } = await post("/api/run", { language: "cpp", code });
    assert(json.success === true, "run succeeded");
    assert(json.stdout.trim() === "30", `stdout is "30" (got "${json.stdout.trim()}")`);
  }

  // -----------------------------------------------------------------
  console.log("\nTest case 5: logic error is never auto-corrected (system does not overpromise)");
  {
    // Valid syntax, intentionally suspect logic — analyzer must stay silent
    // (a full logic-fixer is explicitly out of scope for this project).
    const code = [
      "public class Main {",
      "    public static void main(String[] args) {",
      "        int age = 20;",
      "        if (age < 18) {",
      "            System.out.println(\"Adult\");",
      "        }",
      "    }",
      "}",
    ].join("\n");
    const { json: analysis } = await post("/api/analyze", { language: "java", code });
    assert(analysis.errors.length === 0, "no syntax errors flagged for syntactically valid (if logically odd) code");
    const { json: runResult } = await post("/api/run", { language: "java", code });
    assert(runResult.wasAutoCorrected === false, "logic was never touched");
    assert(runResult.stdout.trim() === "", "prints nothing, exactly as the (odd but valid) logic dictates");
  }

  // -----------------------------------------------------------------
  console.log("\nTest case 6: genuine compiler error surfaces real compiler output (fallback)");
  {
    // Not a pattern our heuristics claim to fix -> must fall through to javac
    // and report the real compiler error rather than pretending to fix it.
    const code = [
      "public class Main {",
      "    public static void main(String[] args) {",
      "        int a = ;",
      "    }",
      "}",
    ].join("\n");
    const { json: runResult } = await post("/api/run", { language: "java", code });
    assert(runResult.success === false, "unrecoverable syntax error correctly fails");
    assert(runResult.stage === "compile", "fails at the compile stage");
    assert(runResult.stderr.length > 0, "real javac error message is surfaced, not hidden");
  }

  // -----------------------------------------------------------------
  console.log("\nTest case 7: /api/fix returns corrected code without executing it");
  {
    const code = "public class Main {\n    public static void main(String[] args) {\n        int a = 10\n        System.out.println(a);\n    }\n}";
    const { json } = await post("/api/fix", { language: "java", code });
    assert(json.success === true, "fix endpoint responds");
    assert(json.correctedCode.includes("int a = 10;"), "corrected code contains the fixed line");
    assert(json.appliedFixCount === 1, "reports exactly one applied fix");
  }

  // -----------------------------------------------------------------
  console.log("\nTest case 8: input validation rejects bad requests");
  {
    const { status } = await post("/api/run", { language: "python", code: "print(1)" });
    assert(status === 400, "unsupported language is rejected with 400");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
