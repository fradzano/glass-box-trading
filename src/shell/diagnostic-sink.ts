// BOOTSTRAP_DIAGNOSTIC_SINK (§0, S-CYC-11): a pre-armed diagnostic channel
// OUTSIDE STATE_DIR for the one narrow case where the local-journal
// requirement is impossible — STATE_DIR itself cannot open. Redacted
// diagnostics only (codes and field names, never configured values or
// secrets), never state authority. The production sink is the Windows
// Application event log (installed before arming, wired in P7); this
// file-backed implementation carries the same contract for tests and dev.
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { BootstrapDiagnostic } from "../core/startup.js";

export interface DiagnosticSink {
  /** S-CYC-11 requires the installed sink to be writable at startup. */
  probeWritable(): boolean;
  write(record: BootstrapDiagnostic): void;
  /** Returns all pending diagnostics and clears them: the caller imports each into the journal (S-CYC-11 repair path). */
  drainPending(): readonly BootstrapDiagnostic[];
}

export function createFileDiagnosticSink(filePath: string): DiagnosticSink {
  function readAll(): BootstrapDiagnostic[] {
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      return [];
    }
    const records: BootstrapDiagnostic[] = [];
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        const code = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["code"] : null;
        if (code === "CONFIG_INVALID_STATE_DIR" || code === "CONFIG_INVALID_UNJOURNALABLE") {
          records.push(parsed as BootstrapDiagnostic);
        }
      } catch {
        // A torn or foreign line in the sink is dropped: the sink is diagnostics, never state authority.
      }
    }
    return records;
  }

  return {
    probeWritable(): boolean {
      // An empty append does not throw on a directory (Windows), so the probe checks the shape and opens explicitly.
      try {
        if (existsSync(filePath) && statSync(filePath).isDirectory()) return false;
        closeSync(openSync(filePath, "a"));
        return true;
      } catch {
        return false;
      }
    },
    write(record: BootstrapDiagnostic): void {
      appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
    },
    drainPending(): readonly BootstrapDiagnostic[] {
      const records = readAll();
      if (records.length > 0) writeFileSync(filePath, "", "utf8");
      return records;
    },
  };
}
