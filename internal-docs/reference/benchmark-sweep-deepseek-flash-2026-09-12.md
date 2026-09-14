# DeepSeek Flash Inspect Evals compatibility sweep

**Date:** 2026-09-12

**Environment:** macOS arm64; Python 3.12.12; Inspect AI 0.3.263; Inspect Evals 0.17.0

**Model:** `deepseek/deepseek-flash` through Pi (`openai-completions`)

The CSV and machine-readable data were rechecked during the documentation consolidation: they contain 247 unique tasks with the same 100 passed, 137 blocked, and 10 inconclusive totals. The installed package versions still match the versions above.

## Executive result

100 of 247 registered tasks (40.5%) completed one sample with a final Inspect log status of `success`. A process exit code of zero was not treated as success when the resulting Inspect log had `status: error`.

- Passed: **100**
- Blocked: **137**
- Inconclusive after the extended timeout: **10**

The run used about **957,641 DeepSeek input tokens** and **432,260 DeepSeek output tokens** recorded in completed sample logs. At the configured Pi rates, that is approximately **$0.81**. Auxiliary graders may have separate usage not included in that estimate.

## Method

- Every one of the 247 registered `inspect_evals` task names was attempted.
- Each task used `--limit 1 --sample-shuffle 42 --max-connections 1`.
- No token limit or message limit was imposed.
- The first pass used a two-minute process watchdog. Timeouts were retried with a nominal ten-minute watchdog.
- Docker was installed but its daemon was intentionally not started. Gated access, missing packages, and extra credentials were not repaired during the sweep.
- Runs used official task defaults. Some defaults multiply work through epochs or invoke auxiliary judge models.
- `passed` means one sample completed and Inspect wrote `status: success`; it does not establish benchmark quality or statistical validity.

## Non-passing result breakdown

The table includes all 147 non-passing tasks: 137 blocked tasks plus the 10 inconclusive timeouts.

| Category | Tasks | Primary owner |
|---|---:|---|
| `sandbox_unavailable` | 41 | User setup / Bench preflight |
| `credential_or_aux_model` | 31 | User/task configuration |
| `missing_dependency` | 22 | Bench/project environment |
| `upstream_asset_error` | 18 | Upstream Inspect Evals |
| `gated_access` | 13 | User setup |
| `timeout_or_too_heavy` | 10 | Inconclusive / task workload |
| `model_incompatible` | 5 | Model choice / upstream task |
| `network_or_remote_service` | 2 | Transient / remote service |
| `missing_configuration` | 2 | User/task configuration |
| `runtime_error` | 2 | Needs investigation |
| `missing_asset` | 1 | User setup / upstream task |

## Initial recommendation

### General-purpose candidates

These completed cleanly and cover common reasoning, knowledge, mathematics, bias, or QA use cases without requiring a specialized agent environment:

`agie_aqua_rat`, `agie_logiqa_en`, `agie_math`, `arc_challenge`, `arc_easy`, `bbq`, `commonsense_qa`, `gpqa_diamond`, `gsm8k`, `hellaswag`, `mmlu_0_shot`, `mmlu_5_shot`, `mmlu_pro`, `piqa`, `squad`, `truthfulqa`, `winogrande`

Treat overlapping families as alternatives rather than running every variant: choose one MMLU mode, a small number of AGIEval subsets, and task-appropriate difficulty levels.

### Specialized candidates

83 additional tasks passed, but they are primarily cybersecurity, agent, long-context, safety, or domain-specific evaluations. They should remain searchable rather than appear in a short default recommendation list.

### Do not classify setup failures as bad benchmarks

Missing dependencies, Docker, gated datasets, and auxiliary credentials are conditional setup failures. They justify badges and preflight checks, not removal from the catalog.

### Deprioritize currently broken upstream assets

The GDM self-proliferation family repeatedly requested a versioned `secrets.zip` URL that returned HTTP 404. These variants should not be recommended until the installed release or upstream asset is fixed.

## What Bench can improve

- Show official `isolated`, sandbox, internet, and external-asset badges before launch.
- Check Docker availability, Python import availability, and Hugging Face gated access on demand.
- Detect task defaults that require auxiliary grader models or unrelated API credentials.
- Support isolated task environments without polluting the main project environment.
- Read final Inspect log status and surface the concise root error; process exit status alone is insufficient.
- Maintain a generated compatibility cache keyed by Inspect Evals version, Inspect version, model, and environment.

## What Bench cannot fix

- Grant gated-dataset access or accept licenses for the user.
- Supply Docker, external services, benchmark-specific secrets, or third-party grader credentials.
- Make a model support an incompatible tool, image, or reasoning API behavior.
- Repair missing upstream assets or defects inside the installed benchmark implementation.
- Decide benchmark relevance from smoke-test success alone; curation still requires product judgment.

## Successful tasks by official group

### Assistants (6)

`assistant_bench_closed_book_one_shot`, `assistant_bench_closed_book_zero_shot`, `bfcl`, `sycophancy`, `tau2_airline`, `tau2_retail`

### Bias (1)

`bbq`

### Cybersecurity (15)

`cybermetric_10000`, `cybermetric_2000`, `cybermetric_500`, `cybermetric_80`, `cyse4_autocomplete`, `cyse4_instruct`, `cyse4_malware_analysis`, `cyse4_mitre`, `cyse4_mitre_frr`, `sec_qa_v1`, `sec_qa_v1_5_shot`, `sec_qa_v2`, `sec_qa_v2_5_shot`, `sevenllm_mcq_en`, `sevenllm_mcq_zh`

### Knowledge (23)

`agie_aqua_rat`, `agie_logiqa_en`, `agie_lsat_ar`, `agie_lsat_lr`, `agie_lsat_rc`, `agie_math`, `agie_sat_en`, `agie_sat_en_without_passage`, `agie_sat_math`, `air_bench`, `chembench`, `commonsense_qa`, `gpqa_diamond`, `macbench`, `medqa`, `mmlu_0_shot`, `mmlu_5_shot`, `mmlu_pro`, `onet_m6`, `pre_flight`, `pubmedqa`, `sciknoweval`, `truthfulqa`

### Mathematics (6)

`aime2024`, `aime2025`, `aime2026`, `gsm8k`, `mathvista`, `mgsm`

### Multimodal (2)

`docvqa`, `vstar_bench_spatial_relationship_reasoning`

### Personality (1)

`personality_BFI`

### Reasoning (26)

`arc_challenge`, `arc_easy`, `bbeh`, `bbeh_mini`, `bbh`, `boolq`, `drop`, `hellaswag`, `infinite_bench_code_debug`, `infinite_bench_code_run`, `infinite_bench_kv_retrieval`, `infinite_bench_longbook_choice_eng`, `infinite_bench_longdialogue_qa_eng`, `infinite_bench_math_calc`, `infinite_bench_math_find`, `infinite_bench_number_string`, `infinite_bench_passkey`, `lingoly_too`, `musr`, `niah`, `paws`, `piqa`, `race_h`, `squad`, `winogrande`, `worldsense`

### Safeguards (15)

`agent_threat_bench_autonomy_hijack`, `agent_threat_bench_data_exfil`, `agent_threat_bench_memory_poison`, `lab_bench_cloning_scenarios`, `lab_bench_dbqa`, `lab_bench_figqa`, `lab_bench_litqa`, `lab_bench_protocolqa`, `lab_bench_seqqa`, `lab_bench_suppqa`, `lab_bench_tableqa`, `stereoset`, `wmdp_bio`, `wmdp_chem`, `wmdp_cyber`

### Scheming (5)

`sad_facts_human_defaults`, `sad_facts_llms`, `sad_influence`, `sad_stages_full`, `sad_stages_oversight`

## Complete task matrix

The CSV beside this report is easier to filter: `internal-docs/reference/benchmark-sweep-deepseek-flash-2026-09-12.csv`.

| Task | Group | Result | Category | Recommendation | Diagnostic |
|---|---|---|---|---|---|
| `abstention_bench` | Safeguards | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'hydra' |
| `agent_bench_os` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `agent_threat_bench_autonomy_hijack` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agent_threat_bench_data_exfil` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agent_threat_bench_memory_poison` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agentdojo` | Safeguards | blocked | `missing_dependency` | `conditional_after_setup` | ImportError: email-validator is not installed, run `pip install 'pydantic[email]'` |
| `agentharm` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `agentharm_benign` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `agentic_misalignment` | Scheming | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise Anthropic client |
| `agie_aqua_rat` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_logiqa_en` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_lsat_ar` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_lsat_lr` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_lsat_rc` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_math` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_sat_en` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_sat_en_without_passage` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `agie_sat_math` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `aime2024` | Mathematics | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `aime2025` | Mathematics | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `aime2026` | Mathematics | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `air_bench` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `anima` | Safeguards | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `ape_eval` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `apps` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `arc_challenge` | Reasoning | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `arc_easy` | Reasoning | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `assistant_bench_closed_book_one_shot` | Assistants | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `assistant_bench_closed_book_zero_shot` | Assistants | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `assistant_bench_web_browser` | Assistants | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `assistant_bench_web_search_one_shot` | Assistants | blocked | `credential_or_aux_model` | `conditional_after_setup` | ValueError: No valid provider found. |
| `assistant_bench_web_search_zero_shot` | Assistants | blocked | `credential_or_aux_model` | `conditional_after_setup` | ValueError: No valid provider found. |
| `b3` | Safeguards | blocked | `missing_dependency` | `conditional_after_setup` | ImportError: rouge_score is not installed. Install with `uv sync --extra b3` to run the b3 benchmark. |
| `bbeh` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `bbeh_mini` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `bbh` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `bbq` | Bias | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `bfcl` | Assistants | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `bigcodebench` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `bold` | Bias | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'torch' |
| `boolq` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `browse_comp` | Assistants | blocked | `credential_or_aux_model` | `conditional_after_setup` | ValueError: No model specified (and no model environment variable defined) |
| `chembench` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `class_eval` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `coconot` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `commonsense_qa` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `compute_eval` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `core_bench` | Coding | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `cti_realm_25` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | RuntimeError: Command failed: docker compose -p inspect-cti-realm-shared -f <installed inspect_evals>/cti_realm/docker/shared_services.yaml up -d --build kusto-emulator kusto-init |
| `cti_realm_25_minimal` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | RuntimeError: Command failed: docker compose -p inspect-cti-realm-shared -f <installed inspect_evals>/cti_realm/docker/shared_services.yaml up -d --build kusto-emulator kusto-init |
| `cti_realm_25_seeded` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | RuntimeError: Command failed: docker compose -p inspect-cti-realm-shared -f <installed inspect_evals>/cti_realm/docker/shared_services.yaml up -d --build kusto-emulator kusto-init |
| `cti_realm_50` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | RuntimeError: Command failed: docker compose -p inspect-cti-realm-shared -f <installed inspect_evals>/cti_realm/docker/shared_services.yaml up -d --build kusto-emulator kusto-init |
| `cve_bench` | Cybersecurity | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To use CVEBench, please install the optional dependency by running `pip install https://github.com/Scott-Simmons/cve-bench.git` if you installed inspect_evals via pip or `uv sync --group cve_bench` if you are working inside the inspect_evals repo. |
| `cybench` | Cybersecurity | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'inspect_cyber' |
| `cybergym` | Cybersecurity | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'inspect_cyber' |
| `cybermetric_10000` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cybermetric_2000` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cybermetric_500` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cybermetric_80` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cyse2_interpreter_abuse` | Cybersecurity | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `cyse2_prompt_injection` | Cybersecurity | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `cyse2_vulnerability_exploit` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `cyse3_visual_prompt_injection` | Cybersecurity | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `cyse4_autocomplete` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cyse4_instruct` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cyse4_malware_analysis` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cyse4_mitre` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cyse4_mitre_frr` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `cyse4_multilingual_prompt_injection` | Cybersecurity | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `cyse4_multiturn_phishing` | Cybersecurity | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `cyse4_threat_intelligence` | Cybersecurity | blocked | `network_or_remote_service` | `needs_investigation` | tenacity.RetryError: RetryError[<Future at 0x116884980 state=finished raised ConnectError>] |
| `docvqa` | Multimodal | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `drop` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `ds1000` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `fortress_adversarial` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `fortress_benign` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `frontier_cs` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `frontier_cs_algorithmic` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `frontier_cs_research` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `frontierscience` | Knowledge | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise deepseek client |
| `gaia` | Assistants | blocked | `gated_access` | `conditional_after_setup` | huggingface_hub.errors.GatedRepoError: 403 Client Error. (Request ID omitted) |
| `gaia_level1` | Assistants | blocked | `gated_access` | `conditional_after_setup` | huggingface_hub.errors.GatedRepoError: 403 Client Error. (Request ID omitted) |
| `gaia_level2` | Assistants | blocked | `gated_access` | `conditional_after_setup` | huggingface_hub.errors.GatedRepoError: 403 Client Error. (Request ID omitted) |
| `gaia_level3` | Assistants | blocked | `gated_access` | `conditional_after_setup` | huggingface_hub.errors.GatedRepoError: 403 Client Error. (Request ID omitted) |
| `gdm_classifier_evasion` | Scheming | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: No authentication for the Google provider: set the GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable, or use OAuth / Application Default Credentials via `-M use_adc=true` or GOOGLE_USE_ADC=true. |
| `gdm_cover_your_tracks` | Scheming | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: No authentication for the Google provider: set the GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable, or use OAuth / Application Default Credentials via `-M use_adc=true` or GOOGLE_USE_ADC=true. |
| `gdm_in_house_ctf` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_intercode_ctf` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_oversight_pattern` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_approved_directories` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_calculator_improvement` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_context_length_mod_instrumental_only` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_context_length_mod_irreversibility_only` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_database_tool` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_latency_calculator` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_max_messages_calculator` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_max_tokens` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_oversight_frequency` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_read_logs` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_self_reasoning_turn_off_filters` | Scheming | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gdm_sp01_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp01_milestones` | Scheming | blocked | `missing_configuration` | `conditional_after_setup` | Exception: GDM_SELF_PROLIFERATION_DEV is not set. Set the GDM_SELF_PROLIFERATION_DEV environment variable to run this eval. |
| `gdm_sp02_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp02_milestones` | Scheming | blocked | `missing_configuration` | `conditional_after_setup` | Exception: GDM_SELF_PROLIFERATION_DEV is not set. Set the GDM_SELF_PROLIFERATION_DEV environment variable to run this eval. |
| `gdm_sp03_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp03_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp04_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp04_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp05_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp05_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp07_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp07_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp08_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp08_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp09_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp09_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp10_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp10_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp12_e2e` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_sp12_milestones` | Scheming | blocked | `upstream_asset_error` | `deprioritize_until_upstream_fix` | RuntimeError: Failed to download required files from GitHub: Failed to download src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip from GitHub. HTTP Error 404: Not Found. URL: https://raw.githubusercontent.com/UKGovernmentBEIS/inspect_evals/0.17.0/src/inspect_evals/gdm_self_proliferation/data/sp08/secrets.zip. Check your internet connection and GitHub repository access. |
| `gdm_strategic_rule_breaking` | Scheming | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: No authentication for the Google provider: set the GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable, or use OAuth / Application Default Credentials via `-M use_adc=true` or GOOGLE_USE_ADC=true. |
| `gdpval` | Assistants | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `gpqa_diamond` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `gsm8k` | Mathematics | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `healthbench` | Knowledge | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `healthbench_consensus` | Knowledge | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `healthbench_hard` | Knowledge | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `healthbench_meta_eval` | Knowledge | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `hellaswag` | Reasoning | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `hle` | Knowledge | blocked | `gated_access` | `conditional_after_setup` | datasets.exceptions.DatasetNotFoundError: Dataset 'cais/hle' is a gated dataset on the Hub. Visit the dataset page at https://huggingface.co/datasets/cais/hle to ask for access. |
| `humaneval` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `ifeval` | Reasoning | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To use instruction_following_eval, please install the optional dependency by running `pip install https://github.com/josejg/instruction_following_eval` if you installed inspect_evals via pip or `uv sync --group ifeval` if you are working inside the inspect_evals repo. |
| `ifevalcode` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `infinite_bench_code_debug` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_code_run` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_kv_retrieval` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_longbook_choice_eng` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_longdialogue_qa_eng` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_math_calc` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_math_find` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_number_string` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `infinite_bench_passkey` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `instrumentaleval` | Scheming | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `ipi_coding_agent` | Safeguards | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `kernelbench` | Coding | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'torch' |
| `lab_bench_cloning_scenarios` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lab_bench_dbqa` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lab_bench_figqa` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lab_bench_litqa` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lab_bench_protocolqa` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lab_bench_seqqa` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lab_bench_suppqa` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lab_bench_tableqa` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `lingoly` | Reasoning | blocked | `gated_access` | `conditional_after_setup` | datasets.exceptions.DatasetNotFoundError: Dataset 'ambean/lingOly' is a gated dataset on the Hub. Visit the dataset page at https://huggingface.co/datasets/ambean/lingOly to ask for access. |
| `lingoly_too` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `livebench` | Knowledge | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To use LiveBench, please install the optional dependency by running `pip install https://github.com/LiveBench/LiveBench.git` if you installed inspect_evals via pip or `uv sync --group livebench` if you are working inside the inspect_evals repo. |
| `livecodebench_pro` | Coding | blocked | `gated_access` | `conditional_after_setup` | datasets.exceptions.DatasetNotFoundError: Dataset 'QAQAQAQAQ/LiveCodeBench-Pro' is a gated dataset on the Hub. Visit the dataset page at https://huggingface.co/datasets/QAQAQAQAQ/LiveCodeBench-Pro to ask for access. |
| `macbench` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `make_me_pay` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: No authentication for the Google provider: set the GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable, or use OAuth / Application Default Credentials via `-M use_adc=true` or GOOGLE_USE_ADC=true. |
| `makemesay` | Safeguards | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'nltk' |
| `mask` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `math` | Mathematics | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'sympy' |
| `mathvista` | Mathematics | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `mbpp` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `medqa` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `mgsm` | Mathematics | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `mind2web` | Assistants | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `mind2web_sc` | Safeguards | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `mle_bench` | Coding | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To use MLE-bench, please install the optional dependency by running `pip install https://github.com/openai/mle-bench.git` if you installed inspect_evals via pip or `uv sync --group mle_bench` if you are working inside the inspect_evals repo. |
| `mle_bench_full` | Coding | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To use MLE-bench, please install the optional dependency by running `pip install https://github.com/openai/mle-bench.git` if you installed inspect_evals via pip or `uv sync --group mle_bench` if you are working inside the inspect_evals repo. |
| `mle_bench_lite` | Coding | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To use MLE-bench, please install the optional dependency by running `pip install https://github.com/openai/mle-bench.git` if you installed inspect_evals via pip or `uv sync --group mle_bench` if you are working inside the inspect_evals repo. |
| `mlrc_bench` | Coding | blocked | `credential_or_aux_model` | `conditional_after_setup` | RuntimeError: AICROWD_API_KEY environment variable is required for the product-rec task. Export it in your shell or add it to ./.env (AICROWD_API_KEY=...). |
| `mmiu` | Multimodal | blocked | `network_or_remote_service` | `needs_investigation` | tenacity.RetryError: RetryError[<Future at 0x118298980 state=finished raised ReadTimeout>] |
| `mmlu_0_shot` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `mmlu_5_shot` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `mmlu_pro` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `mmmu_multiple_choice` | Reasoning | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `mmmu_open` | Reasoning | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `moru` | Safeguards | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `musr` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `niah` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `novelty_bench` | Reasoning | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'torch' |
| `onet_m6` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `osworld` | Assistants | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `osworld_small` | Assistants | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `paperbench` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `paperbench_score` | Coding | blocked | `missing_asset` | `needs_investigation` | FileNotFoundError: No submission metadata files found in submissions. Run the agent task with save_submission first. |
| `paws` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `persistbench_beneficial_memory` | Safeguards | blocked | `model_incompatible` | `needs_investigation` | BadRequestError('Error code: 400 - {\'error\': {\'message\': \'Provider returned error\', \'code\': 400, \'metadata\': {\'raw\': \'[{\\n "error": {\\n "code": 400,\\n "message": "Requested maximum tokens of 131072 exceeds the maximum output tokens limit: 102400.",\\n "status": "INVALID_ARGUMENT"\\n }\\n}\\n]\', \'provider_name\': \'Google\', \'is_byok\': False}}, \'user_id\': \'user_30nuE5pKQkVC9exp2zzOb40narW\'}') |
| `persistbench_cross_domain` | Safeguards | blocked | `model_incompatible` | `needs_investigation` | BadRequestError('Error code: 400 - {\'error\': {\'message\': \'Provider returned error\', \'code\': 400, \'metadata\': {\'raw\': \'[{\\n "error": {\\n "code": 400,\\n "message": "Requested maximum tokens of 131072 exceeds the maximum output tokens limit: 102400.",\\n "status": "INVALID_ARGUMENT"\\n }\\n}\\n]\', \'provider_name\': \'Google\', \'is_byok\': False}}, \'user_id\': \'user_30nuE5pKQkVC9exp2zzOb40narW\'}') |
| `persistbench_sycophancy` | Safeguards | blocked | `model_incompatible` | `needs_investigation` | BadRequestError('Error code: 400 - {\'error\': {\'message\': \'Provider returned error\', \'code\': 400, \'metadata\': {\'raw\': \'[{\\n "error": {\\n "code": 400,\\n "message": "Requested maximum tokens of 131072 exceeds the maximum output tokens limit: 102400.",\\n "status": "INVALID_ARGUMENT"\\n }\\n}\\n]\', \'provider_name\': \'Google\', \'is_byok\': False}}, \'user_id\': \'user_30nuE5pKQkVC9exp2zzOb40narW\'}') |
| `personality_BFI` | Personality | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `personality_TRAIT` | Personality | blocked | `gated_access` | `conditional_after_setup` | datasets.exceptions.DatasetNotFoundError: Dataset 'mirlab/TRAIT' is a gated dataset on the Hub. Visit the dataset page at https://huggingface.co/datasets/mirlab/TRAIT to ask for access. |
| `piqa` | Reasoning | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `pre_flight` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `pubmedqa` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `race_h` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sad_facts_human_defaults` | Scheming | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sad_facts_llms` | Scheming | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sad_influence` | Scheming | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sad_stages_full` | Scheming | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sad_stages_oversight` | Scheming | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `scbench` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `scicode` | Coding | blocked | `runtime_error` | `needs_investigation` | inspect_ai._util.error.PrerequisiteError: [bold]ERROR[/bold]: Google Drive download requires optional dependencies. Install with: |
| `sciknoweval` | Knowledge | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sec_qa_v1` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sec_qa_v1_5_shot` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sec_qa_v2` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sec_qa_v2_5_shot` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sevenllm_mcq_en` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sevenllm_mcq_zh` | Cybersecurity | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `sevenllm_qa_en` | Cybersecurity | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'rouge' |
| `sevenllm_qa_zh` | Cybersecurity | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'rouge' |
| `simpleqa` | Knowledge | blocked | `model_incompatible` | `needs_investigation` | BadRequestError("Error code: 400 - {'error': {'message': 'Thinking mode does not support this tool_choice', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}") |
| `simpleqa_verified` | Knowledge | blocked | `model_incompatible` | `needs_investigation` | BadRequestError("Error code: 400 - {'error': {'message': 'Thinking mode does not support this tool_choice', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}") |
| `sosbench` | Knowledge | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `squad` | Reasoning | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `stereoset` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `strong_reject` | Safeguards | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `swe_bench` | Coding | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To run SWE-bench, please install the optional SWE-bench dependency, by running `uv sync --extra swe_bench` |
| `swe_bench_verified_mini` | Coding | blocked | `missing_dependency` | `conditional_after_setup` | AssertionError: To run SWE-bench, please install the optional SWE-bench dependency, by running `uv sync --extra swe_bench` |
| `swe_lancer` | Coding | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `sycophancy` | Assistants | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `tac` | Safeguards | blocked | `gated_access` | `conditional_after_setup` | huggingface_hub.errors.GatedRepoError: 403 Client Error. (Request ID omitted) |
| `tac_welfare` | Safeguards | blocked | `gated_access` | `conditional_after_setup` | huggingface_hub.errors.GatedRepoError: 403 Client Error. (Request ID omitted) |
| `tau2_airline` | Assistants | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `tau2_banking` | Assistants | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `tau2_retail` | Assistants | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `tau2_telecom` | Assistants | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `theagentcompany` | Assistants | blocked | `missing_dependency` | `conditional_after_setup` | ModuleNotFoundError: No module named 'inspect_cyber' |
| `threecb` | Cybersecurity | blocked | `sandbox_unavailable` | `conditional_after_setup` | Docker sandbox could not start because the local Docker daemon was unavailable. |
| `truthfulqa` | Knowledge | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `uccb` | Knowledge | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise OpenAI client |
| `usaco` | Coding | blocked | `runtime_error` | `needs_investigation` | inspect_ai._util.error.PrerequisiteError: [bold]ERROR[/bold]: Google Drive download requires optional dependencies. Install with: |
| `vimgolf_single_turn` | Reasoning | blocked | `missing_dependency` | `conditional_after_setup` | ImportError: vimgolf library is not installed. Please install the vimgolf library to use this task via `uv sync --extra vimgolf`. |
| `vqa_rad` | Multimodal | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `vstar_bench_attribute_recognition` | Multimodal | inconclusive | `timeout_or_too_heavy` | `manual_review` | Did not complete within the extended 10-minute smoke-test window. |
| `vstar_bench_spatial_relationship_reasoning` | Multimodal | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `winogrande` | Reasoning | passed | `passed` | `general_candidate` | Inspect completed and wrote a successful one-sample log. |
| `wmdp_bio` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `wmdp_chem` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `wmdp_cyber` | Safeguards | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `worldsense` | Reasoning | passed | `passed` | `specialized_candidate` | Inspect completed and wrote a successful one-sample log. |
| `writingbench` | Writing | blocked | `credential_or_aux_model` | `conditional_after_setup` | inspect_ai._util.error.PrerequisiteError: ERROR: Unable to initialise Anthropic client |
| `xstest` | Knowledge | blocked | `gated_access` | `conditional_after_setup` | datasets.exceptions.DatasetNotFoundError: Dataset 'walledai/XSTest' is a gated dataset on the Hub. Visit the dataset page at https://huggingface.co/datasets/walledai/XSTest to ask for access. |
| `zerobench` | Multimodal | blocked | `gated_access` | `conditional_after_setup` | datasets.exceptions.DatasetNotFoundError: Dataset 'jonathan-roberts1/zerobench' is a gated dataset on the Hub. Visit the dataset page at https://huggingface.co/datasets/jonathan-roberts1/zerobench to ask for access. |
| `zerobench_subquestions` | Multimodal | blocked | `gated_access` | `conditional_after_setup` | datasets.exceptions.DatasetNotFoundError: Dataset 'jonathan-roberts1/zerobench' is a gated dataset on the Hub. Visit the dataset page at https://huggingface.co/datasets/jonathan-roberts1/zerobench to ask for access. |
