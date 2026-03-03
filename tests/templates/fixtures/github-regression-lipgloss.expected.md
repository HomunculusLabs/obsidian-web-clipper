---
source: https://github.com/charmbracelet/lipgloss
title: charmbracelet/lipgloss
filename: lipgloss
type: github-repo
site: github
extra:
  github_owner: charmbracelet
  github_repo: lipgloss
  github_package_name: lipgloss
  github_stars: 17200
  github_forks: 324
  github_language: Go
---

# charmbracelet/lipgloss

> Repository: [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss) | ⭐ 17,200 | 🍴 324 | 🌐 Go

Style definitions for nice terminal layouts

# Lip Gloss

Style definitions for nice terminal layouts.

Lip Gloss is a styling library for terminal user interfaces (TUIs). It provides a simple and intuitive way to define styles for text, borders, and other elements in terminal applications.

## Installation

```sh
go install github.com/charmbracelet/lipgloss@latest
```

## Features

- Clean, intuitive API
- ANSI color support
- Color palettes
- Border styles
- Width and height constraints
- Alignment

## Usage

```go
package main

import (
    "github.com/charmbracelet/lipgloss"
)

var style = lipgloss.NewStyle().
    Foreground(lipgloss.Color("FAFAFA")).
    Background(lipgloss.Color("7D56F4")).
    Padding(1, 2).
    Italic(true)

func main() {
    fmt.Println(style.Render("Hello, Lip Gloss!"))
}
```

## Related Projects

Lip Gloss is part of the Charmbracelet ecosystem. Check out these related projects:

- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea) - A powerful little TUI framework
- [charmbracelet/vhs](https://github.com/charmbracelet/vhs) - Video for Shell
- [charmbracelet/gum](https://github.com/charmbracelet/gum) - Gum: A tool for glamorous shell scripts

## Contributing

We love pull requests! Feel free to contribute.

## License

MIT License - see LICENSE file for details.
