Harmonic Synth 24 — God Save the King (trial)
==================================================

OPEN:
  index.html (Chrome / Edge), then click 「▶ 自動演奏」.
  The score is embedded as the initial JSON. 「サンプルに戻す」 restores it.

FILES:
  index.html — UI
  style.css — appearance
  app.js — Web Audio + built-in default score
  god-save-the-king.json — score you can edit/import separately
  example-progression.json — same default score, for compatibility
  reiji-four-beat-sample.json — original 4-beat user-supplied example

SCORE:
  Source: God Save the King, just intonation arrangement by 小長谷 禮司
  Reference: supplied PDF and accompanying special-accidental legend.
  Trial transcription, NOT a verified exact encoding of every special accidental
  and note duration; please compare with the original notation before research,
  public release, or precision harmonic analysis.
  3/4 meter, bars 1–14, then bars 7–14 repeated once; 66 quarter beats.
  Ratio 1/1 = C4 (default base frequency 261.625565 Hz).
  pitch annotation is informational only; playback uses ratio/start/duration.
  -1 denotes one syntonic comma down (80/81).
  -2 denotes two syntonic commas down (80/81)^2.
  -7 denotes a septimal comma down (63/64).
  #1 denotes a Pythagorean sharp lowered by one syntonic comma (135/128).
  Exact enharmonic/spelling and comma modifiers can be edited freely.

DURATION:
  duration 1 = quarter note; 0.5 = eighth note; 1.5 = dotted quarter;
  3 = dotted half; 0.333333 ≈ one third of a quarter (triplet). Each
  start counts quarter beats from the beginning; overlapping starts create chords.

CONSTRAINTS:
  The audio uses the currently selected 24 harmonic channels for each tone.
  The JSON is a trial auralization, not a score engraving or an audited
  reconstruction of the source organ's timbre or note-by-note tuning.
