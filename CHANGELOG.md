# 版本说明

当前模块名仍是 `local/transcript_cut`，版本 `0.1.0`。在作者确认官方 Mooncakes 名称之前，不要执行 `moon publish`。

## 0.1.0（未发布到注册表）

面向其他 MoonBit 项目复用的剪辑核心，已验证 `--target js` 与 `--target wasm-gc`。

- 用 `execute` / `plan` 根据半开微秒区间计算删除求补、保留段、字幕重排与三类建议（口头禅、重复句、长停顿）；建议带可解释的 `reason`。停顿理由会区分片头与相邻两句；英文口头禅和重复句匹配忽略大小写，理由保留原词大小写。
- `duration_us` 是容器时长，不是某一路视频或音频流的时长。探测结果里的 `video_duration_us` / `audio_duration_us` 只用于展示与校验，不改变该合同。
- 提供双向时标映射（`Plan::source_to_output` / `Plan::output_to_source`），以及区间、操作、保留段和计划查询辅助方法。完整列表见 [README 的核心 API 一节](README.md#moonbit-核心库-api)。
- 最小可运行示例在 `examples/minimal`：

  ```bash
  moon run examples/minimal --target js
  moon run examples/minimal --target wasm-gc
  ```

- Node / 浏览器宿主仍通过 `dispatch` 调用同一份核心；JS 产物只导出该入口。
