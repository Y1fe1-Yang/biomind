/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./frontend/**/*.html", "./frontend/**/*.js"],
  safelist: [
    "h-5", "h-6", "h-7", "h-8", "h-10", "h-12",
    "w-auto", "w-5", "w-6", "w-8", "w-10", "w-12",
    "object-contain", "object-cover",
    "max-h-8", "max-h-12", "max-w-full",
  ],
  theme: { extend: {} },
  plugins: [],
}
