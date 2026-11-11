// Tailwind 樣式設定：與原本 index.html 裡 CDN 的 tailwind.config 相同
// 改了網頁上的 class 後，執行 ./build-css.sh 重新產生 tailwind.css
module.exports = {
  content: ["./index.html", "./*.js"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        display: ["Outfit", "sans-serif"],
      },
    },
  },
};
