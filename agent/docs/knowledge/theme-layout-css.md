# Theme, Layout, and CSS Architecture

FileMaker's visual styling system is a three-tier cascade: **theme CSS** provides the base styles, **layout parts** can override the part-level background, and **individual layout objects** can override any property via `LocalCSS`. Understanding this hierarchy is essential for extracting the actual visual appearance of a layout.

---

## The cascade

```
Theme CSS (base)         <-- defines every named style class
  |
  v
Layout Part CSS          <-- overrides part background/gradient
  |
  v
Object LocalCSS          <-- per-object overrides (inline)
```

A layout is associated with exactly one theme via `<LayoutThemeReference>`. The theme defines all named style classes (e.g., "Card", "Field Label", "Navigation Background") with their full CSS properties. A layout object references a style class by UUID, and its `LocalCSS` block contains only the **overrides** — properties that differ from the theme default. An empty `LocalCSS` CDATA block (`{ }`) means the object inherits 100% from the theme.

### Theme files

Theme CSS lives in `xml_parsed/themes/{solution}/{theme_name} - ID {N}.xml`. Each theme XML contains a single `<CSS>` element with the full stylesheet for all named classes. Theme files range from 2K-10K lines depending on the number of styles.

The theme's class UUIDs are **different** from the layout's `LocalCSS` UUIDs. The theme uses its own namespace (e.g., `FM-DC7DE56F-...` for "Card") while the layout uses a local namespace (e.g., `FM-9AC3DAA0-...` for the same "Card" style). The mapping is by `displayName`, not by UUID.

### Layout Part CSS

Each layout part (Top Navigation, Header, Body, Footer, etc.) can have its own background styling defined either inline or via the theme's part-level CSS. The `<Definition>` element within a part can contain a `<LocalCSS>` block. Standard FM themes like Apex Blue use colored backgrounds on the Top Navigation part (the blue bar).

### Object LocalCSS

Every layout object (`<LayoutObject>`) can have a `<LocalCSS>` element with two key attributes:

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `name` | The style class UUID (links to theme) | `FM-9AC3DAA0-5B7A-40E1-A41A-42F7137AFEAC` |
| `displayName` | Human-readable style name | `"Card"`, `"Field Label"`, `"Navigation Background"` |

The CDATA content is FM-flavoured CSS containing only overrides. If the CDATA body is just `{ }`, the object uses pure theme defaults.

---

## CSS format

FileMaker uses a WebKit-derived CSS syntax with FM-specific extensions.

### Selectors

```css
self.FM-9AC3DAA0-...:normal .self { ... }    /* base state */
self.FM-9AC3DAA0-...:hover .self { ... }     /* hover state */
self.FM-9AC3DAA0-...:pressed .self { ... }   /* pressed/active state */
self.FM-9AC3DAA0-...:normal .text { ... }    /* text within the object */
self.FM-9AC3DAA0-...:normal .inner_border { ... }  /* inner border */
```

The pseudo-class (`:normal`, `:hover`, `:pressed`) controls state, and the descendant class (`.self`, `.text`, `.inner_border`) targets the component. Only `.self` carries background/border; `.text` carries font/color.

### Key visual properties

| CSS Property | What it controls | Notes |
|---|---|---|
| `background-color` | Fill color | Always `rgba(R%, G%, B%, A)` using percentages (0-100%) |
| `background-image` | Gradients | Uses `-webkit-gradient(linear, ...)` with `from()` and `to()` |
| `color` | Text color | Same `rgba(R%, G%, B%, A)` format |
| `font-size` | Text size | In `pt` (points) |
| `border-*-width/style/color` | Borders | Each side independently |
| `border-*-radius` | Corner rounding | In `pt` |
| `box-shadow-persist` | Shadow effect | FM-specific; format: `Xpt Ypt Rpt Spt rgba(...)` |
| `padding-*` | Internal spacing | Each side independently |

### FM-specific CSS extensions

| Property | Purpose | Example |
|---|---|---|
| `-fm-font-family(Name,PostScriptName)` | Font specification | `-fm-font-family(Arial,ArialMT)` |
| `-fm-underline` | Text underline | `-fm-underline: underline` |
| `-fm-icon` | Built-in icon name | `-fm-icon: checkmark` |

### RGBA colour format

FM always uses percentage values for RGB channels:

```css
rgba(100%, 100%, 100%, 1)        /* white, fully opaque */
rgba(0%, 0%, 0%, 0.4)            /* black at 40% opacity (overlay shade) */
rgba(3%, 18.1%, 30%, 1)          /* dark navy #072E4C */
rgba(100%, 15.3%, 7.1%, 1)       /* red-orange accent #FF2712 */
```

To convert to hex: `channel_hex = int(percentage * 255 / 100)`.

---

## Anonymous inline overrides

Objects can have `LocalCSS` blocks with **empty names** (`name=""`, `displayName=""`). These are anonymous inline overrides not tied to any theme class. They appear frequently on:

- Button bar segments (each segment can override the bar's base style)
- Conditional formatting states
- Objects with hover/pressed state overrides

These anonymous blocks contain the **actual CSS properties** while the named block may be empty. When extracting visual data, both must be checked.

---

## Icons in layout XML

Buttons and button bar segments can contain SVG icons encoded as base64 within the XML:

```xml
<IconData type="1" size="17">
  <BinaryData>
    <StreamList>
      <Stream name="MAIN" type="id" size="4">SVG </Stream>
      <Stream name="SVG " type="Base64" size="921">PD94bWwg...</Stream>
      <Stream name="GLPH" type="Hex" size="1">01</Stream>
      <Stream name="FNAM" type="Hex" size="32">...</Stream>
    </StreamList>
  </BinaryData>
</IconData>
```

| IconData attribute | Values | Meaning |
|---|---|---|
| `type` | `0` = none, `1` = custom SVG, `4` = FileMaker built-in icon | Icon source |
| `size` | Integer | Display size in points |

The `SVG ` stream (note the trailing space in the name) contains base64-encoded SVG XML. These SVGs typically use a `class="fm_fill"` on the root `<g>` element — the fill colour is applied by the CSS `color` property at runtime, not baked into the SVG.

The `FNAM` stream contains the icon's filename hash, and `GLPH` is a glyph index (relevant for built-in icons).

---

## Object stacking order

Every layout object has a `key` attribute — a monotonically increasing integer that represents its **position in the rendering stack**. Lower key values are drawn first (behind). Higher key values are drawn on top.

This is critical for understanding layered layouts:

- A **background rectangle** (low key) behind a portal (higher key) at the same bounds is a visual container
- An **overlay button** (very high key) covering the full layout is a modal backdrop
- **Grouped buttons** overlaying fields are click targets that sit on top of the field display

The `key` value combined with bounds comparison reveals which objects are backgrounds, foregrounds, and overlays without needing to see the rendered layout.

---

## The displayName as semantic signal

The `displayName` attribute is the **developer's chosen name** for a style class within the theme editor. These names vary across solutions but often carry semantic meaning:

| Convention | Example displayNames | What they signal |
|---|---|---|
| Role-based | "Card", "Field Label", "Navigation Background" | Object purpose |
| Color-coded | "c_color_g1", "Color EAB464", "White" | Pure color fill |
| Component-based | "In-Tab Portal", "Pill Field", "Top Line Only" | Visual treatment |
| Function-based | "Icon - Function (Red Hover)", "Edit Records Button" | Interactive behavior |
| Developer tooling | "Developer Text", "Dev portal", "Debug button" | Hidden dev elements |
| Positional | "Top Tier", "Header Strip Buttons", "Column header" | Layout zone hint |

A `displayName` of `""` (empty) indicates an anonymous override with no theme class — the CSS is entirely inline.

---

## Practical extraction strategy

When building a visual profile of a layout:

1. **Start with `LocalCSS` on each object** — extract `displayName` (semantic role) and any inline CSS properties (overrides)
2. **For empty inline CSS** — the object inherits from the theme. The `displayName` is the lookup key into the theme XML
3. **For anonymous overrides** (`displayName=""`) — the inline CSS IS the style; there is no theme fallback
4. **To resolve theme-level colors** — grep the theme XML (`xml_parsed/themes/{solution}/`) for the `displayName` and read the CSS block that follows
5. **For part backgrounds** — check the part's `<Definition>` `<LocalCSS>` and the theme's part-level CSS

The `layout_to_summary.py` script extracts `displayName` as `styleName` and key visual properties as `visuals` (bgColor, textColor, fontSize, fontFamily, borderRadius, bgGradient) from inline CSS. These are available in the summary JSON without needing to read the full layout XML.

---

## References

| Name | Type | Local doc | Claris help |
|------|------|-----------|-------------|
| Get (LayoutName) | function | `agent/docs/filemaker/functions/get/getlayoutname.md` | [get-layoutname](https://help.claris.com/en/pro-help/content/get-layoutname.html) |
| LayoutObjectNames | function | `agent/docs/filemaker/functions/design/layoutobjectnames.md` | [layoutobjectnames](https://help.claris.com/en/pro-help/content/layoutobjectnames.html) |
| GetLayoutObjectAttribute | function | `agent/docs/filemaker/functions/design/getlayoutobjectattribute.md` | [getlayoutobjectattribute](https://help.claris.com/en/pro-help/content/getlayoutobjectattribute.html) |
