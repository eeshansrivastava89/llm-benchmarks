# Running Qwen3.6 with Multi-Token Prediction in llama.cpp

*Accurate as of May 18, 2026.*

Multi-Token Prediction (MTP) uses the model's built-in prediction heads to draft multiple tokens in parallel, then verifies them against the main model. For Qwen3.6, this yields **~1.5–2× faster generation** with no accuracy loss.

This guide covers the **Qwen3.6 27B** and **Qwen3.6 35B-A3B (MoE)** models. As of May 2026, MTP support is merged into llama.cpp — no fork required.

---

## Step 1 — Build llama.cpp

MTP landed in llama.cpp via [PR #22673](https://github.com/ggml-org/llama.cpp/pull/22673) (merged May 16, 2026). Clone the official repo and build for Apple Silicon:

```bash
git clone https://github.com/ggml-org/llama.cpp
cmake -B llama.cpp/build -DBUILD_SHARED_LIBS=OFF
cmake --build llama.cpp/build --config Release -j
```

The binary ends up at `llama.cpp/build/bin/llama-server`.

## Step 2 — Download an MTP GGUF model

You **must** use an MTP-converted GGUF — standard Qwen3.6 GGUFs don't include the prediction heads. Download the MTP variant directly from [LM Studio](https://lmstudio.ai):

| Model | Search in LM Studio |
|---|---|
| Qwen3.6 27B | `unsloth/Qwen3.6-27B-MTP-GGUF` |
| Qwen3.6 35B-A3B (MoE) | `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` |

**Recommended quantizations:**

| Quant | Use case |
|---|---|
| `Q4_K_S` or `UD-Q4_K_S` | Fits in less RAM; good quality-to-size ratio |
| `UD-Q4_K_XL` | Better quality; slightly larger |
| `Q8_0` | Near-lossless; needs much more RAM |

Each model download also includes an `mmproj-F32.gguf` — that's the vision encoder. You'll need it in Step 3.

## Step 3 — Run with MTP

```bash
./llama-server \
  -m Qwen3.6-27B-Q4_K_S.gguf \
  --mmproj mmproj-F32.gguf \
  --spec-type draft-mtp \
  --spec-draft-n-max 2 \
  -c 8192 \
  -fa on \
  -np 1 \
  --jinja \
  --cache-type-k q8_0 \
  --cache-type-v q8_0 \
  --temp 0.6 \
  --top-p 0.95 \
  --top-k 20 \
  --min-p 0.0 \
  --presence-penalty 0 \
  --repeat-penalty 1
```

Replace the model filename if you're using a different quant or the 35B-A3B variant (e.g. `Qwen3.6-35B-A3B-UD-Q4_K_S.gguf`). The rest of the flags stay the same.

### Skip LM Studio? Auto-download from HuggingFace

Replace the `-m` and `--mmproj` lines with `-hf` to have llama-server download the model automatically:

```diff
  ./llama-server \
-   -m Qwen3.6-27B-Q4_K_S.gguf \
-   --mmproj mmproj-F32.gguf \
+   -hf unsloth/Qwen3.6-27B-MTP-GGUF:Q4_K_S \
+   -ngl 99 \
    --spec-type draft-mtp \
    --spec-draft-n-max 2 \
    -c 8192 \
```

### Key flags

| Flag | Meaning |
|---|---|
| `--spec-type draft-mtp` | Enable MTP speculative decoding |
| `--spec-draft-n-max 2` | Draft 2 tokens ahead (use 3 for more speed, 2 for better acceptance rate) |
| `-c 8192` | Context window size (Qwen3.6 supports up to 262K) |
| `-fa on` | Flash attention |
| `-np 1` | Parallel slots — currently must be 1 with MTP |
| `--jinja` | Use Jinja2 chat template rendering |
| `--cache-type-k q8_0` / `--cache-type-v q8_0` | Quantized KV cache (saves RAM with negligible quality loss) |

### Sampling parameters

Qwen3.6's recommended settings for **coding tasks**:

```
--temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.0 --presence-penalty 0 --repeat-penalty 1
```

For **general tasks** (thinking mode):

```
--temp 1.0 --top-p 0.95 --top-k 20
```

---

## What to expect

On an M-series Mac, baseline (no MTP) is typically ~7 tok/s for Qwen3.6 27B Q8_0. With MTP `--spec-draft-n-max 2`, that jumps to ~16 tok/s with an 82% acceptance rate. With `--spec-draft-n-max 3`, you can hit ~18–21 tok/s at ~72% acceptance. Your mileage will vary by hardware, quant, and workload.

---

## Links

- llama.cpp MTP PR: [ggml-org/llama.cpp#22673](https://github.com/ggml-org/llama.cpp/pull/22673)
- llama.cpp repo: [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)
- Qwen3.6 27B MTP GGUF (Unsloth): [unsloth/Qwen3.6-27B-MTP-GGUF](https://huggingface.co/unsloth/Qwen3.6-27B-MTP-GGUF)
- Qwen3.6 35B-A3B MTP GGUF (Unsloth): [unsloth/Qwen3.6-35B-A3B-MTP-GGUF](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF)

---

*By [Eeshan](https://github.com/eeshansrivastava89). Check out my local AI benchmarking experiments at [localai.eeshans.com](https://localai.eeshans.com/).*