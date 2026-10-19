# Voice input

Every box where you write to the crew has a **Mic** button: an agent's message box, a new goal, the New issue idea, notes, title and description, and the QA brief. Click it (or press **Ctrl+M** in the box) and speak, then click again to stop, or hold it while you speak and let go. The text lands at the cursor for you to check. Nothing is sent until you send it (except in Number One's [voice mode](../plugins/number-one/README.md#voice-mode)).

[whisper.cpp](https://github.com/ggml-org/whisper.cpp) transcribes on your machine with the `large-v3-turbo` model, so your audio never leaves it. On Apple Silicon it runs on the GPU. Set it up once:

1. `brew install whisper-cpp` (it provides `whisper-cli`).
2. **Ready room → Settings → Voice input → Download model** fetches `ggml-large-v3-turbo-q5_0.bin` (574 MB) into `~/.focus/models/`. Or download it yourself from [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin) into that folder.

Until both are there, the Mic buttons are greyed out, and their tooltip says what's missing. `FOCUS_WHISPER_BIN` and `FOCUS_WHISPER_MODEL` point at a different `whisper-cli` or model file. In demo mode, every recording transcribes to the same demo sentence.
