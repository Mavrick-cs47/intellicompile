const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const COMPILE_TIMEOUT_MS = 10000;
const RUN_TIMEOUT_MS = 5000;
const MAX_OUTPUT_CHARS = 20000;

function run(cmd, args, options) {
  return new Promise((resolve) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        killed: !!(error && error.killed),
        timedOut: !!(error && error.killed && error.signal === "SIGTERM"),
        stdout: (stdout || "").slice(0, MAX_OUTPUT_CHARS),
        stderr: (stderr || "").slice(0, MAX_OUTPUT_CHARS),
      });
    });
  });
}

async function executeCpp(code) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "intellicompile-cpp-"));
  const sourceFile = path.join(workDir, "main.cpp");
  const binaryFile = path.join(workDir, "main.out");

  try {
    fs.writeFileSync(sourceFile, code, "utf8");

    const compile = await run(
      "g++",
      ["-std=c++17", "-O0", "-o", binaryFile, sourceFile],
      { cwd: workDir, timeout: COMPILE_TIMEOUT_MS }
    );

    if (compile.code !== 0) {
      return {
        stage: "compile",
        success: false,
        stdout: "",
        stderr: compile.timedOut
          ? "Compilation timed out."
          : compile.stderr || "Compilation failed.",
      };
    }

    const runResult = await run(binaryFile, [], {
      cwd: workDir,
      timeout: RUN_TIMEOUT_MS,
    });

    return {
      stage: "run",
      success: runResult.code === 0,
      exitCode: runResult.code,
      stdout: runResult.stdout,
      stderr: runResult.timedOut
        ? "Execution timed out (possible infinite loop)."
        : runResult.stderr,
    };
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}

module.exports = { executeCpp };
