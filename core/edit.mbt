///|
#derive(ToJson)
pub(all) struct Interval {
  start_us : Int64
  end_us : Int64
}

///|
pub extend Interval with ToJson::{to_json}

///|
/// Returns the duration of the interval in microseconds.
pub fn Interval::duration(self : Interval) -> Int64 {
  self.end_us - self.start_us
}

///|
/// Checks whether a timestamp falls within the half-open interval [start_us, end_us).
pub fn Interval::contains(self : Interval, timestamp_us : Int64) -> Bool {
  self.start_us <= timestamp_us && timestamp_us < self.end_us
}

///|
/// Checks whether this interval completely covers another interval.
pub fn Interval::covers(self : Interval, other : Interval) -> Bool {
  self.start_us <= other.start_us && other.end_us <= self.end_us
}

///|
/// Checks whether this interval overlaps with another interval.
pub fn Interval::overlaps(self : Interval, other : Interval) -> Bool {
  self.start_us < other.end_us && other.start_us < self.end_us
}

///|
#derive(ToJson, @json.FromJson)
pub(all) struct Span {
  id : String
  start_us : Int64
  end_us : Int64
  text : String
}

///|
pub extend Span with ToJson::{to_json}

///|
pub extend Span with @json.FromJson::{from_json}

///|
/// Returns the duration of the span in microseconds.
pub fn Span::duration(self : Span) -> Int64 {
  self.end_us - self.start_us
}

///|
/// Checks whether a source timestamp falls within this span [start_us, end_us).
pub fn Span::contains(self : Span, timestamp_us : Int64) -> Bool {
  self.start_us <= timestamp_us && timestamp_us < self.end_us
}

///|
#derive(ToJson, @json.FromJson)
pub(all) struct Operation {
  kind : String
  span_id : String
  start_us : Int64
  end_us : Int64
  text : String
}

///|
pub extend Operation with ToJson::{to_json}

///|
pub extend Operation with @json.FromJson::{from_json}

///|
#derive(ToJson, @json.FromJson)
pub(all) struct History {
  operations : Array[Operation]
  cursor : Int32
}

///|
pub extend History with ToJson::{to_json}

///|
pub extend History with @json.FromJson::{from_json}

///|
/// Creates a fresh edit history with no operations.
pub fn History::new() -> History {
  { operations: [], cursor: 0, }
}

///|
/// Checks whether undo is possible.
pub fn History::can_undo(self : History) -> Bool {
  self.cursor > 0
}

///|
/// Checks whether redo is possible.
pub fn History::can_redo(self : History) -> Bool {
  self.cursor < self.operations.length()
}

///|
/// Steps backwards one operation in history.
pub fn History::undo(self : History) -> History {
  {
    operations: self.operations,
    cursor: if self.cursor > 0 {
      self.cursor - 1
    } else {
      0
    },
  }
}

///|
/// Steps forward one operation in history.
pub fn History::redo(self : History) -> History {
  {
    operations: self.operations,
    cursor: if self.cursor < self.operations.length() {
      self.cursor + 1
    } else {
      self.cursor
    },
  }
}

///|
/// Applies a new operation at current cursor, truncating any redo tail.
pub fn History::apply(
  self : History,
  operation : Operation,
) -> History raise Invalid {
  if self.cursor >= 2000 {
    raise Invalid("编辑记录达到 2000 条上限")
  }
  let next = Array(capacity=self.cursor + 1)
  for i in 0..<self.cursor {
    next.push(self.operations[i])
  }
  next.push(operation)
  { operations: next, cursor: next.length(), }
}

///|
#derive(@json.FromJson)
pub(all) struct Request {
  duration_us : Int64
  spans : Array[Span]
  history : History
  action : String
  operation : Operation?
}

///|
pub extend Request with @json.FromJson::{from_json}

///|
#derive(ToJson)
pub(all) struct Segment {
  start_us : Int64
  end_us : Int64
  output_start_us : Int64
}

///|
pub extend Segment with ToJson::{to_json}

///|
/// Returns the source duration of the segment in microseconds.
pub fn Segment::duration(self : Segment) -> Int64 {
  self.end_us - self.start_us
}

///|
/// Checks whether a source timestamp falls within the segment [start_us, end_us).
pub fn Segment::contains(self : Segment, source_us : Int64) -> Bool {
  self.start_us <= source_us && source_us < self.end_us
}

///|
/// Returns the exclusive output end timestamp in microseconds.
pub fn Segment::output_end_us(self : Segment) -> Int64 {
  self.output_start_us + (self.end_us - self.start_us)
}

///|
/// Converts a retained segment into a source interval.
pub fn Segment::to_interval(self : Segment) -> Interval {
  { start_us: self.start_us, end_us: self.end_us, }
}

///|
#derive(ToJson, @json.FromJson)
pub(all) struct Suggestion {
  kind : String
  span_id : String
  start_us : Int64
  end_us : Int64
  reason : String
}

///|
pub extend Suggestion with ToJson::{to_json}

///|
pub extend Suggestion with @json.FromJson::{from_json}

///|
/// Returns the duration of the suggestion interval in microseconds.
pub fn Suggestion::duration(self : Suggestion) -> Int64 {
  self.end_us - self.start_us
}

///|
/// Checks whether a source timestamp falls within the suggestion interval [start_us, end_us).
pub fn Suggestion::contains(self : Suggestion, timestamp_us : Int64) -> Bool {
  self.start_us <= timestamp_us && timestamp_us < self.end_us
}

///|
/// Converts the suggestion into a source interval.
pub fn Suggestion::to_interval(self : Suggestion) -> Interval {
  { start_us: self.start_us, end_us: self.end_us, }
}

///|
/// Returns the rationale explaining why this edit suggestion was generated.
pub fn Suggestion::explain(self : Suggestion) -> String {
  self.reason
}

///|
#derive(ToJson)
pub(all) struct Plan {
  schema_version : Int32
  deleted : Array[Interval]
  kept : Array[Segment]
  output_duration_us : Int64
  captions : Array[Span]
  partial_span_ids : Array[String]
  srt : String
}

///|
pub extend Plan with ToJson::{to_json}

///|
/// Checks whether the plan has no retained content.
pub fn Plan::is_empty(self : Plan) -> Bool {
  self.kept.length() == 0
}

///|
/// Returns the total deleted duration in microseconds across all cuts.
pub fn Plan::total_deleted_us(self : Plan) -> Int64 {
  let mut total = 0L
  for cut in self.deleted {
    total += cut.end_us - cut.start_us
  }
  total
}

///|
/// Checks whether a source timestamp falls within any deleted cut [start_us, end_us).
pub fn Plan::is_deleted(self : Plan, source_us : Int64) -> Bool {
  for cut in self.deleted {
    if cut.start_us <= source_us && source_us < cut.end_us {
      return true
    }
  }
  false
}

///|
/// Checks whether an interval [start_us, end_us) is completely covered by deleted cuts.
pub fn Plan::is_covered(self : Plan, start_us : Int64, end_us : Int64) -> Bool {
  for cut in self.deleted {
    if cut.start_us <= start_us && end_us <= cut.end_us {
      return true
    }
  }
  false
}

///|
/// Validates export constraints: must have at least one kept segment,
/// at most max_segments, and every segment must be at least min_segment_duration_us long.
pub fn Plan::validate_output(
  self : Plan,
  min_segment_duration_us : Int64,
  max_segments : Int32,
) -> Unit raise Invalid {
  if self.kept.length() == 0 {
    raise Invalid("成片没有保留片段")
  }
  if self.kept.length() > max_segments {
    raise Invalid("当前版本最多导出 \{max_segments} 个保留片段")
  }
  for segment in self.kept {
    if segment.end_us - segment.start_us < min_segment_duration_us {
      raise Invalid(
        "有保留片段短于平均一帧，请调整切点后导出",
      )
    }
  }
}

///|
pub suberror Invalid {
  Invalid(String)
}

///|
#derive(ToJson)
pub(all) struct EditResult {
  history : History
  plan : Plan
  suggestions : Array[Suggestion]
}

///|
/// Maps a retained source timestamp onto the output timeline.
/// Deleted timestamps and the exclusive source endpoint return None.
pub fn Plan::source_to_output(self : Plan, source_us : Int64) -> Int64? {
  for segment in self.kept {
    if segment.start_us <= source_us && source_us < segment.end_us {
      return Some(segment.output_start_us + source_us - segment.start_us)
    }
  }
  None
}

///|
/// Maps an output timeline timestamp back onto the source media timeline.
/// Timestamps outside the output duration return None.
pub fn Plan::output_to_source(self : Plan, output_us : Int64) -> Int64? {
  if output_us < 0L || output_us >= self.output_duration_us {
    return None
  }
  for segment in self.kept {
    let segment_len = segment.end_us - segment.start_us
    if segment.output_start_us <= output_us &&
      output_us < segment.output_start_us + segment_len {
      return Some(segment.start_us + (output_us - segment.output_start_us))
    }
  }
  None
}

///|
pub extend EditResult with ToJson::{to_json}

///|
fn check_interval(
  start : Int64,
  end : Int64,
  duration : Int64,
) -> Unit raise Invalid {
  if start < 0L || end <= start || end > duration {
    raise Invalid("区间必须位于视频内，且起点早于终点")
  }
}

///|
fn validate(request : Request) -> Map[String, Span] raise Invalid {
  if request.duration_us <= 0L || request.duration_us > 9007199254740991L {
    raise Invalid("视频时长超出支持范围")
  }
  if request.history.cursor < 0 ||
    request.history.cursor > request.history.operations.length() {
    raise Invalid("编辑历史位置无效")
  }
  if request.spans.length() > 5000 || request.history.operations.length() > 2000 {
    raise Invalid("项目数据超过支持范围")
  }
  let spans = Map([])
  let mut previous_start = 0L
  for span in request.spans {
    check_interval(span.start_us, span.end_us, request.duration_us)
    if span.start_us < previous_start ||
      span.id == "" ||
      spans.contains(span.id) {
      raise Invalid("转写片段应按起点排序，且 ID 唯一")
    }
    spans[span.id] = span
    previous_start = span.start_us
  }
  spans
}

///|
fn update_history(request : Request) -> History raise Invalid {
  match request.action {
    "plan" => request.history
    "undo" => request.history.undo()
    "redo" => request.history.redo()
    "apply" =>
      match request.operation {
        Some(operation) => request.history.apply(operation)
        None => raise Invalid("缺少编辑操作")
      }
    _ => raise Invalid("未知编辑动作")
  }
}

///|
/// Merges overlapping and adjacent half-open intervals into a sorted, disjoint array.
pub fn merge_intervals(cuts : Array[Interval]) -> Array[Interval] {
  cuts.sort_by((a, b) => a.start_us.compare(b.start_us))
  let merged : Array[Interval] = []
  for cut in cuts {
    match merged.last() {
      Some(last) if last.end_us >= cut.start_us =>
        merged[merged.length() - 1] = {
          start_us: last.start_us,
          end_us: if last.end_us > cut.end_us {
            last.end_us
          } else {
            cut.end_us
          },
        }
      _ => merged.push(cut)
    }
  }
  merged
}

///|
fn merged_intervals(cuts : Array[Interval]) -> Array[Interval] {
  merge_intervals(cuts)
}

///|
fn build_plan(
  request : Request,
  spans : Map[String, Span],
  history : History,
) -> Plan raise Invalid {
  let cuts = []
  let corrections = Map([])
  for i, operation in history.operations {
    match operation.kind {
      "cut" => {
        check_interval(
          operation.start_us,
          operation.end_us,
          request.duration_us,
        )
        if i < history.cursor {
          cuts.push({ start_us: operation.start_us, end_us: operation.end_us, })
        }
      }
      "correct" => {
        if !spans.contains(operation.span_id) {
          raise Invalid("字幕片段不存在")
        }
        if operation.text.length() > 2000 {
          raise Invalid("单条字幕修改超过 2000 字符")
        }
        if i < history.cursor {
          corrections[operation.span_id] = operation.text
        }
      }
      _ => raise Invalid("未知编辑操作")
    }
  }
  let deleted = merged_intervals(cuts)
  let kept : Array[Segment] = []
  let mut source = 0L
  let mut output = 0L
  for cut in deleted {
    if source < cut.start_us {
      kept.push({
        start_us: source,
        end_us: cut.start_us,
        output_start_us: output,
      })
      output += cut.start_us - source
    }
    source = cut.end_us
  }
  if source < request.duration_us {
    kept.push({
      start_us: source,
      end_us: request.duration_us,
      output_start_us: output,
    })
    output += request.duration_us - source
  }
  let (captions, partial_span_ids) = remap_captions(
    request.spans,
    kept,
    corrections,
  )
  {
    schema_version: 1,
    deleted,
    kept,
    output_duration_us: output,
    captions,
    partial_span_ids,
    srt: serialize_srt(captions),
  }
}

///|
/// Calculates an edit plan from source time and the operation history.
/// Every interval is half-open and expressed in microseconds.
pub fn execute(request : Request) -> EditResult raise Invalid {
  let spans = validate(request)
  let history = update_history(request)
  let plan = build_plan(request, spans, history)
  { history, plan, suggestions: suggest(request.spans), }
}

///|
/// Calculates an edit plan without modifying the history.
pub fn plan(
  duration_us : Int64,
  spans : Array[Span],
  history : History,
) -> EditResult raise Invalid {
  execute({ duration_us, spans, history, action: "plan", operation: None, })
}

///|
/// JSON entry point for JS hosts. Int64 times use decimal strings on this boundary.
pub fn dispatch(input : String) -> String {
  try {
    let request : Request = @json.from_json(@json.parse(input))
    @json.to_json(execute(request)).stringify()
  } catch {
    Invalid(message) =>
      Json::object({ "error": Json::string(message) }).stringify()
    _ =>
      Json::object({ "error": Json::string("无法解析编辑请求") }).stringify()
  }
}
