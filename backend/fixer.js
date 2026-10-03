/**
 * fixer.js
 * -------------------------------------------------------------------------
 * Applies ONLY the corrections the analyzer marked as safe / obvious:
 *   - MISSING_SEMICOLON        -> append ';' to the line
 *   - MISSING_CLOSING_PAREN    -> insert missing ')' before trailing '{'
 *   - MISSING_CLOSING_BRACE    -> append '}' at end of file (line-based
 *                                 fixes never touch other lines, so brace
 *                                 placement inside the logic is never
 *                                 guessed)
 *
 * Anything not marked autoFixable is left untouched — the API response
 * still reports it so the user can fix it manually.
 * -------------------------------------------------------------------------
 */

function applyFixes(code, errors) {
  const lines = code.split(/\r?\n/);
  let appended = "";

  for (const err of errors) {
    if (err.autoFixable && err.suggestion != null) {
      lines[err.line - 1] = err.suggestion;
    } else if (err.appendAtEnd) {
      appended += (appended === "" ? "" : "\n") + err.appendAtEnd;
    }
  }

  let result = lines.join("\n");
  if (appended) {
    result = result.replace(/\s*$/, "") + "\n" + appended + "\n";
  }
  return result;
}

module.exports = { applyFixes };
