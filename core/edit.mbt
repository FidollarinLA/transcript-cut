///|
#derive(ToJson)
pub struct Interval {
  start_us : Int64
  end_us : Int64
}

///|
pub extend Interval with ToJson::{to_json}

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
pub struct Segment {
  start_us : Int64
  end_us : Int64
  output_start_us : Int64
}

///|
pub extend Segment with ToJson::{to_json}

///|
#derive(ToJson)
pub struct Suggestion {
  kind : String
  span_id : String
  start_us : Int64
  end_us : Int64
}

///|
pub extend Suggestion with ToJson::{to_json}

///|
#derive(ToJson)
pub struct Plan {
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
pub suberror Invalid {
  Invalid(String)
}

///|
#derive(ToJson)
pub struct EditResult {
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
  let { operations, cursor, } = request.history
  match request.action {
    "plan" => request.history
    "undo" => { operations, cursor: if cursor > 0 { cursor - 1 } else { 0 }, }
    "redo" =>
      {
        operations,
        cursor: if cursor < operations.length() {
          cursor + 1
        } else {
          cursor
        },
      }
    "apply" =>
      match request.operation {
        Some(operation) => {
          if cursor >= 2000 {
            raise Invalid("编辑记录达到 2000 条上限")
          }
          let next = Array(capacity=cursor + 1)
          for i in 0..<cursor {
            next.push(operations[i])
          }
          next.push(operation)
          { operations: next, cursor: next.length(), }
        }
        None => raise Invalid("缺少编辑操作")
      }
    _ => raise Invalid("未知编辑动作")
  }
}

///|
fn merged_intervals(cuts : Array[Interval]) -> Array[Interval] {
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
