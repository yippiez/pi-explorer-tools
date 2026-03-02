# pi-explorer-tools

`pi-explorer-tools` is a Pi package that limits pi agent to "explorer-tools":

- `ls` lists files and directories for a given path (non-recursive).
- `rd` reads lines from a file. Lines are 1-indexed. Use -1 for EOF.

## Install from Git

Global install (writes to `~/.pi/agent/settings.json`):

```bash
pi install git:github.com/yippiez/pi-explorer-tools
```

Local/project install (writes to `.pi/settings.json` in the current repo):

```bash
pi install -l git:github.com/yippiez/pi-explorer-tools
```

## Optional: Pin to a ref

Pin global install to `main`:

```bash
pi install git:github.com/yippiez/pi-explorer-tools@main
```

Pin local install to `main`:

```bash
pi install -l git:github.com/yippiez/pi-explorer-tools@main
```
