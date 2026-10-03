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

/**
 * Extract the public class name so we can write Main.java with the
 * correct filename (javac requires the file name to match the public
 * class). Falls back to "Main" if no public class is found.
 */
function detectPublicClassName(code) {
  const m = code.match(/public\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
  return m ? m[1] : "Main";
}

async function executeJava(code) {
  const className = detectPublicClassName(code);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "intellicompile-java-"));
  const sourceFile = path.join(workDir, `${className}.java`);

  try {
    fs.writeFileSync(sourceFile, code, "utf8");

    const compile = await run("javac", [sourceFile], {
      cwd: workDir,
      timeout: COMPILE_TIMEOUT_MS,
    });

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

    const runResult = await run("java", ["-cp", workDir, className], {
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

module.exports = { executeJava };
