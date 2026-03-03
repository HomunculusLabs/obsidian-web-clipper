---
source: https://github.com/charmbracelet/crush
title: charmbracelet/crush
filename: crush
type: github-repo
site: github
extra:
  github_owner: charmbracelet
  github_repo: crush
  github_package_name: crush
  github_stars: 1800
  github_forks: 45
  github_language: Go
---

# charmbracelet/crush

> Repository: [charmbracelet/crush](https://github.com/charmbracelet/crush) | ⭐ 1,800 | 🍴 45 | 🌐 Go

Create playful and colorful terminal experiences

# Crush

Create playful and colorful terminal experiences.

Crush is a library for creating animated and colorful terminal graphics. It provides an easy way to add visual interest to your CLI applications.

## Installation

```sh
go install github.com/charmbracelet/crush@latest
```

## Features

- Animated text effects
- Gradient text
- Rainbow colors
- Pulse animations
- Custom color palettes

## Usage

```go
package main

import (
    "github.com/charmbracelet/crush"
)

func main() {
    // Create a colorful text effect
    crush.Rainbow("Hello, Crush!")
}
```

## Examples

Check out examples directory for more usage patterns:

- `examples/rainbow` - Rainbow text effect
- `examples/gradient` - Gradient background
- `examples/pulse` - Pulsing text

## Related Projects

Crush is part of the Charmbracelet ecosystem. Check out these related projects:

- [charmbracelet/lipgloss](https://github.com/charmbracelet/lipgloss) - Style definitions for nice terminal layouts
- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea) - A powerful little TUI framework
- [charmbracelet/gum](https://github.com/charmbracelet/gum) - Gum: A tool for glamorous shell scripts

## Contributing

Pull requests are welcome!

## License

MIT License - see LICENSE file for details.
