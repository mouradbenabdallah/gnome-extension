I want you to STOP adding new features.

Use the CURRENT implementation and improve ONLY:
1. Visual design
2. Animations
3. Performance / lag
4. Spacing, sizing and alignment
5. Overall polish

DO NOT add new widgets.
DO NOT add new metrics.
DO NOT add new settings.
DO NOT redesign the functionality.
DO NOT add unnecessary features.

The screenshot I provided shows the current result. Use it as the visual reference for what needs improvement.

==================================================
GOAL
==================================================

I want this existing System Monitor popup to feel like a PREMIUM Apple/macOS-inspired interface.

Think:

- macOS Liquid Glass
- Apple Control Center
- Apple system widgets
- smooth, subtle, physical animations
- elegant spacing
- clean typography
- translucent glass
- minimal borders
- refined shadows
- polished micro-interactions

IMPORTANT:

Do NOT copy Apple's UI exactly.

Use Apple's level of polish and animation quality as inspiration.

Keep it native to GNOME.

==================================================
1. FIX THE BIGGEST PROBLEM FIRST: LAG
==================================================

The current popup is VERY laggy.

Performance is now the highest priority.

Before changing the visual design further, inspect why the extension is lagging.

Profile / inspect:

- extension.js
- popup creation
- metric widgets
- sparklines
- CPU core rendering
- process list updates
- telemetry polling
- GJS main-thread work
- Clutter actors
- Cairo drawing
- CSS effects
- animations
- signal connections
- timers
- GLib timeouts
- GSettings listeners

Find the actual causes instead of guessing.

==================================================
2. DO NOT REBUILD THE UI EVERY UPDATE
==================================================

This is extremely important.

Telemetry updates must NOT cause:

- destroying the entire popup
- recreating all widgets
- recreating every St.Widget
- rebuilding every graph
- recreating process rows
- rebuilding CPU core widgets
- reapplying stylesheets
- recreating animations

Create the UI ONCE.

Then update only the values that changed.

For example:

BAD:

telemetry update
→ destroy CPU widget
→ create CPU widget
→ destroy RAM widget
→ create RAM widget
→ destroy GPU widget
→ create GPU widget
→ redraw everything

GOOD:

telemetry update
→ CPU label.text = new value
→ CPU progress width = new value
→ RAM label.text = new value
→ update existing sparkline
→ update GPU value
→ update only changed process rows

Use persistent actors.

==================================================
3. THROTTLE VISUAL UPDATES
==================================================

The telemetry backend can collect data frequently.

That does NOT mean the UI needs to redraw everything at the same frequency.

Separate:

TELEMETRY RATE

from

UI UPDATE RATE

Use a reasonable UI refresh rate.

For example:

- telemetry can remain fast
- visual updates around 10–20 FPS are enough
- text values can update less frequently
- graphs can update at a controlled interval

Do not animate every single telemetry sample.

Do not run unnecessary animation frames when the popup is closed.

==================================================
4. STOP ANIMATING HIDDEN UI
==================================================

When the popup is closed:

- stop graph animations
- stop visual interpolation
- stop expensive redraws
- stop unnecessary process updates
- stop Clutter transitions

Telemetry itself can continue if required by the existing functionality.

But the UI should become almost completely idle while hidden.

When opened:

- resume visual updates

==================================================
5. SPARKLINE PERFORMANCE
==================================================

Inspect the sparkline implementation carefully.

Do NOT recreate Cairo surfaces unnecessarily.

Do NOT redraw the entire graph more often than necessary.

Reuse existing drawing resources where possible.

If the graph only receives one new point:

update the existing data buffer and redraw only when necessary.

Do not animate every graph continuously.

The graphs should look smooth, but performance comes first.

==================================================
6. CPU CORES PERFORMANCE
==================================================

The CPU core section currently contains many individual widgets.

Do not create unnecessary actors for every update.

Keep the existing core widgets and update their values.

Avoid expensive transitions on every core.

The core bars should update smoothly but cheaply.

If animation causes noticeable lag:

reduce the animation duration or use simple interpolation.

==================================================
7. TOP PROCESSES PERFORMANCE
==================================================

Do not destroy and recreate the process list every telemetry update.

Reuse existing rows.

Only update:

- process name
- percentage
- ordering when necessary

Do not continuously reorder the list if the change is insignificant.

Throttle process updates more aggressively than CPU/RAM values.

==================================================
8. APPLE-LIKE VISUAL DESIGN
==================================================

Now improve the visual design.

The current popup looks like a normal GNOME application panel.

I want it to feel much more premium.

Use:

- softer rounded corners
- cleaner spacing
- more balanced padding
- subtle translucent background
- glass-like layers
- subtle highlight around edges
- refined shadows
- cleaner separators
- less visual clutter
- better typography hierarchy

Avoid making everything extremely rounded.

The design should be elegant, not cartoon-like.

==================================================
9. LIQUID GLASS
==================================================

Improve the existing glass effect.

Use a dark translucent surface with:

- subtle transparency
- subtle gradient
- subtle inner highlight
- very thin border
- soft shadow
- slight depth between sections

The glass should feel like a physical translucent surface.

Do NOT use extreme blur.

Do NOT use huge shadows.

Do NOT make the background completely opaque.

Do NOT add visual effects that significantly increase GPU/CPU usage.

Performance is more important than a fake blur effect.

==================================================
10. CARD DESIGN
==================================================

The current metric cards feel too much like separate boxes.

Make them feel more integrated.

Reduce unnecessary borders.

Use subtle separation instead of:

"box inside box inside box"

For example:

CPU

10.7%                         72°C

━━━━━━━━━━━━━━━━━━━━

[ subtle graph ]

The metric itself should be the focus.

Use hierarchy:

Title
Large value
Secondary value
Graph

Not:

Title
box
bar
box
box
another box

==================================================
11. TYPOGRAPHY
==================================================

Improve typography.

Use GNOME's native font/system font.

Hierarchy:

System Monitor
→ strong

Metric title
→ small and subtle

Main value
→ larger and brighter

Secondary information
→ smaller and lower contrast

Avoid too many bold labels.

Numbers should be visually dominant.

==================================================
12. SPACING
==================================================

The current layout has inconsistent spacing.

Refine:

- outer padding
- card spacing
- column spacing
- graph padding
- title spacing
- section spacing
- CPU core spacing
- bottom controls spacing

Everything should feel intentionally aligned.

Use a consistent spacing scale.

For example:

4
8
12
16
24

Avoid arbitrary values everywhere.

==================================================
13. PANEL SIZE
==================================================

Keep the current horizontal layout.

Do NOT make it unnecessarily larger.

The popup should feel compact and dense like a polished system utility.

The user should immediately understand:

CPU
RAM
GPU
Network
Disk
Fan
History
Processes
CPU cores

without excessive empty space.

==================================================
14. OPEN ANIMATION
==================================================

Make the popup opening feel like Apple-quality UI.

Animation:

Initial:
- slightly smaller
- slightly transparent
- slightly displaced upward

Then:

opacity → 100%
scale → 100%
position → final

Use smooth easing.

Approximate duration:

180–250 ms

Do NOT use linear animation.

Do NOT make it bounce aggressively.

The animation should feel physical and subtle.

==================================================
15. CLOSE ANIMATION
==================================================

Use a short reverse animation.

Approximately:

120–180 ms

It should disappear smoothly rather than simply vanishing.

==================================================
16. VALUE ANIMATION
==================================================

When:

CPU:
10.7 → 12.3

RAM:
3.1 → 3.3

Fan:
4033 → 4100

do NOT instantly replace the visual value if interpolation is practical.

Use lightweight interpolation.

But:

IMPORTANT:

Never create a new animation object every telemetry update.

Reuse animation mechanisms or implement a lightweight interpolation system.

If interpolation causes lag, prioritize performance and reduce it.

==================================================
17. PROGRESS BARS
==================================================

Progress bars should smoothly move.

Avoid sudden jumps.

Use subtle transitions.

Do not animate indefinitely.

Do not restart a CSS transition unnecessarily on every update.

==================================================
18. GRAPH ANIMATION
==================================================

Graphs should feel alive but subtle.

When a new sample arrives:

smoothly introduce it.

Do not constantly animate the entire graph.

Do not create a continuous 60 FPS graph animation.

A graph update should be cheap.

==================================================
19. HOVER EFFECTS
==================================================

If widgets are interactive:

Use subtle hover:

- slightly brighter glass
- subtle border highlight

Do NOT use:

- large scale
- bounce
- excessive glow

Keep it Apple-like.

==================================================
20. SETTINGS / CONTROLS AT BOTTOM
==================================================

DO NOT ADD NEW SETTINGS.

Keep the existing controls:

Pause telemetry
Compact mode
Reinitialize sensors
Settings

But improve their visual design.

They should look like native polished controls.

The current switches and rows feel disconnected from the rest of the panel.

Make them visually consistent with the glass design.

==================================================
21. COLORS
==================================================

Do not introduce a rainbow of colors.

Keep the current semantic colors:

- CPU / normal activity
- memory
- GPU
- network
- disk
- fan
- warnings

But make them more subtle.

Apple-inspired design generally uses color as information, not decoration.

==================================================
22. CSS PERFORMANCE
==================================================

Inspect the stylesheet.

Avoid expensive CSS effects applied to dozens of actors.

Especially investigate:

- excessive shadows
- large blur effects
- multiple gradients
- repeated effects
- unnecessary transitions
- effects applied to every CPU core

Apply expensive visual effects only to the main glass panel when possible.

==================================================
23. GNOME SHELL PERFORMANCE
==================================================

Remember:

This runs INSIDE GNOME Shell.

A performance problem here affects the desktop.

Therefore:

- minimize main-thread work
- minimize actor creation
- minimize redraws
- minimize Cairo operations
- minimize animations
- avoid unnecessary allocations
- clean up signals
- clean up GLib sources
- clean up Clutter transitions
- avoid memory leaks

Do not sacrifice GNOME Shell responsiveness for visual effects.

==================================================
24. NO NEW FEATURES
==================================================

Again:

DO NOT ADD:

- new metrics
- new widgets
- new pages
- new graphs
- new controls
- new settings
- new telemetry
- new backend features

Only polish what already exists.

==================================================
25. IMPORTANT: KEEP CURRENT FUNCTIONALITY
==================================================

Do not break:

- CPU
- RAM
- GPU
- fan
- network
- disk
- temperature
- history
- processes
- CPU cores
- pause telemetry
- compact mode
- sensor reinitialization
- Settings
- Rust telemetry daemon
- GSettings
- existing installation flow

==================================================
26. WORKFLOW
==================================================

First:

1. Inspect the current implementation.
2. Identify the sources of the lag.
3. Explain internally what is causing the performance problems.
4. Fix performance first.
5. Then refine the visual design.
6. Then refine animations.
7. Run tests/build.
8. Review for memory leaks.
9. Review for unnecessary redraws.
10. Review the final UI.

Do not blindly rewrite working code.

Prefer small, targeted changes.

==================================================
27. ACCEPTANCE CRITERIA
==================================================

The result is successful ONLY if:

VISUAL:

- looks significantly more premium
- feels Apple/macOS-inspired
- has a convincing Liquid Glass appearance
- spacing is balanced
- typography is cleaner
- cards feel integrated
- popup feels polished

ANIMATION:

- opening is smooth
- closing is smooth
- values transition smoothly
- bars transition smoothly
- graphs update smoothly
- no excessive bouncing
- no animation jitter

PERFORMANCE:

MOST IMPORTANT:

Opening the popup must feel instant.

Scrolling / interacting must feel instant.

GNOME Shell must remain responsive.

CPU usage of the extension should remain low.

No visible stuttering.

No continuous unnecessary redraws.

No 60 FPS animation loops when nothing is changing.

No recreation of the entire UI on telemetry updates.

==================================================
FINAL INSTRUCTION
==================================================

DO NOT ADD ANYTHING.

DO NOT MAKE THE PROJECT MORE COMPLEX.

Take the UI that exists NOW and make it:

"same functionality + same information + much more beautiful + dramatically smoother + dramatically less laggy."

The priority order is:

1. PERFORMANCE
2. SMOOTHNESS
3. VISUAL POLISH
4. LIQUID GLASS
5. APPLE-QUALITY MICRO-INTERACTIONS

If a visual effect hurts performance, REMOVE THE EFFECT.

A fast and beautiful UI is better than a heavy fake Liquid Glass effect.