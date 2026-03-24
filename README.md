# @hasna/swarm

Autonomous swarm orchestrator for headless AI agent CLIs — CLI + MCP server + REST API + web dashboard

[![npm](https://img.shields.io/npm/v/@hasna/swarm)](https://www.npmjs.com/package/@hasna/swarm)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/swarm
```

## CLI Usage

```bash
swarm --help
```

- `swarm run`
- `swarm status`
- `swarm list`
- `swarm agents`
- `swarm events`
- `swarm delete`
- `swarm attach`
- `swarm streams`

## MCP Server

```bash
swarm-mcp
```

12 tools available.

## REST API

```bash
swarm-serve
```

## Cloud Sync

This package supports cloud sync via `@hasna/cloud`:

```bash
cloud setup
cloud sync push --service swarm
cloud sync pull --service swarm
```

## Data Directory

Data is stored in `~/.hasna/swarm/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
