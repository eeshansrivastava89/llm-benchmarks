import { readFile } from "node:fs/promises";
import { join } from "node:path";

const THINKING_FIELDS = ["reasoning_effort", "thinking", "enable_thinking", "thinking_budget", "thinking_budget_tokens", "thinking_token_budget"];

// This adapter removes Pi's implicit generation controls, not user settings.
// It never changes tools, messages, authentication, or cloud requests.
export function serverManagedPayload(payload, model, policy, thinkingSelected = false) {
  const result = { ...payload };
  const explicit = model.samplingParams ?? {};
  const tokenFields = ["max_tokens", "max_completion_tokens"];
  if (policy.output === "server" || tokenFields.some((key) => Object.hasOwn(explicit, key))) {
    for (const key of tokenFields) {
      if (!Object.hasOwn(explicit, key)) delete result[key];
    }
  }
  if (policy.thinking === "server" && !thinkingSelected) {
    for (const key of THINKING_FIELDS) {
      if (!Object.hasOwn(explicit, key)) delete result[key];
    }
    for (const wrapper of ["chat_template_kwargs", "chat_template_args"]) {
      if (result[wrapper] && !Object.hasOwn(explicit, wrapper)) {
        const values = { ...result[wrapper] };
        for (const key of THINKING_FIELDS) delete values[key];
        if (Object.keys(values).length) result[wrapper] = values;
        else delete result[wrapper];
      }
    }
  }
  return result;
}

export default async function localModels(pi) {
  const { provider, model, policy } = JSON.parse(await readFile(
    join(process.env.PI_CODING_AGENT_DIR, "bench-local-model.json"), "utf8",
  ));
  // Dynamic registration preserves absent metadata; models.json alone fills it in.
  pi.registerProvider(provider, { models: [model] });
  let started = false;
  let thinkingSelected = false;
  pi.on("session_start", (_event, ctx) => {
    started = true;
    ctx.ui.setStatus("bench-local", `Local settings: output ${policy.output}; thinking ${policy.thinking}`);
  });
  pi.on("thinking_level_select", (_event, ctx) => {
    if (started && ctx.model?.provider === provider && ctx.model.id === model.id) {
      thinkingSelected = true;
      ctx.ui.setStatus("bench-local", `Local settings: output ${policy.output}; thinking Pi`);
    }
  });
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.provider !== provider || ctx.model.id !== model.id
      || ctx.model.baseUrl !== model.baseUrl || event.payload?.model !== model.id) return;
    return serverManagedPayload(event.payload, ctx.model, policy, thinkingSelected);
  });
}
