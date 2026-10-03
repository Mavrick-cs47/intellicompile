const express = require("express");
const cors = require("cors");
const path = require("path");

const { analyze } = require("./analyzer");
const { applyFixes } = require("./fixer");
const { executeJava } = require("./executors/javaExecutor");
const { executeCpp } = require("./executors/cppExecutor");

const app = express();
const PORT = process.env.PORT || 4000;
const MAX_CODE_LENGTH = 20000; // characters — basic abuse guard

app.use(cors());
app.use(express.json({ limit: "256kb" }));

// Serve the static frontend (single-file React+Monaco app) so the whole
// project can be run with just `npm start` and a browser.
app.use(express.static(path.join(__dirname, "..", "frontend")));

function validateRequest(req, res) {
  const { language, code } = req.body || {};
  if (!language || !["java", "cpp"].includes(language)) {
    res.status(400).json({ success: false, message: "language must be 'java' or 'cpp'." });
    return null;
  }
  if (typeof code !== "string") {
    res.status(400).json({ success: false, message: "code must be a string." });
    return null;
  }
  if (code.length > MAX_CODE_LENGTH) {
    res.status(400).json({ success: false, message: `code exceeds ${MAX_CODE_LENGTH} character limit.` });
    return null;
  }
  return { language, code };
}

app.post("/api/analyze", (req, res) => {
  const parsed = validateRequest(req, res);
  if (!parsed) return;
  const { language, code } = parsed;

  const result = analyze(code, language);
  res.json({
    success: true,
    errors: result.errors,
    hasErrors: result.hasErrors,
  });
});

app.post("/api/fix", (req, res) => {
  const parsed = validateRequest(req, res);
  if (!parsed) return;
  const { language, code } = parsed;

  const result = analyze(code, language);
  const autoFixable = result.errors.filter(e => e.autoFixable || e.appendAtEnd);
  const correctedCode = applyFixes(code, result.errors);

  res.json({
    success: true,
    errors: result.errors,
    appliedFixCount: autoFixable.length,
    correctedCode,
  });
});

app.post("/api/run", async (req, res) => {
  const parsed = validateRequest(req, res);
  if (!parsed) return;
  const { language, code } = parsed;

  // Step 1: analyze
  const analysis = analyze(code, language);

  // Step 2: if there are safe auto-fixable issues, apply them before
  // handing off to the real compiler. The compiler is always the final
  // authority — see step 3.
  const codeToCompile = analysis.hasErrors ? applyFixes(code, analysis.errors) : code;
  const wasAutoCorrected = codeToCompile !== code;

  try {
    const execResult = language === "java"
      ? await executeJava(codeToCompile)
      : await executeCpp(codeToCompile);

    res.json({
      success: execResult.success,
      stage: execResult.stage,
      analysis: analysis.errors,
      wasAutoCorrected,
      correctedCode: wasAutoCorrected ? codeToCompile : null,
      exitCode: execResult.exitCode ?? null,
      stdout: execResult.stdout || "",
      stderr: execResult.stderr || "",
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: "Internal execution error.",
      detail: String(err && err.message ? err.message : err),
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`IntelliCompile backend listening on http://localhost:${PORT}`);
});

module.exports = app;
