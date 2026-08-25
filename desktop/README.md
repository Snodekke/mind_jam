# Mind Jam Desktop

Mind Jam is a Tauri desktop application. Running the Angular frontend directly
in a browser is not supported: packs, audio devices, microphone capture,
display control and application shutdown use native Tauri commands.

## Linux media runtime

On Linux, the desktop WebView uses GStreamer for question audio and video.
The base, good and FFmpeg plugin sets are runtime dependencies of the desktop
package. On CachyOS and Arch Linux, install them before starting the application:

```bash
sudo pacman -S --needed gst-plugins-base gst-plugins-good gst-libav
```

Verify the audio sink, MP4 demuxer and MP3 decoder after installation:

```bash
gst-inspect-1.0 autoaudiosink
gst-inspect-1.0 qtdemux
gst-inspect-1.0 mpg123audiodec
```

Restart `pnpm tauri dev` after installing the packages so WebKit loads the new
plugins.

## Development

Start the application with `pnpm tauri dev`. The Angular development server is
an internal asset server used by the Tauri window, not a supported web version.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) + [Angular Language Service](https://marketplace.visualstudio.com/items?itemName=Angular.ng-template).
