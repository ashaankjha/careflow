import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        canvas: "#F7F5F1",
        surface: "#FFFFFF",
        line: "#E7E3DC",
        ink: { DEFAULT: "#0F1B2D", 2: "#3D4A5C", 3: "#4F5A6A", 4: "#5D6878" },
        accent: { DEFAULT: "#1F5FBF", soft: "#E8F0FB", ink: "#174A96" },
        teal: { DEFAULT: "#0F766E", soft: "#E3F3F1" },
        good: { DEFAULT: "#0B7A43", soft: "#E5F4EC" },
        warn: { DEFAULT: "#A35B00", soft: "#FCF1DF" },
        bad: { DEFAULT: "#B42318", soft: "#FCE9E7" },
        series: { 1: "#2a78d6", 2: "#eb6834", 3: "#1baf7a" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,27,45,0.04), 0 1px 1px rgba(15,27,45,0.03)",
        pop: "0 12px 32px -8px rgba(15,27,45,0.18), 0 2px 6px rgba(15,27,45,0.06)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(2px)" }, to: { opacity: "1", transform: "none" } },
        "slide-in": { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
      },
      animation: { "fade-in": "fade-in 160ms ease-out", "slide-in": "slide-in 200ms ease-out" },
    },
  },
  plugins: [],
} satisfies Config;
