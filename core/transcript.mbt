///|
/// Remaps captions onto retained segments, applying any text corrections.
/// Captions that are fully retained within a single kept segment are shifted to the output timeline.
/// Captions that are partially cut or split across segments are flagged in the second return value (partial review).
/// Captions entirely within deleted regions are dropped.
pub fn remap_captions(
  spans : Array[Span],
  kept : Array[Segment],
  corrections : Map[String, String],
) -> (Array[Span], Array[String]) {
  let captions = []
  let partial = []
  let mut first = 0
  for span in spans {
    while first < kept.length() && kept[first].end_us <= span.start_us {
      first += 1
    }
    if first < kept.length() && kept[first].start_us < span.end_us {
      let segment = kept[first]
      if segment.start_us <= span.start_us && span.end_us <= segment.end_us {
        let shift = segment.output_start_us - segment.start_us
        let text = corrections
          .get(span.id)
          .unwrap_or(span.text)
          .trim()
          .to_owned()
        if text != "" {
          captions.push({
            id: span.id,
            start_us: span.start_us + shift,
            end_us: span.end_us + shift,
            text,
          })
        }
      } else {
        partial.push(span.id)
      }
    }
  }
  (captions, partial)
}

///|
fn padded(value : Int64, width : Int32) -> String {
  let raw = value.to_string()
  if raw.length() >= width {
    raw
  } else {
    "0".repeat(width - raw.length()) + raw
  }
}

///|
fn srt_time(ms : Int64) -> String {
  let hours = padded(ms / 3600000L, 2)
  let minutes = padded(ms / 60000L % 60L, 2)
  let seconds = padded(ms / 1000L % 60L, 2)
  let millis = padded(ms % 1000L, 3)
  "\{hours}:\{minutes}:\{seconds},\{millis}"
}

///|
/// Serializes remapped captions into standard SRT subtitle format.
pub fn serialize_srt(captions : Array[Span]) -> String {
  let out = StringBuilder()
  let mut index = 1
  for caption in captions {
    let start = (caption.start_us + 999L) / 1000L
    let end = caption.end_us / 1000L
    if end > start {
      let line = caption.text
        .replace_all(old="\r", new=" ")
        .replace_all(old="\n", new=" ")
      out.write_string(
        "\{index}\n\{srt_time(start)} --> \{srt_time(end)}\n\{line}\n\n",
      )
      index += 1
    }
  }
  out.to_string()
}

///|
/// Formats microsecond durations into seconds with one decimal place.
fn format_decimal_seconds(us : Int64) -> String {
  let tenths = (us + 50000L) / 100000L
  let sec = tenths / 10L
  let frac = tenths % 10L
  "\{sec}.\{frac}"
}

///|
/// Detects editing suggestions across transcript spans:
/// - "filler": Chinese and English filler words / modal particles with reason "口头禅「...」"
/// - "repeat": consecutive identical phrases (punctuation and letter-case ignored) with reason "重复句「...」"
/// - "pause": silence gaps >= 1.8 seconds before a span; the reason names the opening or the two surrounding sentences
pub fn suggest(spans : Array[Span]) -> Array[Suggestion] {
  let suggestions = []
  let mut previous_text = ""
  let mut previous_key = ""
  let mut covered_until = 0L
  for span in spans {
    let clean = span.text.trim().trim(chars="。.!！?？、,，").to_owned()
    let key = clean.to_lower()
    if span.start_us - covered_until >= 1800000L {
      let gap_us = span.start_us - covered_until
      let seconds = format_decimal_seconds(gap_us)
      let reason = if covered_until == 0 {
        "片头长停顿 \{seconds} 秒"
      } else if previous_text != "" && clean != "" {
        "「\{previous_text}」与「\{clean}」之间长停顿 \{seconds} 秒"
      } else {
        "长停顿 \{seconds} 秒"
      }
      suggestions.push({
        kind: "pause",
        span_id: span.id,
        start_us: covered_until + 250000L,
        end_us: span.start_us - 250000L,
        reason,
      })
    }
    let kind = match key {
      "嗯"
      | "呃"
      | "额"
      | "啊"
      | "哦"
      | "噢"
      | "嘛"
      | "那个"
      | "就是"
      | "就是说"
      | "然后"
      | "这个"
      | "对"
      | "对对对"
      | "所以说"
      | "怎么说"
      | "em"
      | "um"
      | "uh"
      | "ah"
      | "er"
      | "hmm"
      | "well"
      | "like"
      | "you know"
      | "i mean"
      | "so"
      | "right"
      | "okay" => "filler"
      _ if key != "" && key == previous_key => "repeat"
      _ => ""
    }
    if kind != "" {
      let reason = match kind {
        "filler" => "口头禅「\{clean}」"
        "repeat" => "重复句「\{clean}」"
        _ => ""
      }
      suggestions.push({
        kind,
        span_id: span.id,
        start_us: span.start_us,
        end_us: span.end_us,
        reason,
      })
    }
    if span.end_us > covered_until {
      covered_until = span.end_us
    }
    previous_text = clean
    previous_key = key
  }
  suggestions
}
