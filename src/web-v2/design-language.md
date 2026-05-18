# Web V2 Design Language

Heddle Web V2 is a dense, quiet developer workbench. It should feel closer to an editor or coding-agent control panel than a SaaS dashboard: text-first, pane-based, inspectable, and calm.

## Token Policy

Use Tailwind v4 `@theme` tokens in `src/web-v2/tailwind.css` as the visual source of truth. Components should use semantic classes such as `bg-background`, `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-accent`, and `text-accent-foreground`.

Do not use raw palette utilities like `bg-slate-900`, `text-blue-300`, or ad hoc hex values in v2 components unless the design language is intentionally extended first.

## Visual Direction

- Neutral dark palette with one restrained accent for selected, active, or focused state.
- Borders and surface contrast define layout; shadows are rare.
- No gradients, glow effects, decorative cards, or marketing-scale typography.
- Radius stays compact: 4-8px for controls and surfaces.
- Typography is compact product UI: 12px metadata, 13-14px navigation/body, 15-16px section headers.
- Monospace is reserved for code, paths, IDs, commands, and numeric trace details.

## Information Architecture

- Left sidebar: main app navigation, session list, and bottom settings entry.
- Center: active work surface.
- Right: contextual inspector for the selected item or workflow.
- Settings is a separate sidebar mode. Workspace management and memory status belong there, not in the main workbench.

Every new surface should decide whether it belongs to the sidebar, center work surface, inspector, or settings before adding component code.
