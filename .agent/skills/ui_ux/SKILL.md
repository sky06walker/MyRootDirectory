---
name: Project UI/UX Skills
description: comprehensive guide for maintaining and enhancing the project's UI/UX, including design tokens, component patterns, and theming guide.
---

# UI/UX Skill: MyRootDirectory CV App

This skill provides the guidelines and resources for developing the UI/UX of the CV Application. It encapsulates the design system, theming logic, and best practices for creating a premium, responsive user experience.

## 1. Design System Overview

The project uses a **Theme-Based Architecture** with CSS Variables (Custom Properties).

- **Framework**: React + Vite
- **Styling**: Vanilla CSS with localized variables
- **Themes**: `modern` (Default, Dark/Light auto), `custom` (Print-friendly, Classic)

### 1.1 Design Tokens (CSS Variables)

Always use these variables instead of hardcodig hex values.

| Token                    | Description               | Modern (Light) | Modern (Dark) | Custom    |
| ------------------------ | ------------------------- | -------------- | ------------- | --------- |
| `--color-bg`             | Page Background           | `#f8f9fa`      | `#0f172a`     | `#fdfbf7` |
| `--color-surface`        | Card/Container Background | `#ffffff`      | `#1e293b`     | `#ffffff` |
| `--color-text-primary`   | Main Text                 | `#1a1a1a`      | `#f8fafc`     | `#1c1917` |
| `--color-text-secondary` | Subtitles/Labels          | `#666666`      | `#94a3b8`     | `#57534e` |
| `--color-primary`        | Brand/Action Color        | `#2563eb`      | `#3b82f6`     | `#0f766e` |
| `--color-primary-hover`  | Interactive State         | `#1d4ed8`      | `#60a5fa`     | `#115e59` |
| `--color-border`         | Borders/Dividers          | `#e5e7eb`      | `#334155`     | `#e7e5e4` |

### 1.2 Typography

| Token          | Family              | Usage             |
| -------------- | ------------------- | ----------------- |
| `--font-sans`  | Inter, system-ui... | Modern Theme Body |
| `--font-serif` | Georgia, Serif...   | Custom Theme Body |
| `--font-body`  | _Dynamic_           | Main content font |

**Usage Example:**

```css
.my-new-component {
  background-color: var(--color-surface);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
  font-family: var(--font-body);
}
```

## 2. Component Patterns

### 2.1 Buttons (`.btn`)

Standard action elements.

- **Base Class**: `.btn`
- **Variants**: currently unified via variables.
- **States**: `:hover` is automatically handled by `--color-primary-hover`.

```jsx
<button className="btn">Action</button>
```

### 2.2 Cards (`.card`)

Container for grouped content.

- **Modern**: Shadowed, rounded corners, white/slate background.
- **Custom**: Flat, bottom-bordered, no padding/margin overrides.

```jsx
<div className="card">
  <h3>Card Title</h3>
  <p>Content goes here...</p>
</div>
```

### 2.3 Forms (`.form-group`, `.form-input`)

Standardized input styles.

```jsx
<div className="form-group">
  <label className="form-label">Email Address</label>
  <input type="email" className="form-input" placeholder="you@example.com" />
</div>
```

## 3. Theming & Customization

The app switches themes by setting the `data-theme` attribute on the `<html>` element.

### Adding a New Theme

1. Open `src/styles/index.css`.
2. Define a new data attribute block:
   ```css
   [data-theme="neon"] {
     --color-bg: #000000;
     --color-primary: #00ff00;
     /* ... redefine all tokens */
   }
   ```
3. Update `App.tsx` types to include `'neon'`.

## 4. UX Best Practices (Checklist)

### 4.1 Responsiveness

- [ ] **Mobile First**: Design for small screens, then expand using `@media (min-width: ...)`.
- [ ] **Touch Targets**: Buttons should be at least 44px height.
- [ ] **Containers**: Use `.container` for max-width constraints (800px default).

### 4.2 Accessibility (a11y)

- [ ] **Contrast**: Ensure text on `--color-primary` is readable (White is used by default).
- [ ] **Focus States**: Do not remove `outline` styles unless replacing with a custom accessible focus ring.
- [ ] **Semantic HTML**: Use `<button>`, `<input>`, `<header>` appropriately (don't use `<div>` for clickable actions).

### 4.3 Visual Polish

- **Transitions**: Use `transition: background-color 0.2s` for smooth theme switching.
- **Feedback**: Ensure hover/active states exist for all interactables.
- **Spacing**: Use `rem` units for consistency (1rem = 16px).

## 5. Recommended Workflow for New Features

1. **Check Variables**: Can you use an existing `--color-` variable?
2. **Component Reuse**: Can you use `.card` or `.btn`?
3. **Theme Check**: Does it look good in both `modern` (Dark/Light) and `custom`?
4. **Print Check**: If it's the CV view, does it print correctly? (`@media print` rules).
