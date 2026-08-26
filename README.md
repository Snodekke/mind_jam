# Mind Jam

Mind Jam — локальная десктопная игра на Tauri 2, Angular 20 и Rust. Отдельной
веб-версии, backend, авторизации и аккаунтов у приложения нет.

Готовые сборки не содержат игровых паков. При первом запуске рядом с
приложением создаётся пустая пользовательская папка `packs`. Паки можно создать
во встроенном редакторе либо импортировать через библиотеку игры.

## Arch Linux: установка и запуск готовой сборки

Установите системные зависимости приложения и медиакодеки:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gst-plugins-base gst-plugins-good gst-libav
```

Распакуйте скачанный архив и запустите игру:

```bash
tar --zstd -xf mind-jam-0.1.0-arch-x86_64.tar.zst
cd mind-jam-0.1.0-arch-x86_64
chmod +x mind-jam
./mind-jam
```

После первого запуска в распакованном каталоге появится папка `packs`. Каталог
приложения должен оставаться доступным пользователю для записи.

## Windows: установка и запуск готовой сборки

Запустите `Mind Jam_0.1.0_x64-setup.exe` и пройдите шаги установщика. После
установки Mind Jam запускается из меню «Пуск» или ярлыком рабочего стола.
Установщик использует системный Microsoft Edge WebView2; в актуальных Windows
10 и 11 он обычно уже установлен, а при отсутствии установщик Tauri загрузит
его bootstrapper.

## Локальная разработка

Frontend-команды выполняются из `desktop/`:

```bash
cd desktop
pnpm install --frozen-lockfile
pnpm tauri dev
```

Не запускайте проект через `ng serve` отдельно: Mind Jam предназначен только для
Tauri desktop.

## Сборка для Arch Linux x86_64

Установите инструменты сборки и зависимости:

```bash
sudo pacman -S --needed base-devel nodejs pnpm rust webkit2gtk-4.1 \
  gst-plugins-base gst-plugins-good gst-libav
```

Соберите переносимый архив без игровых паков и без встроенного GStreamer:

```bash
./scripts/build-arch-portable.sh
```

Результат появится в `release/mind-jam-0.1.0-arch-x86_64.tar.zst`. Эта сборка
предназначена для актуального Arch Linux x86_64. Универсальный Linux AppImage
следует собирать на Ubuntu 22.04 с включённым `bundleMediaFramework`.

## Сборка для Windows x64

Предпочтительно собирать NSIS-установщик непосредственно на Windows. Установите:

- Node.js и pnpm;
- Rust stable с целью `x86_64-pc-windows-msvc`;
- Microsoft C++ Build Tools с компонентом `Desktop development with C++`;
- Microsoft Edge WebView2 Runtime.

Затем выполните в PowerShell:

```powershell
cd desktop
pnpm install --frozen-lockfile
rustup target add x86_64-pc-windows-msvc
pnpm tauri build --bundles nsis
```

Установщик будет создан в
`desktop/src-tauri/target/release/bundle/nsis/`. Содержимое `packs/` в него не
включается.

Официально поддерживаемая Tauri cross-сборка NSIS с Linux также возможна, но
является запасным вариантом и требует LLVM, NSIS и `cargo-xwin`:

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
cd desktop
pnpm install --frozen-lockfile
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
```

## Проверки перед выпуском

```bash
cd desktop
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --debug --no-bundle
```

Версии перед релизом должны совпадать в `desktop/package.json`,
`desktop/src-tauri/Cargo.toml` и `desktop/src-tauri/tauri.conf.json`.
