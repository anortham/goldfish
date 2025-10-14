# Instructions for AI Agents

**If you are an AI agent contributing to Goldfish development, read `CLAUDE.md` for architecture and TDD requirements.**

**Humans:** See `README.md` for installation and overview, or `CONTRIBUTING.md` for detailed development guidelines.

## Build/Lint/Test Commands

- **Run all tests**: `bun test`
- **Run single test**: `bun test tests/file.test.ts -t "test name"`
- **Watch mode**: `bun test --watch`
- **Coverage**: `bun test --coverage`
- **Type check**: `tsc --noEmit`
- **Build**: `bun build src/server.ts --outdir dist --target node`

## Code Style Guidelines

- **TDD Mandatory**: Write tests FIRST, then implementation. No exceptions.
- **Imports**: Relative paths for local files (`../types`), absolute for externals (`@modelcontextprotocol/sdk`)
- **Types**: Strict TypeScript, interfaces with optional `?` properties, union types for enums
- **Naming**: camelCase variables/functions, PascalCase interfaces, kebab-case files
- **Async**: Use async/await, no Promises directly
- **Errors**: Throw `Error` objects with descriptive messages, wrap in try-catch
- **Files**: Atomic writes (write-then-rename), UTC timestamps only (`new Date().toISOString()`)
- **Formatting**: 2-space indent, no semicolons, JSDoc for public APIs
- **Architecture**: Well-structured codebase (~1,735 lines), markdown storage, no database
