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
/// Detects editing suggestions across transcript spans:
/// - "filler": Chinese and English filler words / modal particles
/// - "repeat": consecutive identical phrases
/// - "pause": silence gaps >= 1.8 seconds between spans
pub fn suggest(spans : Array[Span]) -> Array[Suggestion] {
  let suggestions = []
  let mut previous_text = ""
  let mut covered_until = 0L
  for span in spans {
    if span.start_us - covered_until >= 1800000L {
      suggestions.push({
        kind: "pause",
        span_id: span.id,
        start_us: covered_until + 250000L,
        end_us: span.start_us - 250000L,
      })
    }
    let clean = span.text.trim().trim(chars="。.!！?？、,，").to_owned()
    let kind = match clean {
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
      _ if clean != "" && clean == previous_text => "repeat"
      _ => ""
    }
    if kind != "" {
      suggestions.push({
        kind,
        span_id: span.id,
        start_us: span.start_us,
        end_us: span.end_us,
      })
    }
    if span.end_us > covered_until {
      covered_until = span.end_us
    }
    previous_text = clean
  }
  suggestions
}
