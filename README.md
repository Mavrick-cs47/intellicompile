# IntelliCompile — Logic-Focused Multi-Language Compiler

A small web-based IDE for **Java** and **C++** that catches common, minor
syntax mistakes (a missing `;`, `)`, or `}`) *before* handing your code to
the real compiler — so you spend less time chasing typos and more time on
the logic of your program.

---

## A note on the tech stack (please read before the Architecture section)

The original spec for this project called for a **Java + Spring Boot**
backend. This build uses a **Node.js + Express** backend instead. Here's
why, stated plainly rather than glossed over:

- This project was built and tested inside a sandboxed environment with no
  route to Maven Central (only a short allow-list of hosts, npm's registry
  among them, is reachable). A Spring Boot project can't be downloaded,
  built, or run under that constraint, so I could not have verified it —
  and this project is built around "only claim a feature works if it was
  actually tested."
- Node.js + Express implements the **exact same three endpoints**
  (`/api/analyze`, `/api/fix`, `/api/run`) with the same request/response
  JSON shapes described in the spec, and shells out to the real `javac`,
  `java`, and `g++` exactly as a Spring Boot backend would via
  `ProcessBuilder`. The compiler-fallback architecture, the analyzer, the
  fixer, and the security model are unaffected by this swap.
- If your coursework specifically requires a Spring Boot backend, the
  `analyzer.js` / `fixer.js` logic in this repo is plain, dependency-free
  JavaScript that reads like pseudocode — porting it to Java service
  classes is mechanical. It just wasn't something I could compile and
  prove correct in this environment, so it isn't what's shipped here.

Everything else in this README describes what was actually built and
actually tested, end to end, with real `javac`/`g++` invocations.

---

## 1. Abstract

Beginner and intermediate programmers frequently lose time to trivial
syntax slips — a forgotten semicolon, an unclosed parenthesis. Traditional
compilers reject the whole file with a terse, sometimes confusing error
message, which interrupts the programmer's focus on their actual logic.

IntelliCompile adds a lightweight **syntax analysis pass** in front of the
real compiler. It recognizes a small, well-defined set of minor syntax
errors, explains them in plain language, proposes a safe correction that
never changes program logic, and — for the errors it's confident about —
can apply that correction automatically before compiling. The real
compiler (`javac`/`g++`) always has the final say: if the analyzer's
correction doesn't compile, the actual compiler error is shown, never
hidden.

## 2. Problem Statement

When a compiler encounters a minor syntax slip, it typically:
- Stops at the first error with a message written for someone who already
  understands the compiler's internals, not the mistake they made.
- Sometimes reports secondary errors that cascade from the first one,
  burying the actual cause.
- Gives no indication of *how confident* a fix would be, or whether the
  underlying logic is even correct.

IntelliCompile addresses this specifically for **minor, recoverable**
syntax errors — not logic errors, and not arbitrary malformed code.

## 3. Objectives

1. Support Java and C++ in one environment.
2. Detect common minor syntax errors: missing semicolons, missing closing
   parentheses, missing closing braces, and unmatched brackets.
3. Provide automatic/suggested corrections for recoverable syntax errors,
   never altering program logic.
4. Let users focus on logic while being clearly informed of any syntax
   correction that was applied on their behalf.

## 4. Features (implemented and tested)

- Language selector: Java or C++.
- Monaco-based code editor (line numbers, syntax highlighting, dark theme,
  auto-indent) — the same editor used in VS Code.
- **Analyze**: runs the heuristic syntax analyzer without compiling.
- **Fix**: applies every safely-fixable issue and returns corrected code.
- **Run**: analyzes, auto-corrects what it safely can, compiles with the
  real compiler, executes, and returns stdout/stderr/exit code.
- Detects:
  - Missing semicolons (with a heuristic that skips block headers,
    preprocessor directives, annotations, and multi-line expressions so it
    doesn't fire on `if (...) {`, `for (...) {`, `class X {`, etc.)
  - Missing closing parenthesis in a control-flow header, e.g.
    `if (x > 10 {` → `if (x > 10) {`
  - Missing closing brace at end of file (reported with a suggested
    append, never guessed mid-file)
  - Unmatched/unbalanced brackets `()`. `{}`. `[]`
- Clear distinction between **recoverable syntax errors** (auto-fixable)
  and everything else: logic errors are never touched, and syntax errors
  outside the analyzer's scope fall straight through to the real compiler
  so its actual error message is shown.

## 5. Architecture

```
Browser (frontend/index.html — React + Monaco, no build step)
        │  fetch() JSON over HTTP
        ▼
Express server (backend/server.js)
        │
        ├── POST /api/analyze ──► analyzer.js  (heuristic syntax scan)
        │
        ├── POST /api/fix     ──► analyzer.js + fixer.js
        │                          (safe line-level corrections only)
        │
        └── POST /api/run     ──► analyzer.js + fixer.js
                                   │
                                   ▼
                          executors/javaExecutor.js  (javac → java)
                          executors/cppExecutor.js   (g++ → binary)
                                   │
                                   ▼
                          real compiler is the final authority:
                          success → stdout/stderr/exit code returned
                          failure → real compiler error returned as-is
```

- **`analyzer.js`** strips string/char literals and comments (so a
  semicolon inside a string never confuses the scanner), then applies
  line-local rules for missing semicolons and a whole-file bracket-balance
  pass for parens/braces/square brackets.
- **`fixer.js`** applies *only* the corrections the analyzer marked as
  safe (`autoFixable: true`, or an unambiguous end-of-file brace append).
  It never rewrites operators, conditions, or anything else — see
  `tests/test-analyzer.js`, "Logic is never altered".
- **`executors/`** compile and run the (possibly auto-corrected) code in
  an isolated temp directory with compile/run timeouts, then clean up.

## 6. Technology Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 + Monaco Editor, vendored locally under `frontend/vendor/` in a single `index.html` | No build tooling and no internet/CDN access required at runtime. |
| Backend | Node.js + Express | See the tech-stack note above. |
| Java execution | System `javac` / `java` | Real compiler is the final authority. |
| C++ execution | System `g++` (`-std=c++17`) | Same principle. |
| Containerization | Docker / docker-compose | Optional; for sandboxed deployment. |

## 7. Installation

Requirements: Node.js ≥ 18, a JDK (`javac`/`java` on your `PATH`), and
`g++`.

```bash
cd backend
npm install
```

## 7a. Troubleshooting: blank page at localhost:4000

If the page loads with nothing visible, open the browser DevTools console
(F12 → Console) — the app itself shows a red error box in that case rather
than failing silently, so the console/that box will say what happened.
Two things this build fixes proactively:

- **No CDN dependency.** `frontend/vendor/` ships local copies of React,
  ReactDOM, Babel standalone, and Monaco Editor, so the app works on
  networks that block `unpkg.com` / `cdnjs.cloudflare.com` (common on
  corporate/campus Wi-Fi or behind some antivirus/firewall software) —
  there is no CDN call to fail.
- **Correct Babel runtime.** The in-browser JSX is compiled with Babel's
  *classic* runtime (`React.createElement`), not the default *automatic*
  runtime, which would otherwise emit `import ... from "react/jsx-runtime"`
  — an ES module import that plain global-script React can't satisfy, and
  which previously caused a silent blank page.

If you still see a blank page after these fixes, it's most likely a
browser extension (ad blocker/script blocker) interfering with inline
`<script>` execution — try an incognito/private window with extensions
disabled.

## 8. Running the Project

```bash
cd backend
npm start
```

Then open **http://localhost:4000** in a browser — the backend also
serves the frontend, so nothing else needs to run separately.

Environment variables (optional): `PORT` (default `4000`).

### With Docker

```bash
docker compose up --build
```

then open **http://localhost:4000**. (The Docker path was written and
reviewed carefully but a Docker daemon was not available in the sandbox
this project was built in, so — unlike everything else in this README —
it has not been build-tested end to end. Please treat it as a documented
starting point rather than a verified path, and open an issue/adjust if
`apt-get` package names drift on a newer Debian base image.)

## 9. Testing

Two test suites are included, and **both were actually executed** against
this codebase (not just written):

```bash
# Unit tests: analyzer + fixer logic in isolation (no server needed)
node tests/test-analyzer.js

# End-to-end tests: real javac/g++ compilation through a running server
cd backend && npm start &
node tests/test-e2e.js
```

Latest run: **18/18** unit tests passed, **23/23** end-to-end tests
passed, including:

- Java valid code compiles and runs → output `30`.
- Java missing semicolon (`int a = 10`) is detected on the correct line,
  auto-corrected, compiled, and run → output `30`.
- C++ missing semicolon is detected, auto-corrected, compiled, and run →
  output `10`.
- `if (x > 10 {` → analyzer detects the missing `)`, fixer produces
  `if (x > 10) {` and **not** `if (x >= 10) {` — logic is provably
  untouched.
- A syntactically valid but "logically odd" program is left completely
  alone — no auto-correction is attempted, by design.
- A genuinely broken program (`int a = ;`) is *not* claimed to be fixed —
  it fails at the compile stage and the real `javac` error is surfaced.
- `/api/fix` returns corrected code without executing it.
- Malformed requests (unsupported language) are rejected with `400`.

## 10. Security

- Each run compiles/executes in a freshly created, isolated temp
  directory that is deleted afterward.
- Compile step: 10s timeout. Run step: 5s timeout (guards against
  infinite loops).
- Request body size and submitted-code length are capped
  (`backend/server.js`).
- No arbitrary shell command is ever accepted from the client — the API
  only ever invokes `javac`, `java -cp <dir> <Class>`, `g++`, or the
  compiled binary, always with fixed, non-shell-interpolated arguments
  (`execFile`, not `exec`).
- `docker-compose.yml` adds container-level hardening for deployment:
  memory limit, CPU limit, process-count limit, dropped Linux
  capabilities, `no-new-privileges`, and a size-capped `tmpfs` for `/tmp`.
  See the note in that file about further restricting outbound network
  access for submitted programs — documented as a follow-up rather than
  claimed as already enabled, since it wasn't verified here.

## 11. Limitations (please read)

- This is a **heuristic** analyzer, not a full parser/AST — by design
  (see the project's original scope). It handles the specific patterns
  listed in Section 4 well; it does not claim to catch or fix every
  possible syntax error.
- It **never** attempts to fix logic errors, and it will say so explicitly
  when it can't safely determine a correction, rather than guessing.
- The backend is Node.js/Express, not Spring Boot — see the tech-stack
  note near the top of this document for why, and how to port it.
- `docker-compose.yml` has not been build-tested (no Docker daemon in the
  build environment) — everything else in this README has been.
- Sandboxing is timeout + resource-limit based, not a full container-per-
  request isolation model; for a production deployment handling untrusted
  users, use the Docker setup (or one execution container per request)
  rather than running the Node process directly on a shared host.

## 12. Future Scope

- Additional languages (Python, JavaScript).
- A real parser (e.g. ANTLR-based) instead of line-heuristics, for
  broader and more precise error detection.
- AI-assisted suggestions for logic-level bugs (kept explicitly out of
  scope here — this project is about syntax, not logic).
- Per-request container isolation for stronger sandboxing.
- Automatic test-case generation from a program's signature.

None of the above is implemented in this build.
