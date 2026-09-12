/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#f4f1ec",
          100: "#e6ddcf",
          200: "#cdb99f",
          300: "#b2946f",
          400: "#98764e",
          500: "#7c5e3c", // timber brown
          600: "#654a30",
          700: "#503a26",
          800: "#3b2b1c",
          900: "#271c13",
        },
        forest: {
          500: "#3f6b4a",
          600: "#335a3c",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
