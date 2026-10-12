export interface CallArgs {
  params: Record<string, string>;
  body?: string;
  baseUrl?: string;
  sessionPath?: string;
  allowWrites: boolean;
}

// Everything that is not one of call's own options is an operation parameter.
// -p name=value covers a parameter whose name clashes with an option.
export function parseCallArgs(args: string[]): CallArgs {
  const out: CallArgs = { params: {}, allowWrites: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--allow-writes") {
      out.allowWrites = true;
      continue;
    }
    if (arg === "-p") {
      const pair = args[++i];
      const eq = pair?.indexOf("=") ?? -1;
      if (!pair || eq < 1) throw new Error("-p needs name=value");
      out.params[pair.slice(0, eq)] = pair.slice(eq + 1);
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value === undefined) throw new Error(`--${name} needs a value`);

    if (name === "body") out.body = value;
    else if (name === "base-url") out.baseUrl = value;
    else if (name === "session") out.sessionPath = value;
    else out.params[name] = value;
  }
  return out;
}
