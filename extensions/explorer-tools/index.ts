import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { truncateHead, formatSize, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const normalizePath = (p: string, cwd: string) => {
  if (!p) return cwd;
  return path.isAbsolute(p.replace(/^@+/, "")) ? p.replace(/^@+/, "") : path.join(cwd || process.cwd(), p.replace(/^@+/, ""));
};

const trunc = (text: string, prefix: string) => {
  const result = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  const details: any = { truncated: !!result.truncated, outputLines: result.outputLines ?? 0, totalLines: result.totalLines ?? 0 };
  let out = result.content;
  if (result.truncated) {
    const tempFile = path.join(os.tmpdir(), `pi-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    fsPromises.writeFile(tempFile, text, "utf8").catch(() => {});
    out += `\n\n[Output truncated: ${result.outputLines} of ${result.totalLines} lines (${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}). Full output: ${tempFile}]`;
    Object.assign(details, { tempFile, outputBytes: result.outputBytes, totalBytes: result.totalBytes });
  }
  return { out, details };
};

const errResult = (msg: string) => ({ content: [{ type: "text", text: msg }], isError: true, details: { error: msg } });

const renderCall = (name: string, args: any, theme: any, suffix = "") => 
  new Text(theme.fg("toolTitle", theme.bold(name + " ")) + theme.fg("muted", args.path || ".") + (suffix ? theme.fg("dim", suffix) : ""), 0, 0);

const renderResult = (result: any, { expanded, isPartial }: any, theme: any, getText: (r: any) => string) => {
  if (isPartial) return new Text(theme.fg("warning", "Processing..."), 0, 0);
  if (result.isError) return new Text(theme.fg("error", `Error: ${result.details?.error ?? "unknown"}`), 0, 0);
  const text = getText(result);
  if (!expanded) return new Text(text.split("\n").slice(0, 20).join("\n"), 0, 0);
  let out = text;
  if (result.details?.truncateInfo) out += "\n\n" + theme.fg("muted", `Full: ${result.details.truncateInfo.tempFile} (${result.details.truncateInfo.outputLines}/${result.details.truncateInfo.totalLines})`);
  return new Text(out, 0, 0);
};

export default function (pi: ExtensionAPI) {
  const EXPLORER_TOOLS = ["ls", "rd"];
  let originalTools: string[] = [];
  let enabled = false;

  const captureAndEnable = () => {
    originalTools = pi.getActiveTools().filter(t => !EXPLORER_TOOLS.includes(t));
    enabled = true;
    pi.setActiveTools(EXPLORER_TOOLS);
  };

  const enableExplorerTools = (ctx: any) => {
    if (enabled) {
      if (ctx.hasUI) ctx.ui.notify("Explorer tools already enabled", "warning");
      return;
    }
    try {
      captureAndEnable();
      if (ctx.hasUI) ctx.ui.notify("Explorer tools enabled: ls, rd", "info");
    } catch (e: any) {
      if (ctx.hasUI) ctx.ui.notify(`Error enabling explorer tools: ${e.message}`, "error");
    }
  };

  const disableExplorerTools = (ctx: any) => {
    if (!enabled) {
      if (ctx.hasUI) ctx.ui.notify("Explorer tools already disabled", "warning");
      return;
    }
    try {
      enabled = false;
      pi.setActiveTools(originalTools);
      if (ctx.hasUI) ctx.ui.notify(`Tools restored: ${originalTools.join(", ")}`, "info");
    } catch (e: any) {
      if (ctx.hasUI) ctx.ui.notify(`Error restoring tools: ${e.message}`, "error");
    }
  };

  pi.registerCommand("explorer-tools:enable", {
    description: "Switch to explorer-only tools (ls, rd)",
    handler: async (_args, ctx) => {
      enableExplorerTools(ctx);
    },
  });

  pi.registerCommand("explorer-tools:disable", {
    description: "Switch back to original tools",
    handler: async (_args, ctx) => {
      disableExplorerTools(ctx);
    },
  });

  pi.registerTool({
    name: "ls",
    label: "List files",
    description: "List files and directories for a given path (non-recursive).",
    parameters: Type.Object({ path: Type.String({ description: "Path to list" }) }),

    async execute(_id, params, _signal, _onUpdate, ctx) {
      const fullPath = normalizePath(String((params as any).path || ""), ctx.cwd ?? process.cwd());
      try {
        const st = await fsPromises.stat(fullPath);
        if (st.isFile()) {
          const entry = { name: path.basename(fullPath), type: "file", size: st.size, mtime: st.mtimeMs };
          return { content: [{ type: "text", text: `${entry.name}\tfile\t${entry.size} bytes\t${new Date(entry.mtime).toISOString()}` }], details: { path: fullPath, entries: [entry] } };
        }
        const dirents = await fsPromises.readdir(fullPath, { withFileTypes: true });
        const entries = await Promise.all(dirents.map(async (d) => {
          const p = path.join(fullPath, d.name);
          try {
            const s = await fsPromises.lstat(p);
            return { name: d.name, type: d.isDirectory() ? "dir" : d.isSymbolicLink() ? "link" : "file", size: s.size, mtime: s.mtimeMs };
          } catch { return { name: d.name, type: "unknown", size: 0, mtime: 0 }; }
        }));
        const text = entries.map(e => `${e.type}\t${e.name}\t${e.size}\t${new Date(e.mtime).toISOString()}`).join("\n") || "(empty)";
        const { out, details } = trunc(text, "ls");
        return { content: [{ type: "text", text: out }], details: { ...details, path: fullPath, entries } };
      } catch (e: any) { return errResult(`Error: ${e.message}`); }
    },

    renderCall: (args: any, theme: any) => renderCall("ls", args, theme),
    renderResult: (result: any, ctx: any, theme: any) => renderResult(result, ctx, theme, r => r.content?.[0]?.text ?? ""),
  });

  pi.registerTool({
    name: "rd",
    label: "Read file lines",
    description: "Read lines from a file. Lines are 1-indexed. Use -1 for EOF.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to file" }),
      line_beginning: Type.Integer({ description: "Start line (1-indexed)", minimum: 1 }),
      line_end: Type.Integer({ description: "End line (inclusive), -1 for EOF", minimum: -1 }),
    }),

    async execute(_id, params, signal, onUpdate, ctx) {
      const fullPath = normalizePath(String((params as any).path || ""), ctx.cwd ?? process.cwd());
      const start = Number((params as any).line_beginning ?? 1);
      const end = Number((params as any).line_end ?? -1);
      if (isNaN(start) || isNaN(end) || start < 1 || end < -1 || (end !== -1 && start > end)) return errResult("Invalid line range");
      try {
        const st = await fsPromises.stat(fullPath);
        if (!st.isFile()) throw new Error(`File not found: ${fullPath}`);
        const rs = fs.createReadStream(fullPath, { encoding: "utf8" });
        const rl = readline.createInterface({ input: rs, crlfDelay: Infinity });
        const lines: string[] = [];
        let idx = 0;
        for await (const line of rl) {
          if (signal?.aborted) break;
          idx++;
          if (idx < start) continue;
          lines.push(line);
          if (end !== -1 && idx >= end) break;
          if (lines.length % 200 === 0) onUpdate?.({ content: [{ type: "text", text: `Read ${lines.length} lines...` }] });
        }
        rl.close();
        rs.destroy();
        const text = lines.join("\n") || "(no lines)";
        const { out, details } = trunc(text, "rd");
        return { content: [{ type: "text", text: out }], details: { ...details, path: fullPath, start, end } };
      } catch (e: any) { return errResult(`Error: ${e.message}`); }
    },

    renderCall: (args: any, theme: any) => renderCall("rd", args, theme, ` (${args.line_beginning ?? 1}:${args.line_end ?? -1})`),
    renderResult: (result: any, ctx: any, theme: any) => renderResult(result, ctx, theme, r => r.content?.[0]?.text ?? ""),
  });

  try { captureAndEnable(); } catch {}

  pi.on("session_start", async (_e, ctx) => {
    try {
      if (!enabled) captureAndEnable();
      if (ctx.hasUI) ctx.ui.notify("Active: ls, rd", "info");
    } catch {}
  });
}
