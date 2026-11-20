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
      { id: "s13", start_us: 14800000L, end_us: 16000000L, text: "继续", },
    ],
    history: { operations: [], cursor: 0, },
    action: "plan",
    operation: None,
  })
  let fillers = result.suggestions.filter(fn(s) { s.kind == "filler" })
  let repeats = result.suggestions.filter(fn(s) { s.kind == "repeat" })
  let pauses = result.suggestions.filter(fn(s) { s.kind == "pause" })
  assert_true(fillers.length() >= 9)
  assert_eq(fillers[0].reason, "口头禅「嗯」")
  assert_eq(repeats.length(), 1)
  assert_eq(repeats[0].span_id, "s12")
  assert_eq(repeats[0].reason, "重复句「正常句子」")
  assert_eq(pauses.length(), 1)
  assert_eq(pauses[0].span_id, "s13")
  assert_eq(pauses[0].reason, "长停顿 2.8 秒")
}

///|
test "duration_us acts as container duration and bounds all spans and cuts" {
  let dur = 10000000L
  // Plan without cuts preserves container duration exactly
  let res1 = @core.plan(
    dur,
    [{ id: "sp1", start_us: 0L, end_us: dur, text: "整片", }],
    @core.History::new(),
  )
  assert_eq(res1.plan.output_duration_us, dur)
  assert_eq(res1.plan.kept.length(), 1)
  assert_eq(res1.plan.kept[0].start_us, 0L)
  assert_eq(res1.plan.kept[0].end_us, dur)
  assert_eq(res1.plan.total_deleted_us(), 0L)
  assert_false(res1.plan.is_empty())

  // Cut ending exactly at container duration removes tail
  let h = @core.History::new().apply({
    kind: "cut",
    span_id: "",
    start_us: 7000000L,
    end_us: dur,
    text: "",
  })
  let res2 = @core.plan(dur, [], h)
  assert_eq(res2.plan.output_duration_us, 7000000L)
  assert_eq(res2.plan.total_deleted_us(), 3000000L)
  assert_eq(res2.plan.kept.length(), 1)
  assert_eq(res2.plan.kept[0].end_us, 7000000L)

  // Full cut empties plan
  let h_all = @core.History::new().apply({
    kind: "cut",
    span_id: "",
    start_us: 0L,
    end_us: dur,
    text: "",
  })
  let res_empty = @core.plan(dur, [], h_all)
  assert_true(res_empty.plan.is_empty())
  assert_eq(res_empty.plan.output_duration_us, 0L)
  assert_eq(res_empty.plan.total_deleted_us(), dur)
}

///|
test "half-open interval semantics and interval helper methods" {
  let iv = @core.Interval::{ start_us: 1000000L, end_us: 3000000L, }
  assert_eq(iv.duration(), 2000000L)
  assert_false(iv.contains(999999L))
  assert_true(iv.contains(1000000L))
  assert_true(iv.contains(2999999L))
  assert_false(iv.contains(3000000L))

  let inside = @core.Interval::{ start_us: 1500000L, end_us: 2500000L, }
  assert_true(iv.covers(inside))
  assert_false(inside.covers(iv))

  let overlapping = @core.Interval::{ start_us: 2500000L, end_us: 4000000L, }
  assert_true(iv.overlaps(overlapping))
  assert_true(overlapping.overlaps(iv))

  // Touching at boundary is not overlapping in half-open intervals
  let touching = @core.Interval::{ start_us: 3000000L, end_us: 5000000L, }
  assert_false(iv.overlaps(touching))
  assert_false(touching.overlaps(iv))

  // Segment helpers
  let seg = @core.Segment::{
    start_us: 2000000L,
    end_us: 5000000L,
    output_start_us: 1000000L,
  }
  assert_eq(seg.duration(), 3000000L)
  assert_eq(seg.output_end_us(), 4000000L)
  assert_true(seg.contains(2000000L))
  assert_true(seg.contains(4999999L))
  assert_false(seg.contains(5000000L))
  assert_eq(seg.to_interval().start_us, 2000000L)
  assert_eq(seg.to_interval().end_us, 5000000L)

  // Span helpers
  let sp = @core.Span::{
    id: "test",
    start_us: 1000L,
    end_us: 2000L,
    text: "句",
  }
  assert_eq(sp.duration(), 1000L)
  assert_true(sp.contains(1000L))
  assert_false(sp.contains(2000L))
}

///|
test "merge_intervals merges overlapping, adjacent, and subsumed intervals" {
  let cuts : Array[@core.Interval] = [
    { start_us: 8000000L, end_us: 9000000L, },
    { start_us: 2000000L, end_us: 4000000L, },
    { start_us: 3500000L, end_us: 4500000L, },
    { start_us: 4500000L, end_us: 5000000L, },
    { start_us: 2000000L, end_us: 3000000L, },
  ]
  let merged = @core.merge_intervals(cuts)
  assert_eq(merged.length(), 2)
  assert_eq(merged[0].start_us, 2000000L)
  assert_eq(merged[0].end_us, 5000000L)
  assert_eq(merged[1].start_us, 8000000L)
  assert_eq(merged[1].end_us, 9000000L)

  // 1us gap leaves them disjoint
  let non_touching : Array[@core.Interval] = [
    { start_us: 1000000L, end_us: 2000000L, },
    { start_us: 2000001L, end_us: 3000000L, },
  ]
  let m2 = @core.merge_intervals(non_touching)
  assert_eq(m2.length(), 2)

  // Empty returns empty
  assert_eq(@core.merge_intervals([]).length(), 0)
}

///|
test "source_to_output and output_to_source comprehensive boundary and edge cases" {
  // Container 12s, cut [2s, 5s) and [8s, 9s)
  // Kept: [0, 2s) -> out [0, 2s)
  //       [5s, 8s) -> out [2s, 5s)
  //       [9s, 12s) -> out [5s, 8s)
  let plan = @core.execute({
      duration_us: 12000000L,
      spans: [],
      history: {
        operations: [
          {
            kind: "cut",
            span_id: "",
            start_us: 2000000L,
            end_us: 5000000L,
            text: "",
          },
          {
            kind: "cut",
            span_id: "",
            start_us: 8000000L,
            end_us: 9000000L,
            text: "",
          },
        ],
        cursor: 2,
      },
      action: "plan",
      operation: None,
    }).plan

  assert_eq(plan.output_duration_us, 8000000L)
  assert_eq(plan.kept.length(), 3)

  // source_to_output edge cases
  assert_eq(plan.source_to_output(-1L), None)
  assert_eq(plan.source_to_output(0L), Some(0L))
  assert_eq(plan.source_to_output(1999999L), Some(1999999L))
  assert_eq(plan.source_to_output(2000000L), None)
  assert_eq(plan.source_to_output(3500000L), None)
  assert_eq(plan.source_to_output(4999999L), None)
  assert_eq(plan.source_to_output(5000000L), Some(2000000L))
  assert_eq(plan.source_to_output(7999999L), Some(4999999L))
  assert_eq(plan.source_to_output(8000000L), None)
  assert_eq(plan.source_to_output(8500000L), None)
  assert_eq(plan.source_to_output(9000000L), Some(5000000L))
  assert_eq(plan.source_to_output(11999999L), Some(7999999L))
  assert_eq(plan.source_to_output(12000000L), None)
  assert_eq(plan.source_to_output(13000000L), None)

  // output_to_source edge cases
  assert_eq(plan.output_to_source(-1L), None)
  assert_eq(plan.output_to_source(0L), Some(0L))
  assert_eq(plan.output_to_source(1999999L), Some(1999999L))
  assert_eq(plan.output_to_source(2000000L), Some(5000000L))
  assert_eq(plan.output_to_source(4999999L), Some(7999999L))
  assert_eq(plan.output_to_source(5000000L), Some(9000000L))
  assert_eq(plan.output_to_source(7999999L), Some(11999999L))
  assert_eq(plan.output_to_source(8000000L), None)
  assert_eq(plan.output_to_source(8000001L), None)

  // Plan query methods
  assert_true(plan.is_deleted(2000000L))
  assert_true(plan.is_deleted(3000000L))
  assert_false(plan.is_deleted(5000000L))
  assert_true(plan.is_covered(2100000L, 4900000L))
  assert_false(plan.is_covered(1000000L, 3000000L))
}

///|
test "caption remap and SRT serialization with partial overlap and text corrections" {
  let spans : Array[@core.Span] = [
    { id: "s1", start_us: 0L, end_us: 1000000L, text: "完全保留", },
    { id: "s2", start_us: 1500000L, end_us: 2500000L, text: "头部跨切点", },
    { id: "s3", start_us: 2500000L, end_us: 3500000L, text: "完全被剪", },
    { id: "s4", start_us: 3500000L, end_us: 4500000L, text: "尾部跨切点", },
    { id: "s5", start_us: 5000000L, end_us: 6000000L, text: "修改文字", },
    { id: "s6", start_us: 6000000L, end_us: 7000000L, text: "改为空白", },
  ]
  // Kept: [0, 2s) -> out [0, 2s), [4s, 8s) -> out [2s, 6s)
  let kept : Array[@core.Segment] = [
    { start_us: 0L, end_us: 2000000L, output_start_us: 0L, },
    { start_us: 4000000L, end_us: 8000000L, output_start_us: 2000000L, },
  ]
  let corrections = Map([("s5", "修正后的文字"), ("s6", "   ")])
  let (captions, partial) = @core.remap_captions(spans, kept, corrections)

  // s2 and s4 partially overlap the cut [2s, 4s)
  assert_eq(partial.length(), 2)
  assert_eq(partial[0], "s2")
  assert_eq(partial[1], "s4")

  // captions contain s1 and s5 (shifted by -2s)
  assert_eq(captions.length(), 2)
  assert_eq(captions[0].id, "s1")
  assert_eq(captions[0].start_us, 0L)
  assert_eq(captions[0].end_us, 1000000L)
  assert_eq(captions[0].text, "完全保留")

  assert_eq(captions[1].id, "s5")
  assert_eq(captions[1].start_us, 3000000L)
  assert_eq(captions[1].end_us, 4000000L)
  assert_eq(captions[1].text, "修正后的文字")

  // SRT serialization
  let srt = @core.serialize_srt(captions)
  assert_true(
    srt.contains("1\n00:00:00,000 --> 00:00:01,000\n完全保留\n\n"),
  )
  assert_true(
    srt.contains("2\n00:00:03,000 --> 00:00:04,000\n修正后的文字\n\n"),
  )
}

///|
test "history management supports undo, redo, apply branching, and capacity limits" {
  let h0 = @core.History::new()
  assert_eq(h0.cursor, 0)
  assert_eq(h0.operations.length(), 0)
  assert_false(h0.can_undo())
  assert_false(h0.can_redo())

  // Undo at 0 stays at 0
  assert_eq(h0.undo().cursor, 0)

  let op1 : @core.Operation = {
    kind: "cut",
    span_id: "",
    start_us: 0L,
    end_us: 1000000L,
    text: "",
  }
  let op2 : @core.Operation = {
    kind: "cut",
    span_id: "",
    start_us: 1000000L,
    end_us: 2000000L,
    text: "",
  }
  let op3 : @core.Operation = {
    kind: "cut",
    span_id: "",
    start_us: 2000000L,
    end_us: 3000000L,
    text: "",
  }

  let h1 = h0.apply(op1)
  assert_eq(h1.cursor, 1)
  assert_true(h1.can_undo())
  assert_false(h1.can_redo())

  let h2 = h1.apply(op2)
  assert_eq(h2.cursor, 2)
  assert_eq(h2.operations.length(), 2)

  let h_undone = h2.undo()
  assert_eq(h_undone.cursor, 1)
  assert_true(h_undone.can_undo())
  assert_true(h_undone.can_redo())

  // Redo restores cursor
  let h_redone = h_undone.redo()
  assert_eq(h_redone.cursor, 2)
  // Redo at end stays at end
  assert_eq(h_redone.redo().cursor, 2)

  // Branching: applying from cursor 1 truncates op2 and puts op3
  let h_branch = h_undone.apply(op3)
  assert_eq(h_branch.cursor, 2)
  assert_eq(h_branch.operations.length(), 2)
  assert_eq(h_branch.operations[0].end_us, 1000000L)
  assert_eq(h_branch.operations[1].end_us, 3000000L)
}

///|
test "suggestion rules detect fillers with punctuation, repeats, and silence pauses" {
  let spans : Array[@core.Span] = [
    { id: "s1", start_us: 2000000L, end_us: 2500000L, text: "那个...", },
    { id: "s2", start_us: 2600000L, end_us: 3000000L, text: "对！", },
    { id: "s3", start_us: 3100000L, end_us: 3500000L, text: "然后，", },
    { id: "s4", start_us: 3600000L, end_us: 4000000L, text: "you know", },
    { id: "s5", start_us: 4100000L, end_us: 5000000L, text: "这个是正文", },
    {
      id: "s6",
      start_us: 5100000L,
      end_us: 6000000L,
      text: "重复的一句话。",
    },
    {
      id: "s7",
      start_us: 6100000L,
      end_us: 7000000L,
      text: "重复的一句话！",
    },
    // 7s to 9s gap = 2s >= 1.8s threshold
    { id: "s8", start_us: 9000000L, end_us: 10000000L, text: "结尾", },
  ]
  let suggestions = @core.suggest(spans)
  let fillers = suggestions.filter(fn(s) { s.kind == "filler" })
  let repeats = suggestions.filter(fn(s) { s.kind == "repeat" })
  let pauses = suggestions.filter(fn(s) { s.kind == "pause" })

  // Fillers detected
  assert_eq(fillers.length(), 4)
  assert_eq(fillers[0].span_id, "s1")
  assert_eq(fillers[0].reason, "口头禅「那个」")
  assert_eq(fillers[1].span_id, "s2")
  assert_eq(fillers[1].reason, "口头禅「对」")
  assert_eq(fillers[2].span_id, "s3")
  assert_eq(fillers[2].reason, "口头禅「然后」")
  assert_eq(fillers[3].span_id, "s4")
  assert_eq(fillers[3].reason, "口头禅「you know」")

  // Repeat detected ignoring punctuation differences
  assert_eq(repeats.length(), 1)
  assert_eq(repeats[0].span_id, "s7")
  assert_eq(repeats[0].reason, "重复句「重复的一句话」")

  // Pauses detected: initial gap (0 to 2s) and gap between s7 and s8 (7s to 9s)
  assert_eq(pauses.length(), 2)
  assert_eq(pauses[0].span_id, "s1")
  assert_eq(pauses[0].start_us, 250000L)
  assert_eq(pauses[0].end_us, 1750000L)
  assert_eq(pauses[0].reason, "长停顿 2.0 秒")
  assert_eq(pauses[1].span_id, "s8")
  assert_eq(pauses[1].start_us, 7250000L)
  assert_eq(pauses[1].end_us, 8750000L)
  assert_eq(pauses[1].reason, "长停顿 2.0 秒")
}

///|
test "invalid input rejection on execute and Plan validation" {
  // Invalid duration
  let mut caught = false
  try {
    let _ = @core.execute({
      duration_us: 0L,
      spans: [],
      history: @core.History::new(),
      action: "plan",
      operation: None,
    })
  } catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(msg, "视频时长超出支持范围")
    }
  }
  assert_true(caught)

  // Unordered spans
  caught = false
  try {
    let _ = @core.execute({
      duration_us: 5000000L,
      spans: [
        { id: "s1", start_us: 2000000L, end_us: 3000000L, text: "一", },
        { id: "s2", start_us: 1000000L, end_us: 2000000L, text: "二", },
      ],
      history: @core.History::new(),
      action: "plan",
      operation: None,
    })
  } catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(msg, "转写片段应按起点排序，且 ID 唯一")
    }
  }
  assert_true(caught)

  // Duplicate span id
  caught = false
  try {
    let _ = @core.execute({
      duration_us: 5000000L,
      spans: [
        { id: "dup", start_us: 1000000L, end_us: 2000000L, text: "一", },
        { id: "dup", start_us: 2000000L, end_us: 3000000L, text: "二", },
      ],
      history: @core.History::new(),
      action: "plan",
      operation: None,
    })
  } catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(msg, "转写片段应按起点排序，且 ID 唯一")
    }
  }
  assert_true(caught)

  // Span end past duration
  caught = false
  try {
    let _ = @core.execute({
      duration_us: 5000000L,
      spans: [
        { id: "s1", start_us: 1000000L, end_us: 6000000L, text: "越界", },
      ],
      history: @core.History::new(),
      action: "plan",
      operation: None,
    })
  } catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(msg, "区间必须位于视频内，且起点早于终点")
    }
  }
  assert_true(caught)

  // Plan validation checks
  let empty_plan = @core.plan(
      5000000L,
      [],
      @core.History::new().apply({
        kind: "cut",
        span_id: "",
        start_us: 0L,
        end_us: 5000000L,
        text: "",
      }),
    ).plan
  caught = false
  empty_plan.validate_output(40000L, 100) catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(msg, "成片没有保留片段")
    }
  }
  assert_true(caught)

  let normal_plan = @core.plan(5000000L, [], @core.History::new()).plan
  // Max segments limit
  caught = false
  normal_plan.validate_output(40000L, 0) catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(msg, "当前版本最多导出 0 个保留片段")
    }
  }
  assert_true(caught)

  // Segment shorter than min duration
  caught = false
  normal_plan.validate_output(6000000L, 100) catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(
        msg, "有保留片段短于平均一帧，请调整切点后导出",
      )
    }
  }
  assert_true(caught)
}

///|
test "dispatch parses valid JSON and gracefully reports errors" {
  // Valid JSON dispatch
  let json_in =
    #|{"duration_us":"10000000","spans":[],"history":{"operations":[],"cursor":0},"action":"plan"}
  let json_out = @core.dispatch(json_in)
  assert_true(json_out.contains("\"output_duration_us\":\"10000000\""))

  // Malformed JSON dispatch
  let malformed_out = @core.dispatch("{bad json")
  assert_true(malformed_out.contains("无法解析编辑请求"))

  // Semantic error dispatch
  let err_in =
    #|{"duration_us":"-1000","spans":[],"history":{"operations":[],"cursor":0},"action":"plan"}
  let err_out = @core.dispatch(err_in)
  assert_true(err_out.contains("视频时长超出支持范围"))
}

///|
test "suggestion struct methods, json roundtrip, and explainable reasons" {
  // Suggestion helper methods
  let sug : @core.Suggestion = {
    kind: "pause",
    span_id: "s1",
    start_us: 250000L,
    end_us: 1750000L,
    reason: "长停顿 2.0 秒",
  }
  assert_eq(sug.duration(), 1500000L)
  assert_true(sug.contains(250000L))
  assert_true(sug.contains(1749999L))
  assert_false(sug.contains(1750000L))
  assert_false(sug.contains(0L))
  assert_eq(sug.to_interval().start_us, 250000L)
  assert_eq(sug.to_interval().end_us, 1750000L)
  assert_eq(sug.explain(), "长停顿 2.0 秒")

  // JSON roundtrip
  let json_sug = @json.to_json(sug)
  let decoded : @core.Suggestion = @json.from_json(json_sug)
  assert_eq(decoded.kind, "pause")
  assert_eq(decoded.span_id, "s1")
  assert_eq(decoded.start_us, 250000L)
  assert_eq(decoded.end_us, 1750000L)
  assert_eq(decoded.reason, "长停顿 2.0 秒")

  // Silence pause boundary: 1.8s threshold
  // Case A: exactly 1800000L (1.8s) gap -> pause suggestion generated with 1.8s
  let spans_exact : Array[@core.Span] = [
    { id: "p1", start_us: 1800000L, end_us: 3000000L, text: "句一", },
  ]
  let sugs_exact = @core.suggest(spans_exact)
  assert_eq(sugs_exact.length(), 1)
  assert_eq(sugs_exact[0].kind, "pause")
  assert_eq(sugs_exact[0].reason, "长停顿 1.8 秒")
  assert_eq(sugs_exact[0].start_us, 250000L)
  assert_eq(sugs_exact[0].end_us, 1550000L)

  // Case B: 1799999L gap (< 1.8s) -> no pause suggestion
  let spans_below : Array[@core.Span] = [
    { id: "p2", start_us: 1799999L, end_us: 3000000L, text: "句一", },
  ]
  let sugs_below = @core.suggest(spans_below)
  assert_eq(sugs_below.length(), 0)

  // Empty spans return empty suggestions
  assert_eq(@core.suggest([]).length(), 0)
}

///|
test "Interval intersection, adjacent, touching_or_overlapping, and union operations" {
  let a : @core.Interval = { start_us: 1000L, end_us: 3000L, }
  let b : @core.Interval = { start_us: 2000L, end_us: 4000L, }
  let c : @core.Interval = { start_us: 3000L, end_us: 5000L, }
  let d : @core.Interval = { start_us: 4000L, end_us: 6000L, }
  let contained : @core.Interval = { start_us: 1500L, end_us: 2500L, }

  // Intersection
  let ab_inter = a.intersection(b)
  assert_false(ab_inter is None)
  assert_eq(ab_inter.unwrap().start_us, 2000L)
  assert_eq(ab_inter.unwrap().end_us, 3000L)

  // Symmetry: b.intersection(a) == a.intersection(b)
  let ba_inter = b.intersection(a)
  assert_false(ba_inter is None)
  assert_eq(ba_inter.unwrap().start_us, 2000L)
  assert_eq(ba_inter.unwrap().end_us, 3000L)

  // Disjoint intervals have no intersection
  assert_true(a.intersection(d) is None)

  // Touching at single point [1000, 3000) and [3000, 5000) is empty intersection
  assert_true(a.intersection(c) is None)

  // Contained interval intersection equals inner interval
  let ac_inter = a.intersection(contained)
  assert_false(ac_inter is None)
  assert_eq(ac_inter.unwrap().start_us, 1500L)
  assert_eq(ac_inter.unwrap().end_us, 2500L)

  // Adjacent
  assert_true(a.adjacent(c))
  assert_true(c.adjacent(a))
  assert_false(a.adjacent(b))
  assert_false(a.adjacent(d))

  // Touching or overlapping
  assert_true(a.touching_or_overlapping(b))
  assert_true(a.touching_or_overlapping(c))
  assert_true(c.touching_or_overlapping(a))
  assert_false(a.touching_or_overlapping(d))
  assert_false(d.touching_or_overlapping(a))

  // Union
  let ab_union = a.union(b)
  assert_false(ab_union is None)
  assert_eq(ab_union.unwrap().start_us, 1000L)
  assert_eq(ab_union.unwrap().end_us, 4000L)

  let ac_union = a.union(c)
  assert_false(ac_union is None)
  assert_eq(ac_union.unwrap().start_us, 1000L)
  assert_eq(ac_union.unwrap().end_us, 5000L)

  // Disjoint union returns None
  assert_true(a.union(d) is None)

  // Contained union equals outer interval
  let contained_union = a.union(contained)
  assert_false(contained_union is None)
  assert_eq(contained_union.unwrap().start_us, 1000L)
  assert_eq(contained_union.unwrap().end_us, 3000L)
}

///|
test "Operation constructors, duration, to_interval, and kind inspection" {
  // Operation::cut constructor and methods
  let cut_op = @core.Operation::cut(1000000L, 3500000L)
  assert_true(cut_op.is_cut())
  assert_false(cut_op.is_correct())
  assert_eq(cut_op.duration(), 2500000L)
  assert_eq(cut_op.to_interval().start_us, 1000000L)
  assert_eq(cut_op.to_interval().end_us, 3500000L)
  assert_eq(cut_op.span_id, "")
  assert_eq(cut_op.text, "")

  // Inverted or empty cut duration returns 0
  let empty_cut = @core.Operation::cut(3000L, 3000L)
  assert_eq(empty_cut.duration(), 0L)
  let inv_cut = @core.Operation::cut(4000L, 2000L)
  assert_eq(inv_cut.duration(), 0L)

  // Operation::correct constructor and methods
  let corr_op = @core.Operation::correct("span-42", "修正文本")
  assert_false(corr_op.is_cut())
  assert_true(corr_op.is_correct())
  assert_eq(corr_op.duration(), 0L)
  assert_eq(corr_op.span_id, "span-42")
  assert_eq(corr_op.text, "修正文本")
  assert_eq(corr_op.to_interval().start_us, 0L)
  assert_eq(corr_op.to_interval().end_us, 0L)

  // Span::to_interval
  let sp : @core.Span = {
    id: "s1",
    start_us: 500000L,
    end_us: 1500000L,
    text: "测试",
  }
  let sp_iv = sp.to_interval()
  assert_eq(sp_iv.start_us, 500000L)
  assert_eq(sp_iv.end_us, 1500000L)
}

///|
test "Segment output coordinates, interval conversion, mapping, and frame presence" {
  let seg : @core.Segment = {
    start_us: 2000000L,
    end_us: 6000000L,
    output_start_us: 1000000L,
  }
  // Basic properties
  assert_eq(seg.duration(), 4000000L)
  assert_eq(seg.output_end_us(), 5000000L)
  assert_eq(seg.to_interval().start_us, 2000000L)
  assert_eq(seg.to_interval().end_us, 6000000L)
  assert_eq(seg.to_output_interval().start_us, 1000000L)
  assert_eq(seg.to_output_interval().end_us, 5000000L)

  // Output containment [1000000L, 5000000L)
  assert_false(seg.output_contains(999999L))
  assert_true(seg.output_contains(1000000L))
  assert_true(seg.output_contains(4999999L))
  assert_false(seg.output_contains(5000000L))

  // Segment::source_to_output
  assert_eq(seg.source_to_output(1999999L), None)
  assert_eq(seg.source_to_output(2000000L), Some(1000000L))
  assert_eq(seg.source_to_output(3500000L), Some(2500000L))
  assert_eq(seg.source_to_output(5999999L), Some(4999999L))
  assert_eq(seg.source_to_output(6000000L), None)

  // Segment::output_to_source
  assert_eq(seg.output_to_source(999999L), None)
  assert_eq(seg.output_to_source(1000000L), Some(2000000L))
  assert_eq(seg.output_to_source(2500000L), Some(3500000L))
  assert_eq(seg.output_to_source(4999999L), Some(5999999L))
  assert_eq(seg.output_to_source(5000000L), None)

  // Segment::has_frame with sorted frame timestamps
  let frames_hit : Array[Int64] = [500000L, 1500000L, 3000000L, 7000000L]
  assert_true(seg.has_frame(frames_hit))

  let frames_boundary_start : Array[Int64] = [2000000L]
  assert_true(seg.has_frame(frames_boundary_start))

  let frames_miss : Array[Int64] = [500000L, 1999999L, 6000000L, 7000000L]
  assert_false(seg.has_frame(frames_miss))

  assert_false(seg.has_frame([]))
}

///|
test "validate_video_frames and Plan video frame validation" {
  let seg1 : @core.Segment = {
    start_us: 0L,
    end_us: 2000000L,
    output_start_us: 0L,
  }
  let seg2 : @core.Segment = {
    start_us: 4000000L,
    end_us: 6000000L,
    output_start_us: 2000000L,
  }
  let segments : Array[@core.Segment] = [seg1, seg2]

  // Valid: both segments contain frames
  let valid_frames : Array[Int64] = [500000L, 1500000L, 4500000L, 5500000L]
  @core.validate_video_frames(segments, valid_frames)

  // Missing frame in segment 2
  let missing_seg2 : Array[Int64] = [500000L, 2500000L, 7000000L]
  let mut caught = false
  @core.validate_video_frames(segments, missing_seg2) catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(
        msg, "第 2 个保留片段没有视频帧，请扩大区间或调整切点",
      )
    }
  }
  assert_true(caught)

  // Missing frame in segment 1 (empty frames)
  caught = false
  @core.validate_video_frames(segments, []) catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(
        msg, "第 1 个保留片段没有视频帧，请扩大区间或调整切点",
      )
    }
  }
  assert_true(caught)

  // Plan level validate_video_frames
  let plan_res = @core.execute({
      duration_us: 6000000L,
      spans: [],
      history: {
        operations: [
          {
            kind: "cut",
            span_id: "",
            start_us: 2000000L,
            end_us: 4000000L,
            text: "",
          },
        ],
        cursor: 1,
      },
      action: "plan",
      operation: None,
    }).plan
  plan_res.validate_video_frames(valid_frames)

  caught = false
  plan_res.validate_video_frames(missing_seg2) catch {
    @core.Invalid(msg) => {
      caught = true
      assert_eq(
        msg, "第 2 个保留片段没有视频帧，请扩大区间或调整切点",
      )
    }
  }
  assert_true(caught)
}

///|
test "Plan and Span query helpers: find_kept_segment, find_cut, find_caption, covered, and span lookups" {
  let spans : Array[@core.Span] = [
    { id: "s1", start_us: 0L, end_us: 1000000L, text: "句一", },
    { id: "s2", start_us: 1500000L, end_us: 2500000L, text: "跨切点", },
    { id: "s3", start_us: 5000000L, end_us: 6000000L, text: "句三", },
  ]
  let h = @core.History::new().apply({
    kind: "cut",
    span_id: "",
    start_us: 2000000L,
    end_us: 4000000L,
    text: "",
  })
  let res = @core.plan(8000000L, spans, h)
  let p = res.plan

  // Plan::is_partial
  assert_true(p.is_partial("s2"))
  assert_false(p.is_partial("s1"))
  assert_false(p.is_partial("s3"))
  assert_false(p.is_partial("unknown"))

  // Plan::find_kept_segment (source timestamp)
  let seg_at_500k = p.find_kept_segment(500000L)
  assert_false(seg_at_500k is None)
  assert_eq(seg_at_500k.unwrap().start_us, 0L)
  assert_eq(seg_at_500k.unwrap().end_us, 2000000L)

  assert_true(p.find_kept_segment(2500000L) is None) // cut region

  let seg_at_5m = p.find_kept_segment(5000000L)
  assert_false(seg_at_5m is None)
  assert_eq(seg_at_5m.unwrap().start_us, 4000000L)
  assert_eq(seg_at_5m.unwrap().end_us, 8000000L)

  // Plan::find_kept_segment_at_output (output timestamp)
  let out_seg_0 = p.find_kept_segment_at_output(500000L)
  assert_false(out_seg_0 is None)
  assert_eq(out_seg_0.unwrap().output_start_us, 0L)

  let out_seg_2 = p.find_kept_segment_at_output(3000000L)
  assert_false(out_seg_2 is None)
  assert_eq(out_seg_2.unwrap().output_start_us, 2000000L)

  assert_true(p.find_kept_segment_at_output(7000000L) is None) // past output_duration 6s

  // Plan::find_cut (source timestamp)
  assert_true(p.find_cut(500000L) is None)
  let cut_found = p.find_cut(2500000L)
  assert_false(cut_found is None)
  assert_eq(cut_found.unwrap().start_us, 2000000L)
  assert_eq(cut_found.unwrap().end_us, 4000000L)
  assert_true(p.find_cut(4000000L) is None) // boundary

  // Plan::find_caption (by span id in remapped captions)
  let cap1 = p.find_caption("s1")
  assert_false(cap1 is None)
  assert_eq(cap1.unwrap().text, "句一")
  assert_true(p.find_caption("s2") is None) // partial cut span omitted
  let cap3 = p.find_caption("s3")
  assert_false(cap3 is None)
  assert_eq(cap3.unwrap().text, "句三")
  assert_true(p.find_caption("unknown") is None)

  // Plan::find_caption_at (by output timestamp)
  // s1: out [0, 1s)
  // s3: source [5s, 6s) -> shifted by -2s -> out [3s, 4s)
  let cap_at_500k = p.find_caption_at(500000L)
  assert_false(cap_at_500k is None)
  assert_eq(cap_at_500k.unwrap().id, "s1")

  assert_true(p.find_caption_at(2000000L) is None) // between captions

  let cap_at_3500k = p.find_caption_at(3500000L)
  assert_false(cap_at_3500k is None)
  assert_eq(cap_at_3500k.unwrap().id, "s3")

  // Plan::is_span_covered
  let fully_cut_span : @core.Span = {
    id: "fc",
    start_us: 2200000L,
    end_us: 3800000L,
    text: "全删",
  }
  assert_true(p.is_span_covered(fully_cut_span))
  assert_false(p.is_span_covered(spans[0]))
  assert_false(p.is_span_covered(spans[1])) // partly cut, not fully covered

  // Plan::is_suggestion_covered
  let sug_covered : @core.Suggestion = {
    kind: "filler",
    span_id: "fc",
    start_us: 2200000L,
    end_us: 3800000L,
    reason: "口头禅「全删」",
  }
  let sug_uncovered : @core.Suggestion = {
    kind: "filler",
    span_id: "s1",
    start_us: 0L,
    end_us: 1000000L,
    reason: "口头禅「句一」",
  }
  assert_true(p.is_suggestion_covered(sug_covered))
  assert_false(p.is_suggestion_covered(sug_uncovered))

  // find_span_at and find_span_by_id across transcript spans
  let found_span_0 = @core.find_span_at(spans, 500000L)
  assert_false(found_span_0 is None)
  assert_eq(found_span_0.unwrap().id, "s1")

  let found_span_cross = @core.find_span_at(spans, 2000000L)
  assert_false(found_span_cross is None)
  assert_eq(found_span_cross.unwrap().id, "s2")

  assert_true(@core.find_span_at(spans, 1200000L) is None) // gap

  assert_eq(@core.find_span_by_id(spans, "s2").unwrap().text, "跨切点")
  assert_true(@core.find_span_by_id(spans, "missing") is None)
}
