<p align="center">
  <img src="images/icon.png" width="96" height="96" alt="Fixora" />
</p>

<h1 align="center">Fixora — AI Code Repair</h1>

## What is Fixora?

Fixora finds bugs in your code, explains them in plain English, and fixes them with AI — all
without leaving your editor.

## Features

- 🔍 **Analyze** the active file and see issues in the native Problems panel
- ⚡ **Repair** any issue with one command — AI fixes it in place
- 💡 **Explain** an issue in plain language before deciding what to do with it
- 🚀 **Open Fixora** to jump into the full desktop app for deeper review

## Installation

**From the Marketplace:** search for "Fixora" in the Extensions view (`Ctrl+Shift+X`), or install
from [marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=novaa-studios.fixora-vscode).

**From a `.vsix` file:** download the latest one from
[GitHub Releases](https://github.com/NOVAA-STUDIOS/fixora/releases), then run
`code --install-extension fixora-vscode-*.vsix`.

## Requirements

- [Fixora](https://fixora-opal.vercel.app) installed on the same machine — the extension spawns
  `Fixora.exe --mcp` to talk to it over stdio, no separate server setup needed.

## Quick Start

1. Install [Fixora](https://fixora-opal.vercel.app) and this extension.
2. Open a project and open the file you want checked.
3. Run **Fixora: Analyze Current File** from the Command Palette (`Ctrl+Shift+P`) — issues appear
   in Problems, ready to Repair or Explain.

## Commands

| Command | What it does |
| --- | --- |
| `Fixora: Analyze Current File` | Analyzes the active editor, results land in Problems |
| `Fixora: Repair Selected Issue` | Repairs the diagnostic under the cursor |
| `Fixora: Explain Issue` | Explains the selected diagnostic in plain language |
| `Fixora: Open Fixora App` | Launches the full Fixora desktop app |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `fixora.exePath` | `Fixora.exe` | Path to the Fixora executable |
| `fixora.mcpPort` | `null` | MCP server port. Leave unset to auto-select |
| `fixora.autoAnalyze` | `false` | Analyze the active file automatically on save |

## Links

- [Website](https://fixora-opal.vercel.app)
- [GitHub](https://github.com/NOVAA-STUDIOS/fixora)
- [Support / report an issue](https://github.com/NOVAA-STUDIOS/fixora/issues)
