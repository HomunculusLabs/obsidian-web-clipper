---
source: https://github.com/charmbracelet/vhs
title: charmbracelet/vhs
filename: vhs
type: github-repo
site: github
extra:
  github_owner: charmbracelet
  github_repo: vhs
  github_package_name: vhs
  github_stars: 20500
  github_forks: 456
  github_language: Go
---

# charmbracelet/vhs

> Repository: [charmbracelet/vhs](https://github.com/charmbracelet/vhs) | ⭐ 20,500 | 🍴 456 | 🌐 Go

Your CLI home video recorder

# VHS

Your CLI home video recorder.

VHS lets you record terminal sessions to GIF and share with friends, colleagues, or internet. It's like creating a video of your terminal, but simpler and more focused on CLI experience.

## Installation

```sh
go install github.com/charmbracelet/vhs@latest
```

## Usage

Create a `.tape` file:

```text
Output demo.gif
Set FontSize 32
Set Width 800
Set Height 400
Type "echo 'Hello, World!'"
Enter
Sleep 500ms
```

Then run VHS:

```text
vhs < demo.tape
```

## Related Projects

VHS is part of the Charmbracelet ecosystem. Check out these related projects:

- [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss) - Style definitions for nice terminal layouts
- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea) - A powerful little TUI framework
- [charmbracelet/gum](https://github.com/charmbracelet/gum) - Gum: A tool for glamorous shell scripts

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details.
