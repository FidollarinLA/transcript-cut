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

在浏览器打开 [本机编辑器](http://127.0.0.1:4317)。先点**打开样例**，选择一行，点击**复听**和**剪掉区间**，然后导出。

> **公开演示样例说明**：仓库自带开箱即用的测试字幕 [`tests/demo.srt`](tests/demo.srt)。点击“打开样例”时，本机服务会通过 FFmpeg `lavfi` 滤镜自动合成一段 12 秒的测试音视频（`testsrc2` 纯色画面 + 440 Hz 正弦波音频），完全由代码生成，不依赖任何第三方版权音视频。若需验证真实普通话语音识别，测试套件亦兼容 Open Speech Repository 的公开授权普通话发音样本（如 `OSR_cn_000_0072_8k.wav`）。

按住 Shift 点击另一行可连续选中多句。启用**跳过剪除段**查看粗剪效果。导出前可用撤销、重做和手动切点微调。

编辑器支持键盘快捷键：
- **空格 / K**：播放或暂停视频。
- **J / L** 或 **← / →**：后退或快进 1 秒。
- **Ctrl+Z / Ctrl+Y**（macOS 对应 Cmd）：撤销与重做剪辑操作。
- **↑ / ↓**：上下切换字幕句段；按住 **Shift** 连续增选多行。
- **Delete / Backspace**：快速剪除当前选区。
- **Escape**：取消当前选区。输入框打字与文字修正弹窗内自动隔离全局快捷键。

导入自己的文件时，使用一条 H.264 视频轨和一条 AAC 音频轨、起点为 0 秒的 MP4。可以导入与视频匹配的 UTF-8 SRT，也可以设置本机 Whisper 模型。点**保存项目**下载转写稿和编辑历史。下次先导入同一个 MP4，再点**恢复项目**。把 MP4、SRT 或项目 JSON 拖进窗口，效果与这三个按钮相同：字幕和项目仍要先有视频，错误显示在顶部状态条。

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

## 能力边界与已知限制

基于实际代码合同与媒体管线实测，本项目首版明确以下能力范围与工程边界：

- **媒体格式支持**：仅支持单条 H.264 视频轨与单条 AAC 音频轨的 MP4 容器格式；流播放起点（`start_time`）必须为 0 秒（非零起点音视频轨道无法保证精准对齐，会被严格拦截并提示转码后导入）；视频时长限制在 1 小时以内、帧率最高 60 fps、编码宽高须为偶数。
- **转写与切点粒度**：当前基于句段级（sentence-level）转写与区间剪切；受限于目前使用的 Whisper 滤镜后端输出精度，暂不支持词级（word-level）高精切点。
- **轨道与机位模式**：单机位（single-cam）、单素材粗剪；暂不支持多机位切换（multi-cam）、多音轨混音、镜头重排（shot rearrangement）或批量处理（batch processing）。
- **切点保护与字幕复核策略**：导出的成片保留片段须至少达到平均 1 帧的时长（避免视频编码器空帧崩溃），单次导出保留片段数上限为 100 段；当切点截断某句字幕时，该字幕会被标记为“需复核”并自动从成片 SRT 中省略，避免将已剪掉音频的残余文字带入字幕。
- **项目存储机制**：支持保存为 `.transcript-cut.json` 项目文件，其中记录原视频 SHA-256 哈希与微秒时长合同；恢复项目时需先载入同一份源 MP4 视频，哈希校验通过后方可还原剪辑历史与文字修饰。

## 项目对标与生态增量

在开源生态中，本项目参考并对照了已有相关实现，其主要差异与增量如下：

- **对标 TranscriptCut (MIT)**：
  - *继承点*：借鉴了“通过带时标文字定位原片、选句复听、删除片段、实时预览、撤销重做”的文字驱动视频粗剪交互范式。
  - *增量*：将原有的剪辑逻辑重构为基于 MoonBit 实现的高性能、类型化不可变核心（`core/`），以微秒半开区间严格计算删除补集；在导出端针对音视频轨时长不一致补齐（音频长于视频时定格末帧对齐总时长）、竖屏手机实拍旋转元数据（自动烘焙 90°/270° 正向像素且消除残留矩阵）以及非均匀可变帧率（VFR 按计划输出起点重算 PTS 避免每剪点累积误差）进行了严格的工程实现与自动化回归覆盖。
- **对标 AutoCut (Apache-2.0)**：
  - *对照*：AutoCut 采用 Python 脚本通过带时间戳的 Markdown/SRT 驱动视频切割，更偏向命令行与批处理工作流。
  - *增量*：本项目提供端到端浏览器可视化界面、实时切段定位时间轴、毫秒级交互预览与键盘快捷键粗剪；核心算法由 MoonBit 编写并编译为极轻量的 JS 与 WebAssembly 双后端产物，脱离对重型 Python 运行时的依赖。
- **对标 MoonTimeline**：
  - *对照*：MoonTimeline 侧重于通用的时间轴数学抽象与 OpenTimelineIO (OTIO) 多轨交换规范。
  - *增量*：本项目剪辑核心针对单素材粗剪场景，提供了零外部依赖的半开区间合并、双向时标投影映射（`source_to_output` / `output_to_source`）、智能修剪候选规则（口头禅、重复句、静音停顿）与 SRT 导出序列化，定位为轻量专用的剪辑规划器，未来可直接作为上游向 MoonTimeline 供给数据进行多轨互操作。

## 验证与接手

完整的本地与 CI 校验流程包含代码格式检查、多目标静态检查、核心测试、官方最小示例运行与媒体集成测试：

```bash
# 1. 代码格式化校验
moon fmt --check

# 2. 静态检查（严格禁止告警，同时验证 JS 与 wasm-gc 两大目标）
moon check --target js --deny-warn
moon check --target wasm-gc --deny-warn

# 3. 核心单元测试（同时覆盖 JS 与 wasm-gc）
moon test --target js
moon test --target wasm-gc

# 4. 运行官方最小示例（校验 JS 与 wasm-gc 双目标输出）
moon run examples/minimal --target js
moon run examples/minimal --target wasm-gc

# 5. 构建核心库并执行媒体集成测试
node scripts/build.mjs
node --test tests/*.test.mjs
# 或者使用 npm 缩写：
npm test
```

- **CI 自动化**：GitHub Actions（`.github/workflows/check.yml`）会在 push 与 PR 时自动执行上述完整的 fmt、check (`js` + `wasm-gc`)、test (`js` + `wasm-gc`)、执行官方最小示例（校验 `js` 与 `wasm-gc` 双目标输出与预期一致）与媒体集成测试。随后用仓库内 12 秒合成样例单独跑无模型浏览器冒烟（`tests/browser.mjs`）。浏览器步骤和媒体测试分开报告，失败时上传页面截图。日常启动仍然不安装 npm 依赖。
- `MOON_BIN` 可指定工具链路径。Linux / macOS 用户若使用官方脚本安装 MoonBit，二进制位于 `~/.moon/bin`；运行上述 `moon` CLI 检查与测试命令前需确保该目录在 `PATH` 中（例如 `export PATH="$HOME/.moon/bin:$PATH"`）。`scripts/build.mjs` 已内置该路径探测，自带独立工具链且与全局版本并存时亦可同时设置 `MOON_HOME`。该仓库的运行命令无需安装额外的 npm 依赖。
- 测试设置 `WHISPER_TEST_INPUT` 和 `WHISPER_MODEL` 时，会实际转写指定中文测试片并验证剪辑。`WHISPER_TEST_PATTERN` 可以指定样本应识别出的关键词正则，缺省检查“视频”。
- 可选浏览器验收用 `node tests/browser.mjs`。设置 `PLAYWRIGHT_MODULE` 指向 playwright-core 入口 `index.mjs`，以及 `CHROME_BIN` 指向可播放 H.264/AAC 的 Chrome。CI 锁定 `playwright-core@1.62.1`。

## MoonBit 核心库 API

`core/` 提供了可独立供其他 MoonBit 项目复用的剪辑核心（已验证 `--target js` 与 `--target wasm-gc`）：

- **计划构建与执行**：
  - `execute(request : Request) -> EditResult raise Invalid`：根据半开微秒区间计算删除求补集、有序保留区间、字幕重算与建议候选。
  - `plan(duration_us : Int64, spans : Array[Span], history : History) -> EditResult raise Invalid`：只读计算剪辑计划，不推进编辑历史。
- **双向时间轴映射**：
  - `Plan::source_to_output(self : Plan, source_us : Int64) -> Int64?`：将源视频微秒时间戳映射到输出时间轴（被删片段及界外返回 `None`）。
  - `Plan::output_to_source(self : Plan, output_us : Int64) -> Int64?`：将成片时间戳反向映射回原始素材时间戳（跨界及界外返回 `None`）。
- **计划与区间状态查询**：
  - `Plan::is_empty(self : Plan) -> Bool`：检查剪辑后是否已无任何保留内容。
  - `Plan::is_deleted(self : Plan, source_us : Int64) -> Bool`：检查源微秒点是否落入删除区间。
  - `Plan::is_covered(self : Plan, start_us : Int64, end_us : Int64) -> Bool`：检查特定半开区间是否完全被剪除。
  - `Plan::is_partial(self : Plan, span_id : String) -> Bool`：检查某句字幕是否被标记为部分切断、需要复核。
  - `Plan::is_span_covered(self : Plan, span : Span) -> Bool` / `Plan::is_suggestion_covered(self : Plan, suggestion : Suggestion) -> Bool`：检查整句或建议区间是否已完全落入删除区。
  - `Plan::find_kept_segment(self : Plan, source_us : Int64) -> Segment?` / `Plan::find_kept_segment_at_output(self : Plan, output_us : Int64) -> Segment?`：按源时标或成片时标查找保留段。
  - `Plan::find_cut(self : Plan, source_us : Int64) -> Interval?`：按源时标查找覆盖该点的删除区间。
  - `Plan::find_caption(self : Plan, span_id : String) -> Span?` / `Plan::find_caption_at(self : Plan, output_us : Int64) -> Span?`：在重排后的字幕里按 ID 或成片时标查找。
  - `Plan::total_deleted_us(self : Plan) -> Int64`：获取所有删除区间的累计微秒总时长。
  - `Plan::validate_output(self : Plan, min_segment_duration_us : Int64, max_segments : Int32) -> Unit raise Invalid`：严格校验导出计划是否合法（非空、不超过最大段数、段长不低于帧间隔）。
  - `Plan::validate_video_frames(self : Plan, frame_times : Array[Int64]) -> Unit raise Invalid` 与顶层 `validate_video_frames(segments, frame_times)`：校验每个保留段至少包含一帧。
  - `find_span_at(spans, source_us)` / `find_span_by_id(spans, id)`：在源字幕列表中按时标或 ID 查找句段。
- **区间、操作、分段与历史**：
  - `merge_intervals(cuts : Array[Interval]) -> Array[Interval]`：将重叠、相邻、无序的半开区间合并为有序不相交区间。
  - `Interval::contains` / `covers` / `overlaps` / `duration` / `intersection` / `adjacent` / `touching_or_overlapping` / `union`：半开微秒区间的集合运算；不相交且不相邻时 `intersection` / `union` 返回 `None`。
  - `Span::to_interval(self : Span) -> Interval`：取句段的半开时标区间。
  - `Operation::cut(start_us, end_us)` / `Operation::correct(span_id, text)`：构造剪除或修字操作；`duration()`、`to_interval()`、`is_cut()`、`is_correct()` 用于检查操作。
  - `Segment::duration` / `contains` / `output_end_us` / `to_interval` / `to_output_interval` / `output_contains` / `source_to_output` / `output_to_source` / `has_frame`：保留段在源时间轴与成片时间轴上的映射和帧存在性检查。
  - `History::new()` / `undo()` / `redo()` / `apply(op)` / `can_undo()` / `can_redo()`：不可变操作历史状态机。
- **字幕重排与智能建议**：
  - `remap_captions(spans, kept, corrections)`：将字幕映射到保留段，自动标记跨切点的需复核句段，应用修改文字并剔除空字幕。
  - `serialize_srt(captions)`：将字幕数组格式化为标准 SRT 字符串。
  - `suggest(spans)`：自动探测口头禅（中英文语气助词，英文忽略大小写）、重复句（标点和字母大小写归一化比对）与静音长停顿（>= 1.8s）候选区间，并输出可解释的建议原因（`reason`，片头或相邻两句会写进停顿理由）。
  - `Suggestion`：包含 `kind`、`span_id`、`start_us`、`end_us` 与 `reason`（例如 `口头禅「那个」`、`重复句「...」`、`片头长停顿 2.0 秒`、`「上一句」与「下一句」之间长停顿 2.0 秒`），支持 `duration()`、`contains(ts)`、`to_interval()` 与 `explain()`。
- 导出的结构体（`Interval`、`Segment`、`Suggestion`、`Plan`、`EditResult` 等）均使用 `pub(all)`，便于外部包直接解构与访问字段。

## Mooncakes 模块发布准备

本项目的核心库已做好发布到 Mooncakes (mooncakes.io) 模块注册表的元数据准备。当前版本说明见 [CHANGELOG.md](CHANGELOG.md)。最小可运行示例如下，模块名仍保持 `local/transcript_cut`，在作者确认官方名称之前不要执行 `moon publish`。

```bash
moon run examples/minimal --target js
moon run examples/minimal --target wasm-gc
```

该示例会在 6 秒容器上剪掉 `[1s, 3s)`，并打印保留段数量、成片时长，以及源时标 `4000000us` 映射后的成片时标。

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
     moon run examples/minimal --target js
     moon run examples/minimal --target wasm-gc
     npm test
     ```
  5. 执行 `moon publish` 完成向 Mooncakes 注册表的正式发布。

## 开源许可与第三方声明

- **开源许可**：本项目基于 MIT 许可证开源。完整的许可证授权条款请参阅项目根目录下的 `LICENSE` 文件。
- **第三方资源与模型隔离**：本项目不包含任何 Whisper 模型权重二进制文件，亦不分发第三方版权音视频。测试集所用音视频均为运行时由 FFmpeg 合成生成；Whisper 模型需由使用者自备。
