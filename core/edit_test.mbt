///|
test "typed MoonBit API trims and remaps a caption" {
  let plan = @core.execute({
      duration_us: 6000000L,
      spans: [
        { id: "kept", start_us: 4000000L, end_us: 6000000L, text: "保留", },
      ],
      history: { operations: [], cursor: 0, },
      action: "apply",
      operation: Some({
        kind: "cut",
        span_id: "",
        start_us: 1000000L,
        end_us: 3000000L,
        text: "",
      }),
    }).plan
  assert_eq(plan.kept.length(), 2)
  assert_eq(plan.kept[1].output_start_us, 1000000L)
  assert_eq(plan.output_duration_us, 4000000L)
  assert_eq(plan.captions[0].start_us, 2000000L)
  assert_eq(plan.source_to_output(4000000L), Some(2000000L))
  assert_eq(plan.source_to_output(1000000L), None)
  assert_eq(plan.source_to_output(6000000L), None)
  assert_eq(plan.output_to_source(0L), Some(0L))
  assert_eq(plan.output_to_source(1000000L), Some(3000000L))
  assert_eq(plan.output_to_source(2000000L), Some(4000000L))
  assert_eq(plan.output_to_source(-1L), None)
  assert_eq(plan.output_to_source(4000000L), None)
  assert_eq(plan.output_to_source(5000000L), None)
}

///|
test "suggest detects expanded filler words, repeats, and long pauses" {
  let result = @core.execute({
    duration_us: 20000000L,
    spans: [
      { id: "s1", start_us: 0L, end_us: 1000000L, text: "嗯", },
      { id: "s2", start_us: 1000000L, end_us: 2000000L, text: "那个", },
      { id: "s3", start_us: 2000000L, end_us: 3000000L, text: "就是", },
      { id: "s4", start_us: 3000000L, end_us: 4000000L, text: "对", },
      { id: "s5", start_us: 4000000L, end_us: 5000000L, text: "然后", },
      { id: "s6", start_us: 5000000L, end_us: 6000000L, text: "这个", },
      { id: "s7", start_us: 6000000L, end_us: 7000000L, text: "所以说", },
      { id: "s8", start_us: 7000000L, end_us: 8000000L, text: "怎么说", },
      { id: "s9", start_us: 8000000L, end_us: 9000000L, text: "对对对", },
      { id: "s10", start_us: 9000000L, end_us: 10000000L, text: "um", },
      {
        id: "s11",
        start_us: 10000000L,
        end_us: 11000000L,
        text: "正常句子",
      },
      {
        id: "s12",
        start_us: 11000000L,
        end_us: 12000000L,
        text: "正常句子",
      },
      // 12s to 14.8s gap = 2.8s > 1.8s threshold → pause
      { id: "s13", start_us: 14800000L, end_us: 16000000L, text: "继续", },
    ],
    history: { operations: [], cursor: 0, },
    action: "plan",
    operation: None,
  })
  let fillers = result.suggestions.filter(fn(s) { s.kind == "filler" })
  let repeats = result.suggestions.filter(fn(s) { s.kind == "repeat" })
  let pauses = result.suggestions.filter(fn(s) { s.kind == "pause" })
  // All expanded Chinese fillers + um should be detected
  assert_true(fillers.length() >= 9)
  // "正常句子" repeated twice
  assert_eq(repeats.length(), 1)
  assert_eq(repeats[0].span_id, "s12")
  // 2.8s gap should produce a pause suggestion
  assert_eq(pauses.length(), 1)
  assert_eq(pauses[0].span_id, "s13")
}
