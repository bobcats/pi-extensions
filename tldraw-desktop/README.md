# tldraw-desktop

Pi extension for the [tldraw desktop](https://github.com/tldraw/tldraw-desktop) local Canvas API.

Connects to the local HTTP server that tldraw desktop runs automatically on launch.

## Tools

| Tool | Description |
|------|-------------|
| `tldraw_server_status` | Check if tldraw desktop is running |
| `tldraw_list_docs` | List open documents (optional name filter) |
| `tldraw_get_shapes` | Get shapes on a document's current page |
| `tldraw_get_screenshot` | Screenshot the canvas as JPEG |
| `tldraw_apply_actions` | Apply structured canvas actions |
| `tldraw_llms_docs` | Fetch tldraw SDK docs for LLMs |

## Commands

| Command | Description |
|---------|-------------|
| `/tldraw` | Check connection status |

## Setup

tldraw desktop must be running. It writes connection info to:

- **macOS**: `~/Library/Application Support/tldraw/server.json`
- **Linux**: `~/.config/tldraw/server.json`
- **Windows**: `%APPDATA%/tldraw/server.json`

## Actions reference

`tldraw_apply_actions` accepts an array of action objects with a `_type` field:

`create`, `update`, `delete`, `clear`, `move`, `place`, `label`, `align`, `distribute`, `stack`, `bringToFront`, `sendToBack`, `resize`, `rotate`, `pen`, `setMyView`

Call `tldraw_llms_docs` first to learn the exact schema for each action type.
