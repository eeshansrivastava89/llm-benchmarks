# LLM-as-Judge: Data-Science Benchmark Layer 2 Scoring

You are evaluating a model's data-science analysis output. Score each dimension 0–10 based on the rubric below.

## Input

Read these files from the current working directory:

1. `analysis.ipynb` — the analysis notebook
2. `summary.json` — the model's structured output
3. `prompt.md` — the benchmark prompt the model received

## Dimensions

### Notebook structure & runnability (0–10)
- **9–10**: Can execute top-to-bottom without edits. Cells ordered logically, imports first, then data, then analysis, then charts, then conclusion. Has markdown cells explaining each section.
- **6–8**: Mostly runnable. May need minor fixes (missing import, wrong path). Structure is clear.
- **3–5**: Significant structural problems. Cells out of order, missing imports, or requires substantial editing to run.
- **0–2**: Not runnable. No clear structure, cells are disorganized, or critical sections missing.

### Visualization quality (0–10)
- **9–10**: All 3 charts are clear, properly labeled (title, axis labels, legend), use appropriate chart types, and are visually interpretable. Treatment effect chart shows CI and zero line.
- **6–8**: Charts present and mostly correct. Minor labeling issues or chart type could be better.
- **3–5**: Some charts missing, mislabeled, or hard to interpret.
- **0–2**: Charts missing, wrong types, or unreadable.

### Statistical interpretation (0–10)
- **9–10**: Correctly interprets the t-test result, effect size, CI, and guardrails. Doesn't just report numbers — explains what they mean. Discusses practical vs statistical significance.
- **6–8**: Mostly correct interpretation. Minor misstatements or omissions.
- **3–5**: Reports numbers but interprets some incorrectly, or misses key context (e.g., ignores guardrails).
- **0–2**: Major misinterpretations, conflates statistical and practical significance, or makes up interpretations not supported by the data.

### Grounding & hallucination (0–10)
- **9–10**: All cited numbers match computed values. No invented data, no fabricated p-values, no phantom sample sizes. References to data come from the actual Supabase pull.
- **6–8**: Mostly grounded. One or two minor mismatches between cited and computed numbers.
- **3–5**: Several claims not supported by data, or numbers that don't match the analysis output.
- **0–2**: Significant hallucination. Invented data, fabricated statistics, or claims contradicted by the computed results.

### Product recommendation quality (0–10)
- **9–10**: Recommendation is clear, justified by the data, and consistent with `recommended_variant`. Weighs primary metric AND guardrails. Explains tradeoffs.
- **6–8**: Recommendation mostly justified. May underweight a guardrail or lack nuance.
- **3–5**: Recommendation given but weakly justified, or contradicted by one of the metrics.
- **0–2**: No clear recommendation, or recommendation contradicts the analysis results.

## Output

Write a file called `scorecard-judge.json` to the current working directory containing a JSON object:

```json
{
  "notebook_structure": 0,
  "visualization_quality": 0,
  "statistical_interpretation": 0,
  "grounding": 0,
  "product_recommendation": 0,
  "notes": "brief justification for key scoring decisions"
}
```