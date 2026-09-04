// The dashboard's own palette and type (assets/dashboard.css), so the video
// and the page a judge opens afterwards read as one surface.
export const color = {
  ink: "#1c1b18",
  paper: "#fbf9f4",
  rule: "#d9d3c5",
  pass: "#1f6b3a",
  veto: "#9b2c1f",
  mute: "#6b665c",
  accent: "#2a4d7a",
  white: "#ffffff",
} as const;

export const font = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Helvetica Neue", Arial, sans-serif',
  mono: '"SF Mono", Consolas, "Liberation Mono", monospace',
} as const;

export const WIDTH = 1920;
export const HEIGHT = 1080;
