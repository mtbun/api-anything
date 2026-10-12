#!/usr/bin/env node
// Entry point for the `api-anything` command. Registers tsx so the
// TypeScript sources run directly, without a build step.
import { register } from "tsx/esm/api";

register();
await import("../src/cli.ts");
