#!/bin/sh
# 重新產生 tailwind.css（網頁 class 有新增或修改時執行）
cd "$(dirname "$0")" && npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify
