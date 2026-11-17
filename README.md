# dsh-mcp-menu

MCP server menu in the Harness status bar: every configured server, its live state, and an on/off switch per server.

DSH bundle (DeepSeek Harness plugin). Host side in `index.js`, optional Web UI in `client.js` / `client.bundle.js`,
loaded through `cordis.patch.yml` (`dsh.bundle.patch` in package.json).

## Install

In DSH, open **Plugins** and install from a git source:

```
github:UberAemos40/dsh-mcp-menu
```

No build step is needed: the compiled client bundle is committed.
After installing, enable the bundle and refresh the page (a restart is needed if the host side changed).

## Requirements

- A DSH build with a Web client of the same generation (`@deepseek-ai/dsh-client-*` packages).
- Nothing else: no registry, no extra dependencies.

## Usage

Needs at least one MCP server configured in the profile (see the MCP client rows in the loader patch).
