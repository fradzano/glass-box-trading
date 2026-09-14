// Pure `.env` rewriting for activation actions. The shell replaces the whole file;
// it never appends through a file handle, and it preserves every unrelated byte.

const CERTIFICATE_KEY = "PRE_ARM_CERTIFICATE";

function keyOf(lineWithTerminator: string): string | null {
  const line = lineWithTerminator.replace(/(?:\r\n|\n|\r)$/u, "").trim();
  if (line.length === 0 || line.startsWith("#")) return null;
  const equals = line.indexOf("=");
  return equals < 0 ? null : line.slice(0, equals).trim();
}

function linesOf(text: string): readonly string[] {
  if (text.length === 0) return [];
  return text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)?.filter(line => line.length > 0) ?? [];
}

export interface CertificateEnvInspection {
  readonly occurrences: number;
  readonly value: string | null;
}

export function inspectCertificateEnv(text: string): CertificateEnvInspection {
  const values: string[] = [];
  for (const raw of linesOf(text)) {
    if (keyOf(raw) !== CERTIFICATE_KEY) continue;
    const line = raw.replace(/(?:\r\n|\n|\r)$/u, "").trim();
    const value = line.slice(line.indexOf("=") + 1).trim();
    values.push(value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value);
  }
  return { occurrences: values.length, value: values.length === 1 ? values[0] ?? null : null };
}

export type CertificateEnvRewrite =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "CERTIFICATE_PATH_INVALID" | "CERTIFICATE_KEY_DUPLICATE" };

export function rewriteCertificateEnv(text: string, certificatePath: string | null): CertificateEnvRewrite {
  if (certificatePath !== null && (certificatePath.trim().length === 0 || /[\r\n"']/u.test(certificatePath))) {
    return { ok: false, reason: "CERTIFICATE_PATH_INVALID" };
  }
  const lines = linesOf(text);
  const occurrences = lines.filter(line => keyOf(line) === CERTIFICATE_KEY).length;
  if (certificatePath !== null && occurrences > 1) return { ok: false, reason: "CERTIFICATE_KEY_DUPLICATE" };
  const without = lines.filter(line => keyOf(line) !== CERTIFICATE_KEY).join("");
  if (certificatePath === null) return { ok: true, text: without };

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const separator = without.length === 0 || /(?:\r\n|\n|\r)$/u.test(without) ? "" : newline;
  return { ok: true, text: `${without}${separator}${CERTIFICATE_KEY}="${certificatePath}"${newline}` };
}
