You are working on my GNOME Shell extension repository:

https://github.com/mouradbenabdallah/gnome-extension

IMPORTANT:
First inspect the entire repository and understand the existing architecture before modifying anything.

This is a GNOME Shell system monitor extension built with:
- GNOME Shell 45+
- GJS / JavaScript ESM
- Rust telemetry daemon
- GSettings
- GTK4 / Libadwaita preferences
- Custom CSS
- Cairo gauges / sparklines

The current project already works. DO NOT rewrite the telemetry daemon or replace the architecture unnecessarily.

The goal is to redesign the user interface so it feels like a polished modern macOS-inspired system monitor while remaining native and appropriate for GNOME.

==================================================
1. MAIN OBJECTIVE
==================================================

Redesign the current system-monitor popover shown when clicking the top-panel capsule.

CURRENT:
- Tall vertical card
- Metrics stacked vertically
- Large CPU core grid
- Traditional progress bars
- Basic dark styling

TARGET:
A wide horizontal macOS-inspired floating monitoring panel.

The panel should feel like:
- macOS Activity Monitor
- macOS Control Center
- modern Liquid Glass / translucent glass UI
- premium desktop widget
- smooth, subtle animations

DO NOT literally copy Apple's UI or assets.
Use the design language as inspiration while keeping the implementation original and GNOME-native.

==================================================
2. NEW HORIZONTAL LAYOUT
==================================================

Transform the current vertical popover into a wide horizontal card.

Recommended structure:

┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  CPU              MEMORY            GPU             NETWORK         │
│  6.4%  64°C       3.9 / 23.2 GB     0%  55°C       ↓ 0 KB/s       │
│  ─────────        ─────────────     ─────────       ↑ 0 KB/s       │
│                                                                     │
│  FAN             DISK I/O          BATTERY          TEMPERATURE     │
│  2580 RPM        R 0 KB/s          47%              64°C            │
│                  W 180 KB/s                                         │
│                                                                     │
│              [ small live graphs / indicators ]                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

The exact layout can be improved after inspecting the existing widgets.

Use responsive layout principles.

The card should not become excessively wide on smaller screens.

Use a maximum width and adapt the number of visible columns depending on available space.

==================================================
3. LIQUID GLASS DESIGN
==================================================

Create a convincing "Liquid Glass" effect.

The design should have:

- highly rounded corners
- translucent dark background
- subtle background transparency
- soft blur / frosted-glass effect where GNOME Shell permits it
- thin semi-transparent border
- subtle inner highlight
- soft shadow
- layered surfaces
- slightly brighter glass around interactive elements
- elegant contrast
- minimal visual noise

Do NOT use excessive blur that destroys readability or causes performance problems.

If true background blur is not technically reliable in GNOME Shell:

Create a high-quality visual approximation using:
- translucent backgrounds
- gradients
- subtle highlights
- borders
- shadows
- layered St widgets
- CSS

The final result should still look like premium glass.

Use the existing stylesheet architecture instead of scattering inline styles throughout JavaScript.

==================================================
4. ANIMATIONS
==================================================

Improve the animations significantly.

The UI should feel alive but not distracting.

Add:

A. POPOVER OPEN

When opening:
- slight scale from ~0.96 → 1.0
- fade in
- slight upward movement
- spring/eased interpolation
- duration around 180–250ms

B. POPOVER CLOSE

Reverse the animation smoothly.

C. METRIC VALUES

When CPU/RAM/GPU/network values change:
- do not visually jump
- smoothly interpolate values
- use easing

D. PROGRESS BARS

Bars should smoothly transition instead of instantly changing width.

E. GRAPH UPDATES

Graphs should animate naturally when new telemetry arrives.

Avoid rebuilding widgets unnecessarily.

F. HOVER EFFECTS

Interactive metric cards should have:
- subtle glass highlight
- slight brightness increase
- smooth transition

Do NOT overuse scaling.

G. SETTINGS

Settings interactions should also have subtle transitions.

IMPORTANT:
Avoid animations running unnecessarily when the popover is hidden.

Avoid animation loops that consume CPU.

==================================================
5. TOP PANEL CAPSULE
==================================================

Improve the existing top-panel capsule too.

It should feel like a compact macOS-style status capsule.

Example:

   ◉  CPU 6%   RAM 17%   GPU 0%

or:

   [ CPU 6% ] [ RAM 17% ] [ GPU 0% ]

Keep it compact.

Use:
- glass background
- rounded capsule
- subtle border
- animated values
- smooth transitions

The existing compact mode should remain functional.

==================================================
6. METRIC WIDGET SYSTEM
==================================================

This is VERY IMPORTANT.

The user must be able to choose exactly which widgets appear.

Create a proper widget configuration system.

Possible widgets:

- CPU
- CPU Temperature
- CPU Cores
- RAM
- GPU
- GPU Temperature
- Fan
- Network
- Disk I/O
- Battery
- Temperature
- History
- Top Processes

Each widget must be independently enabled/disabled.

Example:

CPU              ON
CPU Temperature  ON
CPU Cores        OFF
RAM              ON
GPU              ON
Fan              ON
Network          OFF
Disk             ON
Battery          OFF
Top Processes    OFF

The UI should immediately reflect these changes.

Do NOT hard-code the layout around all widgets.

Build a reusable widget registry/component system.

For example conceptually:

MetricWidgetRegistry
  CPU
  Memory
  GPU
  Fan
  Network
  Disk
  Battery
  CPUCores
  History
  Processes

Each widget should have:
- id
- title
- icon
- enabled state
- render function
- optional size/layout information

This will make future widgets easy to add.

==================================================
7. DRAG AND DROP / ORDERING
==================================================

If practical with GNOME Shell widgets, allow the user to reorder widgets.

Example:

CPU
RAM
GPU
Network

could become:

GPU
CPU
RAM
Network

Persist the order using GSettings.

If implementing drag-and-drop is too complex for the current GNOME Shell architecture, create a simple ordering system in Preferences instead.

Do NOT introduce fragile behavior just for drag-and-drop.

==================================================
8. EXTENSION SETTINGS / PREFERENCES
==================================================

Create a professional preferences window.

Use modern GTK4 + Libadwaita patterns appropriate for the GNOME version supported by this project.

GNOME extension preferences should be accessible through the normal extension settings flow.

Organize settings into sections:

GENERAL
- Enable extension
- Start automatically
- Polling interval
- Pause while locked

APPEARANCE
- Liquid Glass style
- Glass opacity
- Blur intensity if supported
- Corner radius
- Compact mode
- Panel capsule style
- Dark / system appearance if appropriate

ANIMATIONS
- Enable animations
- Animation intensity
- Popover animation
- Value transitions
- Graph animations

WIDGETS
- Enable/disable individual widgets
- Widget ordering
- Show/hide CPU cores
- Show/hide graphs
- Show/hide processes

PERFORMANCE
- Telemetry interval
- Graph history length
- Reduce animations
- Low-power mode

ALERTS
- CPU threshold
- Temperature threshold
- GPU threshold
- Fan threshold
- RAM threshold

ADVANCED
- Reinitialize sensors
- Reset settings
- Debug information

==================================================
9. WIDGET CUSTOMIZATION UI
==================================================

The most important settings page should be "Widgets".

Create a visual list similar to:

Widgets

┌──────────────────────────────────────┐
│ ⋮⋮  CPU                         [ON] │
│ ⋮⋮  Memory                      [ON] │
│ ⋮⋮  GPU                         [ON] │
│ ⋮⋮  Fan                         [ON] │
│ ⋮⋮  Network                    [OFF] │
│ ⋮⋮  Disk I/O                    [ON] │
│ ⋮⋮  CPU Cores                  [OFF] │
│ ⋮⋮  Top Processes              [OFF] │
└──────────────────────────────────────┘

Use proper GNOME/Libadwaita switches and rows.

If ordering is supported, show a drag handle.

The user should not need to modify configuration files manually.

==================================================
10. LIVE SETTINGS
==================================================

Changing widget visibility in Preferences should update the extension without requiring a reboot.

Avoid requiring:
- logout
- GNOME Shell restart
- reinstall
- manual dconf commands

Use GSettings signals/listeners to react to changes.

The extension should dynamically:
- add widgets
- remove widgets
- reorder widgets
- update layout

==================================================
11. RESPONSIVE LAYOUT
==================================================

The horizontal panel must work on:

- 1080p
- 1440p
- 4K
- laptop screens

Do not assume a fixed screen resolution.

Use:
- natural widths
- maximum width
- minimum widths
- adaptive columns
- wrapping where necessary

Example:

Large screen:

CPU | RAM | GPU | Network | Disk | Fan

Smaller screen:

CPU | RAM | GPU
Network | Disk | Fan

Do not allow widgets to overlap.

==================================================
12. CPU CORES
==================================================

The current CPU core grid takes a lot of vertical space.

Redesign it.

Possible design:

CPU
────────────────────────
6.4%       64°C

Core usage:

0 ██████  1 ████  2 █████
3 ██      4 █████ 5 ███
6 ████    7 ██     ...

Or a compact mini-grid.

It should be optional through Settings.

==================================================
13. GRAPHS
==================================================

Improve the existing graphs.

Use the existing sparkline implementation where possible.

Graphs should:
- have smooth lines
- use subtle transparency
- avoid excessive colors
- have minimal axes
- animate new samples
- fit inside metric cards
- resize with their parent widget

CPU history should be optional.

Network and Disk graphs should remain lightweight.

==================================================
14. TOP PROCESSES
==================================================

Keep Top Processes as an optional widget.

When enabled:

Top Processes

Firefox              18.2%
gnome-shell            7.4%
code                    5.8%

Use a compact design.

Do not constantly destroy and recreate rows.

Reuse existing rows where possible.

==================================================
15. PERFORMANCE
==================================================

This is a GNOME Shell extension.

Performance is extremely important.

DO NOT:
- create unnecessary polling loops
- constantly rebuild the entire popover
- recreate every widget on every telemetry update
- animate hidden widgets
- use expensive effects continuously
- perform heavy Rust calls unnecessarily
- introduce memory leaks

The telemetry daemon should remain responsible for hardware collection.

The extension should mainly handle presentation.

Reuse the existing architecture.

==================================================
16. GSETTINGS
==================================================

Extend the existing GSettings schema.

Do not create duplicate configuration mechanisms.

Possible keys:

panel-layout
enabled-widgets
widget-order
glass-enabled
glass-opacity
corner-radius
animations-enabled
animation-speed
show-graphs
show-cpu-cores
show-processes
poll-interval
history-length

Use appropriate GSettings types.

Make sure schema compilation works.

Provide sensible defaults.

Do not break existing settings.

If changing an existing key, preserve backwards compatibility when possible.

==================================================
17. CODE QUALITY
==================================================

Keep the code modular.

Avoid putting everything inside extension.js.

If necessary create files such as:

extension/
├── extension.js
├── widgets/
│   ├── widget-registry.js
│   ├── metric-card.js
│   ├── cpu-widget.js
│   ├── memory-widget.js
│   ├── gpu-widget.js
│   ├── fan-widget.js
│   ├── network-widget.js
│   ├── disk-widget.js
│   ├── battery-widget.js
│   ├── history-widget.js
│   └── processes-widget.js
├── ui/
│   ├── glass-panel.js
│   ├── metric-layout.js
│   └── animations.js
├── ring_gauge.js
├── sparkline.js
├── prefs.js
├── schemas/
└── stylesheet.css

Only introduce files when they genuinely improve maintainability.

==================================================
18. PRESERVE EXISTING FUNCTIONALITY
==================================================

Do not break:

- CPU telemetry
- RAM telemetry
- GPU telemetry
- fan telemetry
- network telemetry
- disk telemetry
- battery detection
- temperature detection
- top processes
- history
- alerts
- pause telemetry
- compact mode
- sensor reinitialization
- systemd daemon
- Unix socket communication
- suspend recovery
- lock-screen behavior

The redesign must sit on top of the existing functionality.

==================================================
19. DEBUGGING AND VALIDATION
==================================================

Before finishing:

1. Inspect existing files.
2. Identify the current UI architecture.
3. Identify current GSettings schema.
4. Identify current widget implementations.
5. Implement the redesign incrementally.
6. Run the existing Rust tests.
7. Build the extension.
8. Compile GSettings schemas.
9. Check JavaScript syntax/errors.
10. Check for GNOME Shell runtime errors.
11. Verify settings are persisted.
12. Verify enabling/disabling widgets works.
13. Verify the popover still opens/closes correctly.
14. Verify the daemon still works.
15. Verify the extension survives GNOME Shell reload where supported.

Use the repository's existing Makefile/install/test commands.

==================================================
20. IMPORTANT IMPLEMENTATION RULE
==================================================

Do not blindly implement this from the description.

First inspect the repository and understand how the existing code works.

Then make a concrete implementation plan.

Then implement the changes.

Do not stop after creating a plan.

Actually modify the project.

After implementation, review your own changes and fix:
- syntax errors
- GSettings schema errors
- layout issues
- memory leaks
- animation performance problems
- GNOME Shell API incompatibilities

==================================================
FINAL UX GOAL
==================================================

When the user clicks the top-panel monitor capsule, the experience should look approximately like:

       ┌─────────────────────────────────────────────────────────────┐
       │                                                             │
       │   CPU          MEMORY         GPU          NETWORK          │
       │   6.4%        3.9 GB         0%           ↓ 0 KB/s         │
       │   64°C        16.8%          55°C         ↑ 0 KB/s         │
       │   ╭─────╮     ╭─────╮        ╭─────╮      ╭─────╮          │
       │   │graph│     │graph│        │graph│      │graph│          │
       │   ╰─────╯     ╰─────╯        ╰─────╯      ╰─────╯          │
       │                                                             │
       │   FAN          DISK I/O      TEMPERATURE    BATTERY         │
       │   2580 RPM     R 0 KB/s      64°C           47%             │
       │                W 180 KB/s                                    │
       │                                                             │
       └─────────────────────────────────────────────────────────────┘

With:

- premium dark Liquid Glass appearance
- translucent layered surfaces
- smooth spring-like animation
- smooth changing values
- compact metric cards
- optional widgets
- configurable widget order
- professional Libadwaita settings
- no unnecessary telemetry overhead
- no breaking changes to the Rust backend

The result should feel like a polished GNOME extension that takes inspiration from
modern macOS system UI, rather than a basic GNOME popup.

Do not merely make the existing vertical card wider.

Actually redesign the information hierarchy and component layout.