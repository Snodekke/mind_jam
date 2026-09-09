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

## Подготовка к сборке

Все команды ниже начинаются из корня репозитория `mind_jam`. Собирайте Windows
на Windows, Arch на Arch, а Ubuntu/Debian — в соответствующей системе или VM.
Инструкции рассчитаны на x86_64 (Windows x64).

Нужны Node.js 22.12+ в ветке 22, pnpm 10 и актуальный Rust stable (Cargo).
Node.js можно установить с [официального сайта](https://nodejs.org/en/download),
Rust — через [rustup](https://rustup.rs/). После установки Node.js:

```sh
npm install --global pnpm@10
node --version
pnpm --version
rustc --version
cargo --version
```

Перед выпуском выставьте одинаковую версию в `desktop/package.json`,
`desktop/src-tauri/Cargo.toml` и `desktop/src-tauri/tauri.conf.json`.
Сейчас в package.json указана `0.1.1`, а в двух остальных файлах — `0.1.0`.
Имена установщиков Tauri берутся из конфигурации Tauri, Arch-архива — из package.json.

Команды ниже создают `releases/` в корне репозитория и копируют туда результаты
успешной сборки. Сам Tauri пишет в `desktop/src-tauri/target/`, а существующий
Arch-скрипт — в `release/` (без `s`). Шаг копирования обязателен. При повторной
сборке артефакты с тем же именем заменяются. Примеры предполагают стандартный
каталог Cargo target, без переопределения `CARGO_TARGET_DIR`.

## Сборка для Windows x64

Установите общие инструменты из раздела выше, а также:

- Microsoft C++ Build Tools с workload `Desktop development with C++` и Windows SDK;
- Microsoft Edge WebView2 Runtime.

Подробности: [зависимости Tauri для Windows](https://v2.tauri.app/start/prerequisites/#windows).
После установки откройте новый PowerShell в корне репозитория.

### NSIS-установщик и исполняемый файл

```powershell
$ErrorActionPreference = "Stop"
rustup target add x86_64-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { throw "Не удалось установить Rust target" }
Set-Location desktop
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "Не удалось установить зависимости" }
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "Ошибка сборки" }
New-Item -ItemType Directory -Force ../releases/windows-x64 | Out-Null
Copy-Item src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe ../releases/windows-x64/
Copy-Item src-tauri/target/x86_64-pc-windows-msvc/release/desktop.exe ../releases/windows-x64/mind-jam.exe
Set-Location ..
```

Результат: `releases/windows-x64/*-setup.exe` для установки и
`releases/windows-x64/mind-jam.exe` для запуска без установщика (нужен WebView2).
Игровые паки в сборку не входят.

### MSI, если нужен именно этот формат

Из корня репозитория, после установки зависимостей предыдущим блоком:

```powershell
Set-Location desktop
pnpm tauri build --target x86_64-pc-windows-msvc --bundles msi
if ($LASTEXITCODE -ne 0) { throw "Ошибка сборки MSI" }
New-Item -ItemType Directory -Force ../releases/windows-x64 | Out-Null
Copy-Item src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi ../releases/windows-x64/
Set-Location ..
```

MSI собирается на Windows через WiX; в системе должен быть включён компонент
VBSCRIPT. Tauri загружает инструменты упаковки при сборке. Подробнее:
[Windows Installer](https://v2.tauri.app/distribute/windows-installer/).

## Сборка для Arch Linux x86_64

Установите инструменты и системные библиотеки (Rust здесь ставится через pacman;
если уже используете rustup, оставьте установленный через него toolchain):

```bash
sudo pacman -Syu
sudo pacman -S --needed base-devel nodejs-lts-jod pnpm rust pkgconf \
  webkit2gtk-4.1 openssl libappindicator-gtk3 librsvg xdotool \
  alsa-lib pipewire clang zstd gst-plugins-base gst-plugins-good gst-libav
```

Из корня репозитория выполните:

```bash
(
  set -e
  bash scripts/build-arch-portable.sh
  version=$(node -p "require('./desktop/package.json').version")
  mkdir -p releases/arch-x86_64
  cp "release/mind-jam-${version}-arch-x86_64.tar.zst" releases/arch-x86_64/
)
```

Результат: `releases/arch-x86_64/mind-jam-<версия>-arch-x86_64.tar.zst`.
Это переносимый архив с приложением и инструкцией, не пакет pacman. Скрипт сам
устанавливает frontend-зависимости и включает Arch-вариант с предупреждением
о системных кодеках. GStreamer и игровые паки в архив не включаются.
Установка зависимостей и запуск описаны в начале README.

Такую сборку используйте на Arch, а AppImage для Ubuntu/Debian собирайте
на старой поддерживаемой базе Linux из следующего раздела.

## Сборка для Ubuntu и Debian x86_64

Для Ubuntu используйте Ubuntu 22.04 или выбранную поддерживаемую более новую
версию; для Debian — Debian 12 или более новую. Для переносимого AppImage
предпочтительна Ubuntu 22.04. Сборка на новой системе не гарантирует запуск на
старой из-за версий glibc и других библиотек. `.deb` проверяйте отдельно на
каждом целевом дистрибутиве. См. [AppImage в Tauri](https://v2.tauri.app/distribute/appimage/).

Установите Node.js, pnpm и Rust из раздела подготовки: Node.js из стандартного
репозитория старого дистрибутива может быть слишком старым для Angular 20.
Затем установите зависимости сборки и медиа:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl wget file \
  libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev patchelf xdg-utils libasound2-dev \
  libpipewire-0.3-dev libclang-dev clang \
  gstreamer1.0-tools gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good gstreamer1.0-libav
```

ALSA, PipeWire и Clang нужны нативной звуковой части проекта. Остальные основные
зависимости описаны в [инструкции Tauri](https://v2.tauri.app/start/prerequisites/#linux).

### Установочный пакет .deb

Следующий блок одинаков для Ubuntu и Debian. Имя системы и её версия автоматически
попадут в путь результата, например `releases/ubuntu-22.04-x86_64/` или
`releases/debian-12-x86_64/`.

```bash
(
  set -e
  . /etc/os-release
  release_dir="$(pwd)/releases/${ID}-${VERSION_ID}-x86_64"
  mkdir -p "$release_dir"
  cd desktop
  pnpm install --frozen-lockfile
  pnpm tauri build --bundles deb --config '{"bundle":{"linux":{"deb":{"depends":["gstreamer1.0-plugins-base","gstreamer1.0-plugins-good","gstreamer1.0-libav","libasound2","libpipewire-0.3-0"]}}}}'
  cp src-tauri/target/release/bundle/deb/*.deb "$release_dir/"
)
```

Результат: `.deb` в указанном каталоге `releases/`. Дополнительная конфигурация
через `--config` объявляет зависимости звука и кодеков в пакете, а Tauri добавляет
свои зависимости WebKitGTK. Она применяется только к этой сборке. Подробнее:
[Debian-пакеты Tauri](https://v2.tauri.app/distribute/debian/).

Установка готового пакета (подставьте фактическое имя файла):

```bash
sudo apt install ./releases/ubuntu-22.04-x86_64/имя-пакета.deb
```

На Debian используйте путь `releases/debian-12-x86_64/` с вашей версией системы.
После установки запускайте Mind Jam из меню приложений.

### Переносимый AppImage

Из корня репозитория на Ubuntu build-host:

```bash
(
  set -e
  . /etc/os-release
  release_dir="$(pwd)/releases/${ID}-${VERSION_ID}-x86_64"
  mkdir -p "$release_dir"
  cd desktop
  pnpm install --frozen-lockfile
  pnpm tauri build --bundles appimage
  cp src-tauri/target/release/bundle/appimage/*.AppImage "$release_dir/"
)
```

В `desktop/src-tauri/tauri.conf.json` уже включено
`bundle.linux.appimage.bundleMediaFramework: true`. GStreamer-плагины должны
быть установлены на машине сборки, чтобы упаковщик мог включить их в AppImage.
На Debian команды те же, но полноту упаковки медиа нужно проверять отдельно;
основная база для этого формата — Ubuntu.

Запуск готового файла:

```bash
chmod +x ./releases/ubuntu-22.04-x86_64/*.AppImage
./releases/ubuntu-22.04-x86_64/имя-файла.AppImage
```

Если системе не хватает FUSE, можно распаковать AppImage и запустить его:

```bash
./releases/ubuntu-22.04-x86_64/имя-файла.AppImage --appimage-extract
./squashfs-root/AppRun
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

После сборки проверьте готовые артефакты на целевых ОС: установку, первый запуск,
создание/импорт пака, MP3 и MP4/H.264, таймер, паузу и микрофон. AppImage
проверяйте в чистой VM без вручную установленных GStreamer-плагинов.
Полный перечень проверок находится в [AGENTS.md](AGENTS.md).
