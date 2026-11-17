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
