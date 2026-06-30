// .opencode/plugins/guards.ts
//
// The OpenCode half of this plugin's HOOKS. Skills are NOT here — OpenCode
// discovers SKILL.md natively (see README), so the skills/ folder is shared
// with no shim. Hooks, though, are host-specific: this file is the OpenCode
// equivalent of hooks/block-secrets.sh. You write guards once per host.

import type { Plugin } from "@opencode-ai/plugin"

export const Guards: Plugin = async ({ project, directory }) => {
  return {
    // OpenCode's PreToolUse. Throwing blocks the call (the equivalent of exit 2).
    "tool.execute.before": async (input, output) => {
      const path = output.args?.filePath ?? ""
      const cmd = output.args?.command ?? ""

      if (path.includes(".env") || path.includes("/secrets/")) {
        throw new Error(`Blocked: ${path} is a secret file. Do not read or edit it.`)
      }
      if (cmd.includes("rm -rf") || cmd.includes("git push --force")) {
        throw new Error(`Blocked: refusing to run a destructive command (${cmd}).`)
      }
    },
  }
}
