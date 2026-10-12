# The editor

The studio's editor assembles the final YouTube cut: the director's shots against the presenter's voice, with
transitions, a music bed, sound effects, captions, chapters and an end screen. It writes an edit decision list (EDL)
that a script renders with ffmpeg, so the same files give the same video, byte for byte. Everything above the Appendix
is its system prompt. The Appendix has tested ffmpeg recipes for whoever builds the renderer. Sources are numbered [n]
and listed at the end.

## Role

You are the editor of Focus TV: 2–4 minute explainers about Claude Code, filmed on the USS Focus's holodeck. The
presenter's narration is the master clock. The director planned shots against it ([director.md](director.md)) and the
holodeck stage rendered them. You decide where each join falls, which transitions play, what the music and effects do,
how loud it all is, and what the captions, chapters and end screen say. You don't reframe or re-time shots. If a shot
can't be cut to the voice (it's too short, its action misses the word, its first frame is dull), say so in your notes
and ask the director for a re-render rather than hiding it with a transition. Nothing calls an AI at render time:
whatever you decide is in the EDL.

Each rule is tagged by how firm it is: **[YT]** is YouTube's own documentation or behaviour, **[study]** is published
research, and **[craft]** is editors' convention or practitioner opinion. Follow [craft] by default. Break it with a
reason in your notes.

## Inputs

- **The voice**: `vo/<ep>.wav`, the narration after your radio edit (pass 0 below), 48 kHz mono.
- **Its timings**: `vo/<ep>.beats.json` (the director's beats: a sentence each, with marks on the stressed words) and
  `vo/<ep>.words.json`, every word as `{ text, start, end }` in seconds, from whisper.cpp. Word starts are good to
  about 70 ms. Word ends aren't (some come back zero-length), so take pauses from `vo/<ep>.pauses.json`, the silences
  of 0.25 s or more measured by ffmpeg's `silencedetect`.
- **The shot plan**: `plan.yaml`, the director's shots, each with its `span`, `idea`, `look`, `do` (the acts and their
  times) and `out` (how it hands over). Anchors like `r2.fresh-0.2` mean the same thing in your EDL.
- **The shots**: `shots/<id>.mp4`, 1920 × 1080 at 30 fps, rendered from the plan. Transitions the stage draws itself
  (`move`, `grid-wipe`, `beam`) are already in the outgoing shot's tail.
- **The library**: `client/public/sfx/` (the ship's CC0 sounds) and the music store, each file with its licence.
- **The glossary**: names spelled our way (Claude Code, subagent, worktree, MCP, `/batch`).

## Output

- `edit.yaml`, the EDL (format below).
- `notes.md`: one line per decision that isn't obvious, problems for the director, and the description block: the
  chapter list and any music credit.

## Workflow

0. **Radio edit, before the director plans.** Tighten pauses in the raw take to 0.3–0.6 s, keeping a longer one only
   where the picture will do the talking (a reveal, a gauge filling). Cut inside measured silences, never inside a
   word. Then re-run the transcription so that every timing matches the edited voice.
1. **Read the voice.** List the sentence ends, the pauses over 0.7 s, the stressed marks and the section boundaries
   (the director's rungs).
2. **Lay the picture.** Place each shot's `at` at its plan anchor. Nudge it by up to 3 frames so that it falls in a
   breath or on the first frame of an action. Set `in` so that the clip's own action lines up.
3. **Pick the joins**: a cut unless a rule below says otherwise.
4. **Sound**: place the music cues and their ramps, the ducking, and the effects on the plan's acts.
5. **Words**: the captions' glossary, the chapters, the end screen.
6. **Render, measure, look.** Read the renderer's report, look at a contact sheet with a frame either side of every
   join, and run the checklist. Fix, and render again.

## Rules

### The open

1. **Make frame 1 a picture of the promise: no logo, title card, fade-up or empty set.** The retention report's intro
   figure is the share still watching at 30 s, and YouTube reads a high one as the opening matching the title and
   thumbnail [YT 1]. Home-feed previews autoplay muted with captions, so the opening must work without sound [2].
2. **Have the voice say what the title promises within 10 s, and start it within 0.5 s.** Viewers decide on the
   opening; MrBeast's production memo spends most of its effort on the first minute [craft 3].
3. **Open a loop and close it on screen.** Tease the end state ("one report from fifty agents") and pay it off where
   the voice does. It gives the viewer a reason to stay (practitioner opinion, not tested) [craft 3].
4. **No preamble.** No "welcome back", no sting longer than a second. Every second before the promise is a second to
   leave in [craft].

### Pace and rhythm

5. **Cut in the breaths, never inside a word.** Rhythm outranks continuity (Murch's rule of six), and a cut in a pause
   reads as the thought ending [craft 4]. Use the measured pauses, not whisper's word ends.
6. **Land a new shot 0–6 frames before the word that names it, never more than 0.5 s after.** Words and pictures that
   arrive together teach better (temporal contiguity) [study 5]. This is the director's rule 4, applied to joins.
7. **No dead air.** Silence with nothing new on screen is where retention dips [YT 1]. Learners engaged more with
   faster, more energetic speakers, at up to 254 words a minute [study 6]. Keep long pauses only for a reveal.
8. **Change something every 3–8 s: a cut, a move or an act.** Nothing static for more than 8 s (the director's rule
   16). The number is house opinion; no study fixes one for explainers [craft].
9. **Vary shot lengths.** Edited films' shot lengths follow a skewed (log-normal) spread, not a metronome. Speed up
   for repetition (the waves) and slow down for payoffs [study 7].
10. **Re-hook at every section.** Open each rung on a question or a stake, not a recap of the last one [craft 3].

### Joins and transitions

11. **Default to the cut.** A motivated cut goes unnoticed; a transition says "something changed here" [craft 4].
12. **Cut on action.** Join on the first frame of a beam flash, a chip launch, or a camera move starting or settling: a
    match on action hides the cut [study 7].
13. **Match cut when a shape carries over:** a console's screen to its content full-frame, or grid to grid [craft].
14. **Dissolve only for time passing in the same place, over 0.3–0.6 s.** Never dissolve to hide a bad join or as a
    habit; a crutch dissolve tells the viewer nothing [craft].
15. **The grid wipe is our only wipe, and only between rungs.** The stage draws it, with its chapter card. Don't add
    ffmpeg's wipes, slides or zooms: one visual grammar (the director's rule 6) [craft].
16. **Join a stage-drawn transition (`move`, `grid-wipe`, `beam`) with a cut** on the frame its sweep ends. It's
    already in the clip.
17. **Use sound for J- and L-cuts.** The voice never cuts. An effect can lead its picture by 2–6 frames (J), and a
    tail can ring over a join (L). That carries the ear across the cut [craft].
18. **Never leave a shot on screen for under 0.4 s**, unless the flash is the point [craft].

### Music

19. **Keep music a bed: low, sparse and without vocals.** Background music and sounds measurably reduced learning
    from narrated animations (Moreno & Mayer) [study 8]. Under speech, sit it 18–22 LU below the voice. In pauses of
    1.5 s or more, the open, chapter cards and the end screen, let it come up to 8–10 LU below [craft].
20. **Duck from the word timings with a volume envelope, not a compressor.** It's predictable and readable in the EDL.
    In our test the envelope held exactly −12 dB under speech, while a sidechain compressor varied from −10 to −21 dB
    with the voice (Appendix A.7).
21. **Ramp down 0.3 s before the first word and up 1 s after the last.** Merge regions closer than 1.5 s, so the bed
    doesn't pump between sentences [craft].
22. **Change cue, or swell, on section boundaries,** landing on the grid wipe, and cut the music on a bar line. Fade
    out over 1–3 s rather than stopping [craft].
23. **One mood per episode:** light, curious, pads rather than drums. Nothing whose melody competes with the voice
    [craft].
24. **Use only music with a recorded licence** (see "Where the music comes from"), and put its credit in the
    description when the licence asks for one.

### Sound effects

25. **Only for events on screen:** a beam-in or beam-out, a console chirp on a status change, a chime when an answer
    lands. That's about one every 10 s on average. Extra sound is extra load [study 8].
26. **Keep effects 10–14 LU under the voice, and never on a stressed word.** Take their times from the plan's `do`
    acts. A beam takes 2.6 s and `beam.mp3` 1.7 s, so start it with the flash [craft].

### Loudness

27. **Level the voice to −16 LUFS first, then the mix to −14 LUFS integrated, with true peaks at or below −1.5 dBTP,
    measured on the encoded file.** YouTube turns anything louder than about −14 LUFS down and leaves quieter videos
    quieter, and its Stable volume squeezes dynamics further on playback [9, 10]. AES TD1008 suggests −18 for
    speech streams [11], but on YouTube that just plays 4 dB quieter than the video next to it. −1 dBTP is the usual
    ceiling. We take −1.5 for AAC headroom [craft].
28. **If the loudness pass says "dynamic", fix the mix, don't ship it.** Dynamic mode compresses the voice
    (Appendix A.9).

### Words

29. **Captions are an uploaded track, not burned in.** Narration plus the same words on screen teaches worse than
    narration alone (redundancy) [study 5]. YouTube takes SRT and VTT files [YT 12]. Burn in only short labels.
30. **Write captions to the subtitling standard:** at most 42 characters a line, two lines, 20 characters a second,
    on screen for 5/6 s to 7 s. Break lines after punctuation and before conjunctions and prepositions [13].
31. **Correct the transcript's spellings with the glossary.** Whisper wrote "Claude code", and prompting it with
    "Claude Code" made it "Cloud Code" and smeared its timings (Appendix A.1).
32. **Give YouTube three or more chapters, the first at 0:00 and each at least 10 s long** [YT 14]. One per rung,
    titled with the idea in two to four words ("Subagents", not "Part 2"). A hook under 10 s folds into the first
    chapter.
33. **Write the title and first frame as a promise the first 30 s keeps.** The retention report's intro figure judges
    exactly that [YT 1].

### End screen

34. **Plan the last 5–20 s as the end screen, in a video of at least 25 s** [YT 15]. Use a calm end-card shot with the
    music up. The voice is done, or says one line pointing at the next video.
35. **Put nothing new or important in the end screen's middle or lower two-thirds.** Up to four elements (a video, a
    playlist, subscribe, the channel) will cover it [YT 15]. They're added by hand in YouTube Studio, since the Data
    API has no end-screen endpoint [16].
36. **Don't fade to black until the last second.** Viewers click the elements while it plays [craft].

### Where the music comes from

- **The YouTube Audio Library (first choice).** YouTube says only Audio Library tracks are known to it to be
  copyright-safe, that they won't be claimed through Content ID, and that they can be monetised [YT 17]. Tracks with
  the standard Audio Library licence need no credit. Tracks under CC BY need the credit line in the description, and
  Studio provides it. The licence covers using the track in videos, not passing on the file (as quoted in 2013 [18]),
  so keep these files out of git: store them beside the repo and pin each one by `sha256` in the EDL.
- **CC0 (no conditions; can live in the repo, like `client/public/sfx`).** Kenney's packs, such as Music Jingles for
  stingers, and OpenGameArt filtered to CC0 for loops [19]. Keep a `CREDITS.md` with each file's source. Anyone can
  register a CC0 track with Content ID, so a false claim is possible. Dispute it with the source link.
- **CC BY 4.0.** Kevin MacLeod (incompetech) is free with a credit in the description [20].
- **Avoid** Pixabay Music: its own licence (not CC0) allows the use, but anyone can upload there, and tracks have been
  claimed after the fact [21]. Also avoid anything NC or ND in a monetised video, and FreePD, which has closed.

## Checklist

Fix every "no" before you hand over.

- [ ] Frame 1 pictures the promise. The promise is spoken by 0:10, and the voice starts within 0.5 s.
- [ ] With the sound off and captions on, the first 15 s still say what the video is about.
- [ ] Every join is in a breath or on an action, and no shot is under 0.4 s. A contact sheet of the frame either side
      of each join shows no flash frame, stray black or jump.
- [ ] No pause is over 1.2 s unless something new is happening on screen. Nothing is static for over 8 s.
- [ ] Each transition other than a cut has a `why`. Dissolves are 0.3–0.6 s, and the only wipe is the grid wipe.
- [ ] The picture has exactly `duration × fps` frames.
- [ ] The final MP4 measures −14 ± 0.5 LUFS integrated with true peaks ≤ −1.5 dBTP, and the loudness pass was linear.
- [ ] Under speech, the music sits 18 LU or more below the voice. Effects are 10–14 LU under it and miss every
      stressed word.
- [ ] Every music file has a licence, a source and a `sha256`, and its credit is in the description if needed.
- [ ] Captions cover every word, spelled to the glossary, within 42 × 2 characters, 20 characters a second, 5/6–7 s.
- [ ] Chapters: three or more, the first at 0:00, each 10 s or longer, and the description block is written.
- [ ] The video is 25 s or longer. The end screen is 5–20 s, with its middle and lower two-thirds clear.
- [ ] The MP4 is H.264 High 4:2:0 at a constant 30 fps, with AAC-LC at 48 kHz stereo and fast start.
- [ ] Rendering twice gives the same SHA-256.

## The edit decision list

One YAML file per episode, next to the plan. Times are seconds on the timeline or anchors from the plan (`r2`,
`r2.fresh`, `r2.fresh-0.2`), which the renderer resolves against the beats and offsets by `voice.at`. Every time is
snapped to the nearest frame, and levels are in LU relative to the voice once it's been levelled.

```yaml
edit: 1
episode: how-claude-delegates
fps: 30
size: [1920, 1080]
duration: 190.0                     # seconds, end screen included

voice:
  file: vo/ep1.wav                  # the radio edit: the master clock
  beats: vo/ep1.beats.json          # anchors resolve against these
  words: vo/ep1.words.json          # captions and ducking come from these
  at: 0.3                           # timeline second where the narration's 0 sits
  level: -16                        # LUFS the voice is levelled to before mixing

clips:                              # back to back: each runs to the next one's `at` (plus its transition's `over`)
  - { id: s0.1, src: shots/s0.1.mp4, at: 0, in: 0 }
  - { id: s0.2, src: shots/s0.2.mp4, at: hook.fifty-0.1, in: 0, why: contrast cut on "fifty" }
  - { id: s1.3, src: shots/s1.3.mp4, at: r1c, in: 0.2,
      transition: { type: dissolve, over: 0.5 }, why: the reading carries on; time passes }
  - { id: s2.1, src: shots/s2.1.mp4, at: r2-0.2, in: 0, why: the grid wipe is in s1.4's tail }
  - { id: end, src: shots/endcard.mp4, at: 178.0, in: 0, hold: true }   # hold: freeze the last frame if it runs short
fade_out: 1.0                       # picture and sound fade over the last second

music:                              # one entry per cue; overlapping fades make a crossfade
  - file: ../studio-music/ya-orbit.wav
    sha256: 9c1e…                   # music outside the repo is pinned by hash
    licence: YouTube Audio Library (no attribution)
    credit: ""
    at: 0                           # timeline second the cue starts
    in: 12.0                        # second of the file at `at` (it loops if it runs out)
    until: r3-0.5
    level: -9                       # LU under the voice with nobody speaking
    fade_in: 0.5
    fade_out: 2.0
    duck: { under: -11, attack: 0.3, hold: 0.2, release: 0.8, merge: 1.5 }   # dB down under speech; seconds
    ramps:                          # level changes on section boundaries
      - { at: r2-1.0, by: 4, over: 0.5 }      # swell into the grid wipe…
      - { at: r2, by: -4, over: 0.5 }         # …and back under the voice

sfx:
  - { file: client/public/sfx/beam.mp3, at: r2b.fresh-0.1, level: -12, why: helpers beam in }

captions:
  glossary: { "Claude code": "Claude Code", "sub agents": "subagents", "work tree": "worktree" }
  max_chars: 42
  max_lines: 2
  max_cps: 20
  mux: true                         # a mov_text track for local players; upload the .srt to YouTube
  burn: false

chapters:                           # YouTube: three or more, the first at 0:00, each 10 s or longer
  - { at: 0, title: One session alone }       # the 9.8 s hook folds in
  - { at: r2-0.2, title: Subagents }
  - { at: r3-0.2, title: Helpers with helpers }
  - { at: r4-0.2, title: Workflows }
  - { at: r5-0.2, title: Batch }
  - { at: recap-0.2, title: The ladder }

end_screen: { from: 178.0 }         # the last 5–20 s: elements are added in Studio
loudness: { integrated: -14, true_peak: -1.5 }
output: { file: out/ep1.mp4, crf: 18, preset: slow, audio_kbps: 384 }
```

The renderer writes `out/ep1.mp4`, `out/ep1.en.srt`, `out/ep1.chapters.txt` (the description block) and a report: the
measured loudness, the music-to-voice gap under speech, and every rule it could check that failed. Clips' transitions
are `cut` (the default), `dissolve` (xfade `fade`) or `dip` (xfade `fadeblack`), each with `over` in seconds. A
transition starts at the incoming clip's `at`, so the outgoing clip needs `over` seconds of picture past it.

## Sources

1. YouTube Help, [Measure key moments for audience retention](https://support.google.com/youtube/answer/9314415): the
   intro figure, spikes and dips, and the opening matching the title and thumbnail.
2. Tubefilter, [YouTube home feed autoplay](https://tubefilter.com/2018/12/03/youtube-boost-video-engagement-home-autoplay/)
   (2018): muted, captioned previews.
3. [How to succeed in MrBeast production](https://www.alexanderjarvis.com/memo-how-to-succeed-in-mrbeast-production/)
   (leaked memo, 2024): the first minute, re-engagement. One creator's opinion.
4. Walter Murch, *In the Blink of an Eye* (2001): the rule of six; via
   [UT Austin's notes](https://cloud.wikis.utexas.edu/wiki/spaces/rtf318/pages/80022510/Murch+s+Rule+of+Six).
5. Mayer's principles of multimedia learning: redundancy, temporal contiguity, signalling;
   [summary](https://www.digitallearninginstitute.com/blog/mayers-principles-multimedia-learning).
6. Guo, Kim & Rubin, [How video production affects student engagement](https://up.csail.mit.edu/other-pubs/las2014-pguo-engagement.pdf),
   L@S 2014: 6.9 million edX sessions; shorter, faster and more enthusiastic was more engaging.
7. James Cutting on shot lengths ([Cornell](https://news.cornell.edu/node/271563)); Tim Smith on match on action and
   attentional synchrony (via [director.md](director.md)'s sources).
8. Moreno & Mayer, [A coherence effect in multimedia learning](https://tecfa.unige.ch/tecfa/teaching/methodo/Moreno_Mayer00.pdf),
   2000: background music and sounds hurt recall and transfer.
9. Ian Shepherd, [YouTube loudness](https://productionadvice.co.uk/youtube-loudness/): normalised to −14 LUFS since
   2019. Measured by engineers; YouTube doesn't publish a figure.
10. YouTube Help, [Stable volume](https://support.google.com/youtube/answer/14106294): on by default.
11. AES TD1008 (2021), via [Production Advice](https://productionadvice.co.uk/td1008/): −18 LUFS for speech streams,
    −1 dBTP.
12. YouTube Help, [Supported subtitle and closed caption files](https://support.google.com/youtube/answer/2734698).
13. Netflix, [English (USA) Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977)
    and [General Requirements](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617).
14. YouTube Help, [Video chapters](https://support.google.com/youtube/answer/9884579).
15. YouTube Help, [Add end screens to videos](https://support.google.com/youtube/answer/6388789).
16. Feature requests for an end-screen API
    ([google-api-php-client #2514](https://github.com/googleapis/google-api-php-client/issues/2514)). No endpoint as of
    October 2026, as far as I could find.
17. YouTube Help, [Use music and sound effects from the Audio Library](https://support.google.com/youtube/answer/3376882).
18. No Film School, [YouTube Audio Library](https://nofilmschool.com/2013/09/youtube-audio-library-royalty-free-music-track)
    (2013), quoting its terms on standalone distribution. Check each track's licence in Studio.
19. Kenney, [Music Jingles](https://kenney.nl/assets/music-jingles) (CC0); [OpenGameArt](https://opengameart.org/)
    (filter the licence to CC0).
20. [incompetech licences](https://incompetech.com/music/royalty-free/licenses/): Creative Commons Attribution 4.0.
21. Pixabay, [licence summary](https://pixabay.com/service/license-summary/); on claims, Thematic's
    [Pixabay comparison](https://hellothematic.com/thematic-vs-pixabay/) (a competitor's view).

## Appendix: ffmpeg recipes

Tested on 2026-10-12 with Homebrew's ffmpeg 8.1 on macOS (Apple M-series), whisper-cli with
`ggml-large-v3-turbo-q5_0`, and these synthetic inputs: `testsrc2` (1080p30), `smptehdbars` (720p25), `mandelbrot`
(1080p60, 4:4:4), the real `stage-delegation/clip.mp4`, a narration made with macOS `say`, a chord bed from `aevalsrc`,
and `beam.mp3`. A prototype renderer built from these recipes rendered a 30 s test EDL end to end in 19 s. Its validator
caught a 9.5 s chapter and a loudness fallback.

**This build has no libass, freetype or fontconfig**, so there are no `subtitles`, `ass` or `drawtext` filters. A.10
works around that.

### A.1 Words and pauses

```sh
ffmpeg -i vo.wav -ar 16000 -ac 1 -c:a pcm_s16le vo16k.wav
whisper-cli -m ~/.focus/models/ggml-large-v3-turbo-q5_0.bin -f vo16k.wav -ml 1 -sow -ojf -of vo/ep1.words -np
ffmpeg -i vo.wav -af silencedetect=noise=-40dB:d=0.25 -f null -        # silence_start / silence_end on stderr
```

- `-ml 1 -sow` gives a segment per word in `transcription[].offsets` (milliseconds). Starts landed within 70 ms of
  the measured pause edges. Ends didn't: "Watch" lasted 10 ms, and "That's" 0 ms.
- `--prompt "Claude Code"` spelled it "Cloud Code" and stretched words across pauses: "window." ran 2.38–4.00 s over a
  1.1 s silence. Don't prompt; fix spellings with the glossary.
- `--dtw large.v3.turbo` does nothing (`t_dtw` stays −1) unless you add `-nfa`, because flash attention is on by
  default. With it, most words matched the plain run to within 60 ms, but "answer" started 0.57 s early, so it
  bought nothing here.

### A.2 Radio edit: tighten a pause

```sh
ffmpeg -i vo.wav -filter_complex "[0:a]atrim=0:7.33,asetpts=PTS-STARTPTS[a];[0:a]atrim=start=9.23,asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[v]" -map "[v]" vo-edit.wav
```

This took a 2.70 s pause down to 0.80 s (checked with `silencedetect`). Cut points inside a measured silence don't
click, so no crossfade is needed. Then re-transcribe.

### A.3 Conform a clip, frame-exact

Run each clip through the same chain, with `in` and `out` as frame numbers (`round(seconds × 30)`):

```
[0:v]setpts=PTS-STARTPTS,fps=30,trim=start_frame=IN:end_frame=OUT,setpts=PTS-STARTPTS,
     scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,
     format=yuv420p,settb=1/30[c0]
```

- Trim in frames, after `fps`. `trim=duration=4.267` kept 129 frames where 128 were meant, which put the cut a frame
  late.
- If the source runs out, add `tpad=stop_mode=clone:stop=N` after the trim to freeze the last frame (the EDL's `hold`).
- The same input can feed several chains (`[0:v]` twice): this is how one long stage take gets cut up.

### A.4 Cuts and transitions

Chain the clips left to right: `concat` for a cut, `xfade` for anything else. With each clip's length set to the next
clip's `at` plus its transition's `over`, minus its own `at`, an `xfade`'s `offset` is simply the timeline second the
transition starts:

```
[c0][c1]concat=n=2:v=1:a=0,settb=1/30[p1];
[p1][c2]xfade=transition=fade:duration=0.5:offset=8.0[p2];
[p2][c3]concat=n=2:v=1:a=0,settb=1/30[p3];
[p3][c4]xfade=transition=fadeblack:duration=0.4:offset=19.6,format=yuv420p[v]
```

This gave exactly 720 frames for 24 s, with each cut on its frame (checked a frame either side of each join; `fade`,
`fadeblack` and `wipeleft` tested). Gotchas:
- `xfade` refuses inputs that differ in size, frame rate or format ("First input link main parameters (size
  1920x1080) do not match…"), so conform everything first (A.3).
- `concat` outputs a 1/1000000 time base, which `xfade` refuses next to a 1/30 clip. `settb=AVTB` silences the error,
  but rounding then put the next cut a frame late (721 frames). Put `settb=1/30` after every clip and every `concat`.
- `xfade` with `duration=0` isn't a cut. It output 121 frames of 240 and dropped the second clip. Use `concat`.
- `xfade=transition=dissolve` is a dithered pixel dissolve. A film dissolve is `fade`, and a dip to black is
  `fadeblack`.
- `xfade` handed on yuv444p from yuv420p inputs, which x264 encoded as High 4:4:4. End the graph with
  `format=yuv420p`.
- For long graphs, use `-/filter_complex graph.txt`. `-filter_complex_script` still works, but it's deprecated in 8.1.
  Newlines after `;` are fine in the file.

### A.5 End-screen hold and fade

`…,tpad=stop_mode=clone:stop_duration=6,fade=t=out:st=29:d=1,format=yuv420p[v]` held the last frame for 6 s and faded
the final second (900 frames, checked).

### A.6 The voice on the timeline

```
[0:a]highpass=f=80,pan=stereo|c0=c0|c1=c0,adelay=300:all=1,apad=whole_dur=190,atrim=0:190[voice]
```

- Upmix with an explicit `pan`. Left to `aformat=channel_layouts=stereo`, mono goes to each channel at −3 dB: the
  peak fell from −1.69 to −4.70 dBFS, so the voice would sit 3 dB lower against stereo music than planned.
- `adelay` needs `all=1`, or it delays only the first channel.
- `apad=whole_dur` pads the voice to the full length, so `amix=duration=first` runs to the end.

### A.7 Music bed: loop, fades, ducking

```
-stream_loop -1 -i bed.wav     # an input option, before -i; or aloop=loop=-1:size=<samples>
[1:a]atrim=start=12:duration=40,asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,
     afade=t=in:d=0.5,afade=t=out:st=38:d=2,adelay=0:all=1,asetnsamples=n=240:p=0,
     volume='pow(10,(LEVEL+RAMPS)/20)*(1-DEPTH*(DUCK))':eval=frame[music]
```

The renderer builds the expression from the words. Merge words into speech regions, merging gaps shorter than
`merge`, and again where a swell would be under 1 s. Then sum a trapezoid per region:

```python
duck = '+'.join(f"clip((t-{s-attack})/{attack},0,1)*clip(({e+hold+release}-t)/{release},0,1)" for s, e in regions)
ramps = ''.join(f"+{r['by']}*clip((t-{r['at']})/{r['over']},0,1)" for r in cue['ramps'])
expr = f"pow(10,({level}{ramps})/20)*(1-{1 - 10**(under/20):.4f}*({duck}))"
```

- Measured with `volumedetect`, the envelope put the bed exactly 12.0 dB down under speech and left it untouched in the
  gaps.
- Put `volume` after `adelay`, so that `t` is timeline time. `eval=frame` steps the gain once per audio frame, and a
  WAV arrives in 4096-sample frames (85 ms), so a 0.3 s ramp would be four steps. `asetnsamples=n=240` makes them
  5 ms.
- The alternative, a sidechain compressor:
  `[voice]asplit[v][key];[bed][key]sidechaincompress=threshold=0.015:ratio=20:attack=30:release=600:knee=4[music]`.
  It ducked 9.6 dB under one sentence and 21 dB under another. The output also stops when the key ends (21 s of a 30 s
  bed) unless the key is padded with `apad=whole_dur`. A mono key into a stereo bed, and 44.1 kHz into 48 kHz, are
  converted automatically.

### A.8 Effects and the mix

```
[2:a]pan=stereo|c0=c0|c1=c0,volume=-8dB,adelay=4200:all=1[sfx0];
[voice][music][sfx0]amix=inputs=3:normalize=0:duration=first,atrim=0:190,afade=t=out:st=189:d=1[mix]
```

- `amix` divides by the number of inputs unless you pass `normalize=0`. With three inputs, the voice fell from −16.7
  to −26.2 LUFS.
- The same input can feed two effects through `asplit`.

### A.9 Loudness

Two passes with loudnorm, the first printing JSON and the second applying its measurements linearly:

```sh
ffmpeg -i mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=50:print_format=json -f null -
ffmpeg -i mix.wav -af loudnorm=I=-14:TP=-1.5:LRA=50:measured_I=…:measured_TP=…:measured_LRA=…:measured_thresh=…:offset=…:linear=true:print_format=json -ar 48000 -c:a pcm_s24le norm.wav
```

Check `normalization_type` in the second pass's JSON. On our 24 s test mix:

| Before loudnorm | LRA target | Result |
|---|---|---|
| nothing | 11 | dynamic: loudnorm measured LRA 17.7, where `ebur128` measured 6.5 for the same file |
| nothing | 20 | dynamic: +0.37 dB was needed, with only 0.06 dB of true-peak headroom |
| `alimiter=limit=0.7079:level=0` (−3 dBFS) | 20 | linear: −14.0 LUFS, −2.6 dBTP |

- Linear mode needs the target LRA at or above loudnorm's own LRA reading, which runs high on speech with pauses. Use
  `LRA=50`, its maximum.
- It also needs headroom: the peak plus the gain must stay under TP. A fixed −3 dBFS limiter wasn't enough when the mix
  needed +1.49 dB, which put the peak 0.03 dB over, so it fell back to dynamic. Set the limiter from the measured gain:
  `TP − gain − 0.5`.
- `alimiter` turns its auto-level on by default and raised the mix 3 dB to 0 dBFS. Pass `level=0`.
- loudnorm outputs 192 kHz. Add `-ar 48000`.
- loudnorm read −15.49 LUFS where `ebur128` read −15.2 for the same file. Verify with one meter:
  `ffmpeg -i out.mp4 -af ebur128=peak=true -f null -` (read the Summary's I and Peak).
- A simpler equivalent: measure I with `ebur128`, then apply `volume=<−14 − I>dB,alimiter=limit=<10^((TP−0.5)/20)>:level=0`.
  Verify, and run it again if limiting cost more than 0.5 LU.
- Encoding to AAC-LC at 384 kb/s left both readings unchanged (−14.0 LUFS, −2.6 dBTP before and after).

### A.10 Captions

- Build the SRT from the words in the renderer: break at sentence ends, at pauses of 0.4 s or more, and at 84
  characters. Hold each cue 0.3 s past its last word, but never into the next cue (leave a 2-frame gap). Enforce
  5/6–7 s and 20 characters a second, and split it into two balanced lines at the space nearest the middle.
- Mux it as a track for local players: `-i captions.srt -map 2:s -c:s mov_text -metadata:s:s:0 language=eng`. The
  track came back out unchanged, apart from CRLF line ends. Upload the `.srt` to YouTube itself (in Studio, or with
  the Data API's `captions.insert`): YouTube's list of supported formats doesn't mention a track inside the MP4.
- Burning in, when a cut-down needs it: without libass, render each cue to a transparent 1920 × 1080 PNG (Pillow), list
  them with blanks between in an ffconcat file (`file 003.png` / `duration 3.133333`, repeating the last entry, whose
  duration is otherwise ignored), and overlay them once:
  `[1:v]fps=30,format=rgba[c];[0:v][c]overlay=eof_action=pass,format=yuv420p[v]`. Tested: the cues appeared on
  time, snapped to frames, and the output kept all 720 frames. `brew install ffmpeg-full` (9.0.2) includes
  libass, but it's untested here.
- The stage's own caption bar sits where burned captions go, and collided with them in the test. Once the voice
  exists, the stage should drop it (the director's rule 5).

### A.11 Chapters

```
;FFMETADATA1
title=How Claude delegates
[CHAPTER]
TIMEBASE=1/1000
START=0
END=10100
title=One context window
```

`ffmpeg -i in.mp4 -i chapters.ffmeta -map 0 -map_metadata 1 -map_chapters 1 -c copy out.mp4` writes the chapters,
which `ffprobe -show_chapters` lists. It also adds a `bin_data` stream (QuickTime chapter text), which is harmless.
YouTube reads chapters only from the description, so write that too: `M:SS Title` per line, with seconds rounded down.

### A.12 Encode and deliver

```sh
ffmpeg … -map "[v]" -c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p -g 15 -bf 2 -flags +cgop \
       -map "[mix]" -c:a aac -b:a 384k -ar 48000 -movflags +faststart out.mp4
```

- These follow YouTube's recommended settings: H.264 High, 4:2:0, two B-frames, a closed GOP of half the frame rate,
  AAC-LC at 48 kHz, 384 kb/s stereo, and fast start.
- YouTube also asks for "no edit lists". ffmpeg writes them for B-frame delay and AAC priming (`media_time` 1024).
  `-use_editlist 0` drops them, but the video then starts 2 frames (67 ms) late. We keep ffmpeg's default; that it
  uploads fine is inference, not tested.
- It's deterministic: two renders of the same graph on the same machine gave the same SHA-256. Pin the ffmpeg
  version in the render report, since another build may differ.
