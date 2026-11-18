# 文字剪视频

导入本地 MP4，通过 SRT 或本机 Whisper 得到转写稿。点击一句话定位原视频，复听后剪去对应画面和声音，最后导出新的 MP4 和同步 SRT。

## 快速运行

在 Windows 资源管理器双击 **启动文字剪视频.cmd**。服务就绪后会打开默认浏览器，请保持启动窗口开启。再次双击会优先打开已在 4317 端口运行的编辑器；若该端口上的本程序无响应，启动脚本会只结束这个无响应进程并重新启动。PATH 里没有 Node.js 22+ 时，启动脚本会尝试使用已安装的 Codex Windows 运行时。

需要 Node.js 22+、MoonBit 工具链（已验证 `moonc 0.10.20+65efd5b93` / `moon 0.1.20261104`），以及 PATH 里的 FFmpeg 和 ffprobe（已验证 FFmpeg 7.1+ / 9.0）。FFmpeg 需要含 `libx264`，自动转写还需要含 `whisper` 滤镜。Linux / macOS 下若通过官方脚本安装 MoonBit，请确保 `~/.moon/bin` 已加入 `PATH`。

```bash
# 构建 MoonBit 核心为 JS 产物并启动服务
node scripts/build.mjs
node server/index.mjs

# 或使用 npm 脚本：
npm run build
npm start
```

在浏览器打开 [本机编辑器](http://127.0.0.1:4317)。先点**打开样例**，选择一行，点击**复听**和**剪掉区间**，然后导出。样例是 12 秒测试画面与测试字幕，用来验证剪点、时长及字幕的映射。

按住 Shift 点击另一行可连续选中多句。启用**跳过剪除段**查看粗剪效果。导出前可用撤销、重做和手动切点微调。

编辑器支持键盘快捷键：
- **空格 / K**：播放或暂停视频。
- **J / L** 或 **← / →**：后退或快进 1 秒。
- **Ctrl+Z / Ctrl+Y**（macOS 对应 Cmd）：撤销与重做剪辑操作。
- **↑ / ↓**：上下切换字幕句段；按住 **Shift** 连续增选多行。
- **Delete / Backspace**：快速剪除当前选区。
- **Escape**：取消当前选区。输入框打字与文字修正弹窗内自动隔离全局快捷键。

导入自己的文件时，使用一条 H.264 视频轨和一条 AAC 音频轨、起点为 0 秒的 MP4。可以导入与视频匹配的 UTF-8 SRT，也可以设置本机 Whisper 模型。点**保存项目**下载转写稿和编辑历史。下次先导入同一个 MP4，再点**恢复项目**。

## 自动转写

确认 `ffmpeg -hide_banner -h filter=whisper` 显示滤镜，再将 `WHISPER_MODEL` 指向本机的 GGML 多语言模型。中文实测使用 [ggml-base-q5_1.bin](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-base-q5_1.bin)。

```bash
# Linux / macOS
export WHISPER_MODEL="/path/to/ggml-base-q5_1.bin"
node server/index.mjs
```

```powershell
# Windows PowerShell
$env:WHISPER_MODEL = (Resolve-Path 'C:/path/to/ggml-base-q5_1.bin').Path
node server/index.mjs
```

Windows 上也可以运行 `./scripts/start-local.ps1 -WhisperModel 'C:/path/to/model.bin'`。已有构建产物时直接启动。独立 SDK 用 `-MoonHome` 指定，修改 MoonBit 源码后加 `-Build` 重新编译。

> **说明**：本项目仓库不包含任何 Whisper 模型权重二进制文件，亦不内置第三方版权视频素材。模型权重（如 whisper.cpp 的 GGML 格式二进制文件）需由使用者自行从开源渠道获取并指定路径；日常开发与自动化测试均采用代码动态合成的测试音视频。

本机转写使用句段时标。切点穿过字幕句段时，该段会标为需复核并在当前 SRT 中省略。导出保留段至少要达到平均一帧，最多 100 段。编辑器只监听 `127.0.0.1`。任务文件暂存在系统临时目录，可下载后保留。

## 验证与接手

完整的本地与 CI 校验流程包含代码格式检查、多目标静态检查、核心测试与媒体集成测试：

```bash
# 1. 代码格式化校验
moon fmt --check

# 2. 静态检查（严格禁止告警，同时验证 JS 与 wasm-gc 两大目标）
moon check --target js --deny-warn
moon check --target wasm-gc --deny-warn

# 3. 核心单元测试（同时覆盖 JS 与 wasm-gc）
moon test --target js
moon test --target wasm-gc

# 4. 构建核心库并执行媒体集成测试
node scripts/build.mjs
node --test tests/*.test.mjs
# 或者使用 npm 缩写：
npm test
```

- **CI 自动化**：GitHub Actions（`.github/workflows/check.yml`）会在 push 与 PR 时自动执行上述完整的 fmt、check (`js` + `wasm-gc`)、test (`js` + `wasm-gc`) 与媒体集成测试。
- `MOON_BIN` 可指定工具链路径。Linux / macOS 用户若使用官方脚本安装 MoonBit，二进制位于 `~/.moon/bin`；运行上述 `moon` CLI 检查与测试命令前需确保该目录在 `PATH` 中（例如 `export PATH="$HOME/.moon/bin:$PATH"`）。`scripts/build.mjs` 已内置该路径探测，自带独立工具链且与全局版本并存时亦可同时设置 `MOON_HOME`。该仓库的运行命令无需安装额外的 npm 依赖。
- 测试设置 `WHISPER_TEST_INPUT` 和 `WHISPER_MODEL` 时，会实际转写指定中文测试片并验证剪辑。`WHISPER_TEST_PATTERN` 可以指定样本应识别出的关键词正则，缺省检查“视频”。
- 可选浏览器验收用 `node tests/browser.mjs`。设置 `PLAYWRIGHT_MODULE` 指向 playwright-core 入口 `index.mjs`，以及 `CHROME_BIN` 指向 Chrome 可执行文件。

## MoonBit 核心库 API

`core/` 提供了可独立供其他 MoonBit 项目复用的剪辑核心（已验证 `--target js` 与 `--target wasm-gc`）：

- `execute(request : Request) -> EditResult raise Invalid`：根据半开微秒区间计算删除求补集、有序保留区间、字幕重算与口头禅/重复/停顿候选。
- `Plan::source_to_output(self : Plan, source_us : Int64) -> Int64?`：将源视频微秒时间戳映射到输出时间轴（被删片段返回 `None`）。
- `Plan::output_to_source(self : Plan, output_us : Int64) -> Int64?`：将成片时间戳反向映射回原始素材时间戳。
- 导出的结构体（`Interval`、`Segment`、`Suggestion`、`Plan`、`EditResult` 等）均使用 `pub(all)`，便于外部包直接解构与访问字段。

## Mooncakes 模块发布准备

本项目的核心库已做好发布到 Mooncakes (mooncakes.io) 模块注册表的元数据准备。

- **当前本地模块名**：`moon.mod` 中当前命名为 `local/transcript_cut`。在作者的公共 Mooncakes 账号正式确认前，保持本地命名空间以避免抢占他人命名空间。
- **提议但待确认的官方模块名**：提议正式名称为 `fidollarinla/transcript_cut`（或在作者确认公共账号后使用 `<author_username>/transcript_cut`），目前仍为提议与待确认状态（unconfirmed）。
- **待作者确认后的正式发布步骤**（在作者准备好发布且已注册账号后执行，无需提前创建账号或发布）：
  1. 确认已在 [Mooncakes](https://mooncakes.io) 注册账号，并在本地通过 `moon login` 登录。
  2. 将 `moon.mod` 中的 `name = "local/transcript_cut"` 替换为确认的官方模块名（例如 `fidollarinla/transcript_cut`）。
  3. 执行 `moon info` 重新生成接口导出信息（如 `core/pkg.generated.mbti`）。
  4. 运行完整验证套件：
     ```bash
     moon fmt --check
     moon check --target js --deny-warn
     moon check --target wasm-gc --deny-warn
     moon test --target js
     moon test --target wasm-gc
     npm test
     ```
  5. 执行 `moon publish` 完成向 Mooncakes 注册表的正式发布。

## 开源许可与第三方声明

- **开源许可**：本项目基于 MIT 许可证开源。完整的许可证授权条款请参阅项目根目录下的 `LICENSE` 文件。
- **第三方资源与模型隔离**：本项目不包含任何 Whisper 模型权重二进制文件，亦不分发第三方版权音视频。测试集所用音视频均为运行时由 FFmpeg 合成生成；Whisper 模型需由使用者自备。
