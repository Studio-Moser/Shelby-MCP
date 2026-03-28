# Contributing to ShelbyMCP

Thanks for your interest in contributing! ShelbyMCP is an open-source project and we welcome contributions from the community.

## How to Contribute

### Issues First

Before writing code, open an issue describing what you want to do. This lets us discuss the approach before you invest time.

- **Bug reports**: Include steps to reproduce, expected vs. actual behavior, and your environment (OS, Go version, AI tool).
- **Feature requests**: Describe the use case, not just the solution. What problem are you trying to solve?
- **New Forage tasks**: Propose new scheduled enrichment tasks with a clear description of what they do and why they're valuable.

### Pull Request Process

1. Fork the repo and create a branch from `main`
2. Write your code with tests
3. Run `go test ./...` and ensure all tests pass
4. Run `go vet ./...` and fix any warnings
5. Open a PR that references the issue (`Closes #N`)
6. Fill out the PR template

### What We're Looking For

- **New MCP tools** — Additional ways to query and manipulate the memory graph
- **Forage skill improvements** — Better enrichment tasks, smarter consolidation
- **Agent setup guides** — Documentation for connecting new AI tools
- **Bug fixes** — With tests that demonstrate the fix
- **Performance improvements** — With benchmarks showing the improvement

### Code Style

- Standard Go formatting (`gofmt`)
- Descriptive variable and function names
- Comments for non-obvious logic
- Table-driven tests where appropriate
- Error handling: wrap errors with context (`fmt.Errorf("doing X: %w", err)`)

## Development Setup

```bash
git clone https://github.com/Studio-Moser/shelbymcp.git
cd shelbymcp
go build ./...
go test ./...
```

Requires Go 1.22+.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
