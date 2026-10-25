import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        indigo: { DEFAULT: "#1E2B5C", deep: "#141D40", soft: "#E6E9F4" },
        chalk: "#F3F3F0",
        graphite: "#2B2D33",
        fog: "#D9DAD6",
        stitch: "#E8B931",
        madder: "#A33B2B",
        moss: "#3E6B4E",
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", "Georgia", "serif"],
        sans: ["system-ui", "-apple-system", '"Segoe UI"', "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
