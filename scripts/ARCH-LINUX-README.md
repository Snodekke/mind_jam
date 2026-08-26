# Mind Jam 0.1.0 — Arch Linux x86_64

Эта сборка не содержит игровых паков и GStreamer. При первом запуске игра
создаст пустую папку `packs` рядом с исполняемым файлом.

Установите системные зависимости:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gst-plugins-base gst-plugins-good gst-libav
```

Запустите игру:

```bash
chmod +x mind-jam
./mind-jam
```

Команда установки GStreamer также указана в настройках этой Arch-версии.
