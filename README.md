# Marshmallow

A cartoon 3D office where a team of Claude Code workers builds, tests and merges your GitHub issues. The team grows and shrinks to fit the work, and drifts off for coffee when there's nothing to do. Workers run on your computer or in Upstash Boxes.

**Status:** early build. The skeleton runs in demo mode (`npm install`, then `npm run dev -- --demo` and open http://localhost:5600), but it doesn't do anything useful yet.

Workers use Claude, or a local model through [Ollama](https://ollama.com) for testing without spending Claude usage.

| File | What's in it |
| --- | --- |
| [FEATURES.md](FEATURES.md) | The feature checklist: tick what's in |
| [BUILD-PLAN.md](BUILD-PLAN.md) | The order we build it in, phase by phase |
| [docs/cubefarm-reference.md](docs/cubefarm-reference.md) | How cubefarm, the project Marshmallow is modelled on, works |
| [docs/porting-map.md](docs/porting-map.md) | Which cubefarm code each Marshmallow module comes from |
| [CLAUDE.md](CLAUDE.md) | Instructions for Claude Code sessions in this repo |
| [.claude/agents/cubefarm-guide.md](.claude/agents/cubefarm-guide.md) | An agent that answers "how did cubefarm do X?" |

Built with guidance from [cubefarm](https://github.com/leonvanzyl/cubefarm) (MIT, © 2026 Leon van Zyl).
