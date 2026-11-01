// Code frames from a minified bundle can make the default formatter pad every
// diagnostic to hundreds of kilobytes. Keep CI and redirected logs bounded.
export default function formatLintResults(results) {
  const lines = [];
  let errors = 0;
  let warnings = 0;
  for (const result of results) {
    errors += result.errorCount;
    warnings += result.warningCount;
    for (const message of result.messages) {
      const text = message.message.replace(/\s+/g, " ").trim();
      const concise = text.length > 600 ? `${text.slice(0, 600)}…` : text;
      const severity = message.severity === 2 ? "error" : "warning";
      lines.push(`${result.filePath}:${message.line ?? 0}:${message.column ?? 0} ${severity} ${concise}${message.ruleId ? ` (${message.ruleId})` : ""}`);
    }
  }
  if (!errors && !warnings && !lines.length) return "";
  lines.push(`${errors} errors, ${warnings} warnings`);
  return `${lines.join("\n")}\n`;
}
