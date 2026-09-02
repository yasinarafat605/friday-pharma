# Friday Pharma brand assets

Everything here is rebuilt as vector artwork, so every size is sharp. The SVG
files are the masters. Regenerate any raster size from them rather than scaling
up a PNG.

## What is in each folder

### logo
| File | Use it for |
| --- | --- |
| `friday-pharma-mark.svg` | The mark on its own, full colour, for light backgrounds |
| `friday-pharma-mark-white.svg` | The mark in flat white, for dark or photo backgrounds |
| `friday-pharma-mark-ink.svg` | The mark in flat ink, for one colour printing |
| `friday-pharma-logo-horizontal.svg` | Main lockup: mark, name and tagline in a row |
| `friday-pharma-logo-horizontal-dark.svg` | Same lockup for dark backgrounds |
| `friday-pharma-logo-stacked.svg` | Mark above the name, for narrow spaces |
| `friday-pharma-logo-stacked-dark.svg` | Same, for dark backgrounds |
| `*.png` | Ready made raster copies at 2400px and 1600px wide |

### icon
App icon on the brand navy tile, exported at every size the web and Android
need, plus `favicon.ico` with six sizes inside it.

`icon-maskable-*.png` has extra padding so Android can crop it to a circle,
squircle or rounded square without cutting the mark.

### resources
Source files for `npx capacitor-assets generate`. Copy these into the project
`resources/` folder before generating Android icons.

### color
The palette as a picture, as CSS custom properties and as JSON.

## The palette

| Name | Hex | Where it belongs |
| --- | --- | --- |
| Ink | `#0A1D37` | Body text, the icon tile, dark surfaces |
| Deep blue | `#1E3A8A` | The lower part of the mark, deep accents |
| Blue | `#2563EB` | Links, the middle leaf, primary actions |
| Green | `#10B881` | The word Pharma, the cross, success states |
| Mint | `#34D399` | Highlights and gradient ends |
| Line | `#E5E7EB` | Borders and dividers |
| White | `#FFFFFF` | Page background |

## Typeface

Poppins. Bold for the name, Medium for the tagline. The wordmark files have the
letters converted to outlines, so they render correctly even where Poppins is
not installed.

## Rules that keep the logo looking right

1. Keep clear space around the lockup equal to the height of the cross in the mark.
2. Never stretch it. Scale width and height together.
3. Never recolour the mark by hand. Use the white or ink file instead.
4. Never put the light lockup on a dark background. Use the dark variant.
5. The smallest safe size for the full lockup is 120px wide. Below that, use the
   mark on its own.

## Tagline

Manage. Grow. Care.
