/**
 * analyzer.js
 * -------------------------------------------------------------------------
 * IntelliCompile's syntax analysis engine.
 *
 * This is a HEURISTIC pre-compiler pass, not a full parser. Its job is to
 * spot a small, well-defined set of *common, minor* syntax mistakes
 * (missing semicolons, missing closing parentheses/braces/brackets) and
 * propose a *safe, logic-preserving* correction. The real compiler
 * (javac / g++) always remains the final authority — see compilers.js.
 *
 * Supported languages: "java", "cpp"
 * -------------------------------------------------------------------------
 */

const KEYWORDS_NO_SEMICOLON_PREFIX = [
  "if", "else", "for", "while", "do", "switch", "case", "default",
  "class", "public class", "private class", "interface", "enum",
  "try", "catch", "finally", "namespace", "template", "struct",
  "public:", "private:", "protected:", "static", "synchronized"
];

/** Strip // and /* *\/ comments and string/char literal contents so they
 *  don't confuse bracket counting or semicolon heuristics. Keeps the same
 *  line/column layout (replaces literal chars with spaces) so line numbers
 *  and later "reconstruct corrected code" logic stay valid. */
function stripLiteralsAndComments(sourceLines) {
  const cleaned = [];
  let inBlockComment = false;

  for (let raw of sourceLines) {
    let out = "";
    let inString = false;
    let inChar = false;
    let stringQuote = null;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      const next = raw[i + 1];

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          out += "  ";
          i++;
        } else {
          out += ch === "\t" ? "\t" : " ";
        }
        continue;
      }

      if (inString) {
        out += " ";
        if (ch === "\\") { out += " "; i++; continue; }
        if (ch === stringQuote) inString = false;
        continue;
      }

      if (inChar) {
        out += " ";
        if (ch === "\\") { out += " "; i++; continue; }
        if (ch === "'") inChar = false;
        continue;
      }

      if (ch === "/" && next === "/") {
        out += " ".repeat(raw.length - i);
        break;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        out += "  ";
        i++;
        continue;
      }
      if (ch === '"') { inString = true; stringQuote = '"'; out += " "; continue; }
      if (ch === "'") { inChar = true; out += " "; continue; }

      out += ch;
    }
    cleaned.push(out);
  }
  return cleaned;
}

function trimEnd(s) { return s.replace(/\s+$/, ""); }
function trimStart(s) { return s.replace(/^\s+/, ""); }

function startsWithAny(line, prefixes) {
  const t = trimStart(line);
  return prefixes.some(p => t === p || t.startsWith(p + " ") || t.startsWith(p + "("));
}

/**
 * Decide whether a logical (non-blank, non-comment-only) line is a
 * candidate for "missing semicolon" — i.e. it looks like a statement
 * (declaration, assignment, call, return) rather than a block header,
 * label, preprocessor directive, or annotation.
 */
function isStatementLike(cleanLine, language) {
  const t = trimEnd(trimStart(cleanLine));
  if (t === "") return false;

  // Already terminated / block openers / block closers — not candidates.
  if (/[;{}:,]$/.test(t)) return false;
  if (t.endsWith("\\")) return false; // line continuation (macros)

  // Lines ending in an operator imply the statement continues on the next line.
  if (/[+\-*/%&|^=<>!~?]$/.test(t)) return false;

  // Preprocessor directives (C++)
  if (language === "cpp" && t.startsWith("#")) return false;

  // Annotations (Java)
  if (language === "java" && t.startsWith("@")) return false;

  // Block-header keywords (if/for/while/class/... ) — these end in ')' or
  // an identifier but are not statements needing ';' UNLESS what follows
  // never opens a brace (rare in this project's supported patterns, so we
  // conservatively skip all of them).
  if (startsWithAny(t, KEYWORDS_NO_SEMICOLON_PREFIX)) return false;

  // A lone '}' or '} else' etc. already excluded above by /[{}:,]$/ check
  // for the trailing '}', but guard the "starts with }" case too (e.g. "} while (x)" needs ';', handled below).
  if (/^\}\s*while\s*\(.*\)$/.test(t)) return true; // do-while closing needs ';'

  // Must look like an actual statement: ends with identifier, number,
  // string/char placeholder space, ')' or ']' — i.e. NOT an open bracket.
  if (/[)\]\w"']$/.test(t)) return true;

  return false;
}

/**
 * Bracket balance check across the whole file, tracking line numbers so we
 * can report the most likely missing closer.
 */
function checkBrackets(cleanLines) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const closers = { ")": "(", "}": "{", "]": "[" };
  const stack = []; // { char, line, col }
  const issues = [];

  cleanLines.forEach((line, idx) => {
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (pairs[ch]) {
        stack.push({ char: ch, line: idx + 1, col: col + 1 });
      } else if (closers[ch]) {
        const expected = closers[ch];
        if (stack.length === 0 || stack[stack.length - 1].char !== expected) {
          issues.push({
            type: "UNMATCHED_CLOSING_BRACKET",
            line: idx + 1,
            message: `Unexpected '${ch}' — no matching '${expected}' was open.`,
          });
        } else {
          stack.pop();
        }
      }
    }
  });

  // Anything left on the stack never got closed.
  for (const open of stack) {
    const closeChar = pairs[open.char];
    let type = "MISSING_CLOSING_BRACKET";
    if (open.char === "(") type = "MISSING_CLOSING_PAREN";
    if (open.char === "{") type = "MISSING_CLOSING_BRACE";
    if (open.char === "[") type = "MISSING_CLOSING_SQUARE";
    issues.push({
      type,
      line: open.line,
      message: `'${open.char}' opened on line ${open.line} is never closed with '${closeChar}'.`,
      openChar: open.char,
      closeChar,
    });
  }

  return issues;
}

/**
 * Specifically detect the common "if (x > 10 {" pattern: a control-flow
 * header line whose parens are unbalanced (more '(' than ')') and which
 * ends directly in '{'. This is reported as MISSING_CLOSING_PAREN on that
 * single line, which is easier to auto-fix than a whole-file bracket
 * report.
 */
function checkControlHeaderParens(cleanLines) {
  const issues = [];
  cleanLines.forEach((line, idx) => {
    const t = trimEnd(line);
    if (!/\{\s*$/.test(t)) return;
    if (!startsWithAny(t, ["if", "for", "while", "switch", "catch"])) return;

    let depth = 0;
    for (const ch of t) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    if (depth > 0) {
      // Missing `depth` closing parens right before the trailing '{'.
      issues.push({
        type: "MISSING_CLOSING_PAREN",
        line: idx + 1,
        message: `Header on line ${idx + 1} opens ${depth} more '(' than it closes before '{'.`,
        count: depth,
      });
    }
  });
  return issues;
}

/**
 * Main entry point.
 * @param {string} code raw source code
 * @param {"java"|"cpp"} language
 * @returns {{errors: Array, hasBlockingIssues: boolean}}
 */
function analyze(code, language) {
  const rawLines = code.split(/\r?\n/);
  const cleanLines = stripLiteralsAndComments(rawLines);
  const errors = [];

  // 1. Missing semicolons (line-local heuristic).
  cleanLines.forEach((line, idx) => {
    if (isStatementLike(line, language)) {
      const original = trimEnd(rawLines[idx]);
      errors.push({
        type: "MISSING_SEMICOLON",
        line: idx + 1,
        message: "Semicolon (;) appears to be missing at the end of this statement.",
        suggestion: original + ";",
        autoFixable: true,
      });
    }
  });

  // 2. Control-flow header with unbalanced parens, e.g. `if (x > 10 {`.
  //    We also build an "adjusted" copy of the clean lines with these
  //    parens virtually inserted, so the whole-file bracket check below
  //    doesn't cascade false positives from a paren issue we already
  //    reported once, precisely, on its own line.
  const headerParenIssues = checkControlHeaderParens(cleanLines);
  const adjustedCleanLines = cleanLines.slice();
  for (const issue of headerParenIssues) {
    const original = trimEnd(rawLines[issue.line - 1]);
    // Insert the missing ')' characters right before the trailing '{'.
    const closeStr = ")".repeat(issue.count);
    const fixed = original.replace(/\s*\{\s*$/, `${closeStr} {`);
    errors.push({
      type: "MISSING_CLOSING_PAREN",
      line: issue.line,
      message: issue.message,
      suggestion: fixed,
      autoFixable: true,
    });
    adjustedCleanLines[issue.line - 1] = adjustedCleanLines[issue.line - 1].replace(
      /\{\s*$/,
      `${closeStr} {`
    );
  }

  // 3. Whole-file bracket balance (braces, remaining parens, brackets),
  //    computed on the adjusted lines so an already-reported header-paren
  //    issue doesn't cascade into spurious brace/bracket noise.
  const bracketIssues = checkBrackets(adjustedCleanLines);
  for (const issue of bracketIssues) {
    if (issue.type === "MISSING_CLOSING_BRACE") {
      errors.push({
        type: issue.type,
        line: issue.line,
        message: issue.message + " Add a closing '}' where the block should end (typically at the end of the file).",
        suggestion: null, // brace placement inside nested logic is not "safe/obvious" in general
        autoFixable: false,
        appendAtEnd: "}",
      });
    } else if (issue.type === "MISSING_CLOSING_PAREN" || issue.type === "MISSING_CLOSING_SQUARE") {
      errors.push({
        type: issue.type,
        line: issue.line,
        message: issue.message,
        suggestion: null,
        autoFixable: false,
      });
    } else if (issue.type === "UNMATCHED_CLOSING_BRACKET") {
      errors.push({
        type: issue.type,
        line: issue.line,
        message: issue.message,
        suggestion: null,
        autoFixable: false,
      });
    }
  }

  // Sort by line number for a stable, readable report.
  errors.sort((a, b) => a.line - b.line);

  return {
    errors,
    hasErrors: errors.length > 0,
  };
}

module.exports = { analyze, stripLiteralsAndComments };
