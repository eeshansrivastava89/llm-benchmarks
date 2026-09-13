/*
 * Shared dataset for the offgrid-ai-benchmark viewer mockups.
 * Every value below is REAL — extracted from actual metadata.json files
 * in runs/ and public/export/. No metric is invented.
 *
 * Image paths are relative to the mockups/ folder (../runs/... or ../public/export/...).
 * Verified to exist on disk before embedding.
 */
(function () {
  "use strict";

  // 14 diverse real runs (mix of benchmarks, models, backends, FPS outcomes).
  var RUNS = [
    { bench:"snow-globe-village", title:"Snow Globe Village", kind:"visual",
      model:"Qwen3.6-35B-A3B-UD-Q4_K_XL", modelDisplay:"Qwen 3.6 35B A3B UD Q4_K_XL",
      src:"llama-cpp-mtp", backend:"llama.cpp MTP", harness:"Pi",
      fps:120, minFps:12, frames:192, vp:{w:1600,h:900},
      promptTok:30137, compTok:39548, totalTok:1367709, tokReported:true,
      prefill:84.44, gen:47.66, ttft:236.87, kv:0, specAccept:0.612,
      wallMs:1359645, turns:32, toolCalls:32, success:true, perTurnCount:32,
      date:"2026-06-13", img:"../public/export/runs/snow-globe-village/qwen3-6-35b-a3b-ud-q4-k-xl-7a6bf09482/2026-06-13T21-41-08-390Z/preview.png" },

    { bench:"sakura", title:"Sakura Tree", kind:"visual",
      model:"Qwen3.6-35B-A3B-OptiQ-4bit", modelDisplay:"Qwen 3.6 35B A3B OptiQ 4bit",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:120, minFps:12, frames:193, vp:{w:1600,h:900},
      promptTok:156613, compTok:78072, totalTok:234685, tokReported:true,
      prefill:58.44, gen:64.63, ttft:340, kv:0, specAccept:null,
      wallMs:2549485, turns:62, toolCalls:61, success:true, perTurnCount:62,
      date:"2026-06-16", img:"../runs/sakura/qwen3-6-35b-a3b-optiq-4bit-df902d2bed/2026-06-16T03-35-19-013Z/preview.png" },

    { bench:"macro-wildflower-meadow", title:"Macro Wildflower Meadow", kind:"visual",
      model:"gemma-4-26B-A4B-it-UD-Q3_K_M", modelDisplay:"Gemma 4 26B A4B UD Q3_K_M",
      src:"llama-cpp", backend:"llama.cpp", harness:"Pi",
      fps:120, minFps:12, frames:193, vp:{w:1600,h:900},
      promptTok:36089, compTok:22130, totalTok:226271, tokReported:true,
      prefill:64.88, gen:26.81, ttft:400.72, kv:0, specAccept:null,
      wallMs:1145097, turns:16, toolCalls:15, success:true, perTurnCount:16,
      date:"2026-06-13", img:"../public/export/runs/macro-wildflower-meadow/gemma-4-26b-a4b-it-ud-q3-k-m-04d0d0544d/2026-06-13T21-44-21-937Z/preview.png" },

    { bench:"sunset-ocean-study", title:"Sunset Ocean Study", kind:"visual",
      model:"Qwopus3.6-35B-A3B-v1-Q5_K_M", modelDisplay:"Qwopus 3.6 35B A3B v1 Q5_K_M",
      src:"llama-cpp", backend:"llama.cpp", harness:"Pi",
      fps:120, minFps:12, frames:192, vp:{w:1600,h:900},
      promptTok:158769, compTok:59683, totalTok:218452, tokReported:true,
      prefill:null, gen:null, ttft:null, kv:0, specAccept:null,
      wallMs:3929432, turns:111, toolCalls:109, success:true, perTurnCount:110,
      date:"2026-06-16", img:"../runs/sunset-ocean-study/qwopus3-6-35b-a3b-v1-q5-k-m-4346a287b3/2026-06-16T00-18-01-709Z/preview.png" },

    { bench:"sakura", title:"Sakura Tree", kind:"visual",
      model:"Qwen3.6-35B-A3B-UD-MLX-4bit", modelDisplay:"Qwen 3.6 35B A3B 4bit UD-MLX",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:120, minFps:12, frames:193, vp:{w:1600,h:900},
      promptTok:118547, compTok:48490, totalTok:167037, tokReported:true,
      prefill:63.12, gen:63.35, ttft:320, kv:0, specAccept:null,
      wallMs:1439758, turns:59, toolCalls:61, success:true, perTurnCount:59,
      date:"2026-06-16", img:"../runs/sakura/qwen3-6-35b-a3b-ud-mlx-4bit-42cea9e4cc/2026-06-16T03-08-19-664Z/preview.png" },

    { bench:"snow-globe-village", title:"Snow Globe Village", kind:"visual",
      model:"gemma-4-26B-A4B-it-qat-UD-Q4_K_XL", modelDisplay:"Gemma 4 26B A4B QAT UD Q4_K_XL",
      src:"llama-cpp-mtp", backend:"llama.cpp MTP", harness:"Pi",
      fps:120, minFps:12, frames:192, vp:{w:1600,h:900},
      promptTok:21760, compTok:9679, totalTok:130973, tokReported:true,
      prefill:147.68, gen:59.95, ttft:176.05, kv:0, specAccept:0.581,
      wallMs:232141, turns:8, toolCalls:7, success:true, perTurnCount:8,
      date:"2026-06-13", img:"../public/export/runs/snow-globe-village/gemma-4-26b-a4b-it-qat-ud-q4-k-xl-66aa09c38f/2026-06-13T21-27-26-625Z/preview.png" },

    { bench:"snow-globe-village", title:"Snow Globe Village", kind:"visual",
      model:"Qwen3.6-35B-A3B-OptiQ-4bit", modelDisplay:"Qwen 3.6 35B A3B OptiQ 4bit",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:120, minFps:12, frames:193, vp:{w:1600,h:900},
      promptTok:80611, compTok:46021, totalTok:126632, tokReported:true,
      prefill:53.18, gen:60.62, ttft:380, kv:0, specAccept:null,
      wallMs:1203844, turns:25, toolCalls:24, success:true, perTurnCount:25,
      date:"2026-06-16", img:"../runs/snow-globe-village/qwen3-6-35b-a3b-optiq-4bit-df902d2bed/2026-06-16T05-16-35-302Z/preview.png" },

    { bench:"macro-wildflower-meadow", title:"Macro Wildflower Meadow", kind:"visual",
      model:"Qwopus3.6-35B-A3B-v1-Q4_K_S", modelDisplay:"Qwopus 3.6 35B A3B v1 Q4_K_S",
      src:"llama-cpp", backend:"llama.cpp", harness:"Pi",
      fps:120.1, minFps:12, frames:193, vp:{w:1600,h:900},
      promptTok:70725, compTok:52146, totalTok:122871, tokReported:true,
      prefill:143.06, gen:56.0, ttft:139.81, kv:0, specAccept:null,
      wallMs:1925039, turns:35, toolCalls:43, success:true, perTurnCount:35,
      date:"2026-06-15", img:"../public/export/runs/macro-wildflower-meadow/qwopus3-6-35b-a3b-v1-q4-k-s-93de8463b5/2026-06-15T03-43-16-268Z/preview.png" },

    { bench:"sakura", title:"Sakura Tree", kind:"visual",
      model:"Qwen3.6-35B-A3B-OptiQ-4bit", modelDisplay:"Qwen 3.6 35B A3B OptiQ 4bit",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:120, minFps:12, frames:193, vp:{w:1600,h:900},
      promptTok:87080, compTok:26887, totalTok:113967, tokReported:true,
      prefill:58.62, gen:64.99, ttft:340, kv:0, specAccept:null,
      wallMs:789331, turns:43, toolCalls:45, success:true, perTurnCount:43,
      date:"2026-06-16", img:"../runs/sakura/qwen3-6-35b-a3b-optiq-4bit-df902d2bed/2026-06-16T02-17-19-026Z/preview.png" },

    { bench:"macro-wildflower-meadow", title:"Macro Wildflower Meadow", kind:"visual",
      model:"Qwen3.6-35B-A3B-UD-MLX-4bit", modelDisplay:"Qwen 3.6 35B A3B 4bit UD-MLX",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:4.8, minFps:12, frames:8, vp:{w:1600,h:900},
      promptTok:81985, compTok:28662, totalTok:110647, tokReported:true,
      prefill:53.74, gen:34.17, ttft:370, kv:0, specAccept:null,
      wallMs:1595085, turns:38, toolCalls:39, success:true, perTurnCount:38,
      date:"2026-06-16", img:"../runs/macro-wildflower-meadow/qwen3-6-35b-a3b-ud-mlx-4bit-42cea9e4cc/2026-06-16T04-28-18-519Z/preview.png" },

    { bench:"snow-globe-village", title:"Snow Globe Village", kind:"visual",
      model:"Qwen3.6-35B-A3B-UD-MLX-4bit", modelDisplay:"Qwen 3.6 35B A3B 4bit UD-MLX",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:120, minFps:12, frames:192, vp:{w:1600,h:900},
      promptTok:78902, compTok:29667, totalTok:108569, tokReported:true,
      prefill:63.92, gen:64.47, ttft:310, kv:0, specAccept:null,
      wallMs:826550, turns:33, toolCalls:32, success:true, perTurnCount:33,
      date:"2026-06-16", img:"../runs/snow-globe-village/qwen3-6-35b-a3b-ud-mlx-4bit-42cea9e4cc/2026-06-16T04-56-59-890Z/preview.png" },

    { bench:"sakura", title:"Sakura Tree", kind:"visual",
      model:"Qwen3.6-35B-A3B-UD-MLX-4bit", modelDisplay:"Qwen 3.6 35B A3B 4bit UD-MLX",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:1.5, minFps:12, frames:3, vp:{w:1600,h:900},
      promptTok:75583, compTok:22717, totalTok:98300, tokReported:true,
      prefill:54.81, gen:63.56, ttft:360, kv:0, specAccept:null,
      wallMs:619489, turns:31, toolCalls:31, success:true, perTurnCount:31,
      date:"2026-06-16", img:"../runs/sakura/qwen3-6-35b-a3b-ud-mlx-4bit-42cea9e4cc/2026-06-16T02-36-00-363Z/preview.png" },

    { bench:"macro-wildflower-meadow", title:"Macro Wildflower Meadow", kind:"visual",
      model:"Qwen3.6-35B-A3B-UD-MLX-4bit", modelDisplay:"Qwen 3.6 35B A3B 4bit UD-MLX",
      src:"omlx", backend:"oMLX", harness:"Pi",
      fps:17, minFps:12, frames:28, vp:{w:1600,h:900},
      promptTok:66413, compTok:30979, totalTok:97392, tokReported:true,
      prefill:55.42, gen:63.86, ttft:360, kv:0, specAccept:null,
      wallMs:791535, turns:24, toolCalls:30, success:true, perTurnCount:24,
      date:"2026-06-16", img:"../runs/macro-wildflower-meadow/qwen3-6-35b-a3b-ud-mlx-4bit-42cea9e4cc/2026-06-16T02-52-46-693Z/preview.png" },

    { bench:"macro-wildflower-meadow", title:"Macro Wildflower Meadow", kind:"visual",
      model:"Qwen3.6-35B-A3B-UD-Q4_K_XL", modelDisplay:"Qwen 3.6 35B A3B UD Q4_K_XL",
      src:"llama-cpp-mtp", backend:"llama.cpp MTP", harness:"Pi",
      fps:120.3, minFps:12, frames:193, vp:{w:1600,h:900},
      promptTok:29854, compTok:53178, totalTok:83032, tokReported:true,
      prefill:124.37, gen:53.84, ttft:160.81, kv:0, specAccept:0.701,
      wallMs:2163511, turns:56, toolCalls:55, success:true, perTurnCount:56,
      date:"2026-06-15", img:"../public/export/runs/macro-wildflower-meadow/qwen3-6-35b-a3b-ud-q4-k-xl-7a6bf09482/2026-06-15T04-20-01-828Z/preview.png" }
  ];

  // ---- formatting helpers (all derived from real values) ----
  function fmtTok(n){ if(n==null) return "—"; if(n>=1e6) return (n/1e6).toFixed(2)+"M"; if(n>=1e3) return (n/1e3).toFixed(n>=1e5?0:1)+"k"; return String(n); }
  function fmtMs(ms){ if(ms==null) return "—"; var s=ms/1000; if(s<60) return s.toFixed(0)+"s"; var m=s/60; if(m<60) return m.toFixed(m<10?1:0)+" min"; var h=m/60; return h.toFixed(1)+"h"; }
  function fmtNum(n,d){ if(n==null) return "—"; return Number(n).toFixed(d==null?1:d); }
  function fmtPct(n,d){ if(n==null) return "—"; return (n*100).toFixed(d==null?0:d)+"%"; }
  // FPS vs 12fps budget tone (real budget from capture.quality.minFps)
  function fpsTone(fps,min){ if(fps==null) return "na"; if(fps>=(min||12)*2.5) return "champ"; if(fps>=(min||12)) return "good"; if(fps>=(min||12)*0.5) return "slow"; return "fail"; }
  // backend/harness color tone (mirrors the real stack-tones.ts mapping)
  function srcTone(src){ return { "omlx":"omlx","llama-cpp":"llamacpp","llama-cpp-mtp":"llamacpp-mtp","ollama":"ollama","cloud":"cloud" }[src] || "unknown"; }
  function harnessTone(h){ var v=String(h||"").toLowerCase(); if(/\bpi\b/.test(v)) return "pi"; if(/opencode/.test(v)) return "opencode"; if(/hermes/.test(v)) return "hermes"; if(/manual/.test(v)) return "manual"; return "harness"; }
  // token split percentages
  function tokSplit(r){ var t=r.totalTok||1; return { prompt:(r.promptTok/t*100), comp:(r.compTok/t*100) }; }
  // simple sparkline path from values
  function sparkline(vals,w,h){ if(!vals||!vals.length) return ""; var mx=Math.max.apply(null,vals),mn=Math.min.apply(null,vals); var rng=(mx-mn)||1; var step=w/(vals.length-1||1); return vals.map(function(v,i){ return (i===0?"M":"L")+(i*step).toFixed(1)+","+(h-((v-mn)/rng)*h).toFixed(1); }).join(" "); }
  // a synthetic-but-realistic per-turn token profile shape, scaled to the run's real totals.
  // (Used only for visualization rhythm; the totals/turns/wall-clock shown are real.)
  function perTurnProfile(r){
    var n=Math.max(2, Math.min(r.perTurnCount||r.turns||10, 64));
    var out=[]; for(var i=0;i<n;i++){
      var phase=i/n;
      // input tokens ramp up (context grows), output is bursty
      var inp=0.15+0.85*phase + 0.25*Math.sin(phase*9);
      var outp=0.2+0.5*Math.abs(Math.sin(phase*6.3)) + (i%5===0?0.3:0);
      out.push({inp:Math.max(0,inp), out:Math.max(0,outp)});
    }
    return out;
  }

  window.RUNS = RUNS;
  window.BENCH_UTIL = { fmtTok:fmtTok, fmtMs:fmtMs, fmtNum:fmtNum, fmtPct:fmtPct,
    fpsTone:fpsTone, srcTone:srcTone, harnessTone:harnessTone, tokSplit:tokSplit,
    sparkline:sparkline, perTurnProfile:perTurnProfile };

  // unique benchmarks for filter chips
  window.BENCHMARKS = Array.from(new Set(RUNS.map(function(r){return r.bench;})))
    .map(function(id){ return {id:id, title: RUNS.find(function(r){return r.bench===id;}).title}; });
})();