/**
 * Unit tests for analyzer.js + fixer.js.
 * Run with: node tests/test-analyzer.js
 */
const path = require("path");
const { analyze } = require(path.join(__dirname, "..", "backend", "analyzer"));
const { applyFixes } = require(path.join(__dirname, "..", "backend", "fixer"));

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${message}`);
  } else {
    failed++;
    console.log(`  \u2717 FAILED: ${message}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ---------------------------------------------------------------------
section("Java: valid code produces no errors");
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
  const result = analyze(code, "java");
  assert(result.errors.length === 0, "no false positives on valid Java");
}

// ---------------------------------------------------------------------
section("Java: missing semicolon is detected and correctly fixed");
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
  const result = analyze(code, "java");
  const missing = result.errors.filter(e => e.type === "MISSING_SEMICOLON");
  assert(missing.length === 1, "exactly one missing-semicolon error found");
  assert(missing[0] && missing[0].line === 3, "missing semicolon reported on line 3");

  const fixed = applyFixes(code, result.errors);
  assert(fixed.split("\n")[2].trim() === "int a = 10;", "fixer inserts semicolon without altering logic");
  const reanalyzed = analyze(fixed, "java");
  assert(reanalyzed.errors.length === 0, "corrected code has zero remaining errors");
}

// ---------------------------------------------------------------------
section("Java: control-flow / class headers are never flagged");
{
  const code = [
    "public class Main {",
    "    public static void main(String[] args) {",
    "        int a = 10;",
    "        if (a > 5) {",
    "            System.out.println(\"big\");",
    "        } else {",
    "            System.out.println(\"small\");",
    "        }",
    "        for (int i = 0; i < 3; i++) {",
    "            System.out.println(i);",
    "        }",
    "    }",
    "}",
  ].join("\n");
  const result = analyze(code, "java");
  assert(result.errors.length === 0, "if/else/for/class headers are not false-flagged as missing semicolons");
}

// ---------------------------------------------------------------------
section("Java: missing closing parenthesis in if-header is detected and fixed");
{
  const code = [
    "public class Main {",
    "    public static void main(String[] args) {",
    "        int x = 12;",
    "        if (x > 10 {",
    "            System.out.println(\"big\");",
    "        }",
    "    }",
    "}",
  ].join("\n");
  const result = analyze(code, "java");
  const parenErr = result.errors.find(e => e.type === "MISSING_CLOSING_PAREN");
  assert(!!parenErr, "missing closing paren before '{' is detected");
  assert(parenErr.line === 4, "reported on the correct line");

  const fixed = applyFixes(code, result.errors);
  assert(fixed.split("\n")[3].includes("if (x > 10) {"), "fixer inserts ')' without changing the condition (a > 10, not >=)");
  assert(!fixed.includes(">="), "logic operator was never altered");
}

// ---------------------------------------------------------------------
section("Java: missing closing brace at EOF is detected but NOT silently rewritten");
{
  const code = [
    "public class Main {",
    "    public static void main(String[] args) {",
    "        System.out.println(\"Hello\");",
    "    }",
  ].join("\n"); // missing final '}'
  const result = analyze(code, "java");
  const braceErr = result.errors.find(e => e.type === "MISSING_CLOSING_BRACE");
  assert(!!braceErr, "missing closing brace detected");
  assert(braceErr.appendAtEnd === "}", "suggested fix is to append '}' at EOF, not guessed mid-file");
}

// ---------------------------------------------------------------------
section("C++: valid code produces no errors");
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
  const result = analyze(code, "cpp");
  assert(result.errors.length === 0, "no false positives on valid C++");
}

// ---------------------------------------------------------------------
section("C++: missing semicolon is detected and correctly fixed");
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
  const result = analyze(code, "cpp");
  const missing = result.errors.filter(e => e.type === "MISSING_SEMICOLON");
  assert(missing.length === 1, "exactly one missing-semicolon error found");
  assert(missing[0] && missing[0].line === 5, "missing semicolon reported on line 5");

  const fixed = applyFixes(code, result.errors);
  const reanalyzed = analyze(fixed, "cpp");
  assert(reanalyzed.errors.length === 0, "corrected C++ code has zero remaining errors");
}

// ---------------------------------------------------------------------
section("C++: #include / using / preprocessor lines never flagged");
{
  const code = [
    "#include <iostream>",
    "#include <vector>",
    "using namespace std;",
    "",
    "int main() {",
    "    return 0;",
    "}",
  ].join("\n");
  const result = analyze(code, "cpp");
  assert(result.errors.length === 0, "preprocessor directives and 'using' lines are ignored");
}

// ---------------------------------------------------------------------
section("Logic is never altered: comparisons and operators pass through untouched");
{
  const code = [
    "public class Main {",
    "    public static void main(String[] args) {",
    "        int age = 20",
    "        if (age < 18) {",
    "            System.out.println(\"Minor\");",
    "        }",
    "    }",
    "}",
  ].join("\n");
  const result = analyze(code, "java");
  const fixed = applyFixes(code, result.errors);
  assert(fixed.includes("age < 18"), "logical comparison (age < 18) is preserved exactly, never 'corrected'");
}

// ---------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
