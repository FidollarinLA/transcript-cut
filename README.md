# 文字剪视频

导入本地 MP4，通过 SRT 或本机 Whisper 得到转写稿。点击一句话定位原视频，复听后剪去对应画面和声音，最后导出新的 MP4 和同步 SRT。

## 快速运行

在 Windows 资源管理器双击 **启动文字剪视频.cmd**。服务就绪后会打开默认浏览器，请保持启动窗口开启。再次双击可以重新打开编辑器。

需要 Node.js 22+、MoonBit 工具链，以及 PATH 里的 FFmpeg 和 ffprobe。已验证 MoonBit 0.1.20261104、moonc 0.10.20、Node.js 24.22.1 和 FFmpeg 9.0。FFmpeg 需要含 `libx264`，自动转写还需要含 `whisper` 滤镜。

```powershell
node scripts/build.mjs
node server/index.mjs
```

在浏览器打开 [本机编辑器](http://127.0.0.1:4317)。先点**打开样例**，选择一行，点击**复听**和**剪掉区间**，然后导出。样例是 12 秒测试画面与测试字幕，用来验证剪点、时长及字幕的映射。

按住 Shift 点击另一行可连续选中多句。启用**跳过剪除段**查看粗剪效果。导出前可用撤销、重做和手动切点微调。

导入自己的文件时，使用一条 H.264 视频轨和一条 AAC 音频轨、起点为 0 秒的 MP4。可以导入与视频匹配的 UTF-8 SRT，也可以设置本机 Whisper 模型。点**保存项目**下载转写稿和编辑历史。下次先导入同一个 MP4，再点**恢复项目**。

## 自动转写

确认 `ffmpeg -hide_banner -h filter=whisper` 显示滤镜，再将 `WHISPER_MODEL` 指向本机的 GGML 多语言模型。中文实测使用 [ggml-base-q5_1.bin](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-base-q5_1.bin)。

```powershell
$env:WHISPER_MODEL = (Resolve-Path 'C:/path/to/ggml-base-q5_1.bin').Path
node server/index.mjs
```

Windows 上也可以运行 `./scripts/start-local.ps1 -WhisperModel 'C:/path/to/model.bin'`。已有构建产物时直接启动。独立 SDK 用 `-MoonHome` 指定，修改 MoonBit 源码后加 `-Build` 重新编译。

本机转写使用句段时标。切点穿过字幕句段时，该段会标为需复核并在当前 SRT 中省略。导出保留段至少要达到平均一帧，最多 100 段。编辑器只监听 `127.0.0.1`。任务文件暂存在系统临时目录，可下载后保留。

## 验证与接手

```powershell
node scripts/build.mjs
node --test tests/*.test.mjs
```

- `MOON_BIN` 可指定工具链路径。自带独立工具链且与全局版本并存时，同时设置 `MOON_HOME`。该仓库的运行命令无需安装 npm 依赖。
- 测试设置 `WHISPER_TEST_INPUT` 和 `WHISPER_MODEL` 时，会实际转写指定中文测试片并验证剪辑。`WHISPER_TEST_PATTERN` 可以指定样本应识别出的关键词正则，缺省检查“视频”。
- 可选浏览器验收用 `node tests/browser.mjs`。设置 `PLAYWRIGHT_MODULE` 指向 playwright-core 入口 `index.mjs`，以及 `CHROME_BIN` 指向 Chrome 可执行文件。
