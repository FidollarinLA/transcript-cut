///|
/// 最小示例：在 6 秒容器上剪掉 [1s, 3s)，再把源时标映射到成片时间轴。
/// `duration_us` 是容器时长，不是某一路媒体流的时长。
///
/// 在仓库根目录运行：
///
/// ```bash
/// moon run examples/minimal --target js
/// moon run examples/minimal --target wasm-gc
/// ```
fn main {
  try {
    let history = @core.History::new().apply(
      @core.Operation::cut(1000000L, 3000000L),
    )
    let result = @core.plan(
      6000000L,
      [{ id: "kept", start_us: 4000000L, end_us: 6000000L, text: "保留", }],
      history,
    )
    let plan = result.plan
    println(
      "kept \{plan.kept.length()} segments, output_duration_us=\{plan.output_duration_us}",
    )
    match plan.source_to_output(4000000L) {
      Some(us) => println("source 4000000us -> output \{us}us")
      None => println("source 4000000us was cut")
    }
  } catch {
    @core.Invalid(message) => println("invalid plan: \{message}")
  }
}
