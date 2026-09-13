import os

from inspect_ai.hooks import BeforeModelGenerate, Hooks, hooks

KIMI_FIXED_SAMPLING_ENV = "BENCH_KIMI_FIXED_SAMPLING"
KIMI_MODEL_PREFIX = "openai-api/kimi/"
KIMI_FIXED_SAMPLING_PARAMS = (
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
)


def remove_kimi_fixed_sampling(model_name: str, config: object) -> None:
    """Let Kimi apply sampling values that its API fixes server-side."""
    if model_name.startswith(KIMI_MODEL_PREFIX):
        for parameter in KIMI_FIXED_SAMPLING_PARAMS:
            setattr(config, parameter, None)


if os.environ.get(KIMI_FIXED_SAMPLING_ENV) == "1":

    @hooks(
        name="kimi_fixed_sampling",
        description="Removes sampling parameters that the Kimi API does not allow clients to change.",
    )
    class KimiFixedSampling(Hooks):
        async def on_before_model_generate(self, data: BeforeModelGenerate) -> None:
            remove_kimi_fixed_sampling(data.model_name, data.config)
