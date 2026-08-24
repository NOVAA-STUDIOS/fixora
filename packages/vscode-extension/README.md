# Fixora — AI Code Repair (VS Code Extension)

Analyze and repair code from inside VS Code, powered by the Fixora desktop app's MCP server.

## Requirements

Fixora must be installed. The extension spawns `Fixora.exe --mcp` to talk to it over stdio — no
separate server setup needed.

## Commands

- **Fixora: Analyze Current File** — runs analysis on the active editor and shows results in the
  Problems panel.
- **Fixora: Repair Selected Issue** — repairs the diagnostic under the cursor.
- **Fixora: Explain Issue** — shows a plain-language explanation of the selected diagnostic.
- **Fixora: Open Fixora App** — launches the full Fixora desktop app.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `fixora.mcpPort` | `null` | MCP server port. Leave unset to auto-select. |
| `fixora.autoAnalyze` | `false` | Analyze the active file automatically on save. |
