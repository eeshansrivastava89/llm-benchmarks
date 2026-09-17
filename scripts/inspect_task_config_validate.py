"""Bench helper: validate a saved task-config YAML against the installed task signature.

Invoked by src/task-config.mjs as `uv run python scripts/inspect_task_config_validate.py <task-name> <path>`.
Exits non-zero with the problem on stderr when the config is invalid.
"""
import inspect
import sys
import yaml
from inspect_ai._util.registry import registry_find, registry_info

try:
    task_name, path = sys.argv[1], sys.argv[2]
    component = next(
        component
        for component in registry_find(lambda info: info.type == "task")
        if registry_info(component).name == task_name
    )
    with open(path, encoding="utf-8") as stream:
        config = yaml.safe_load(stream)
    if not isinstance(config, dict):
        raise ValueError("task config must contain a YAML mapping")
    signature = inspect.signature(component)
    accepts_extra = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in signature.parameters.values())
    unknown = sorted(set(config) - set(signature.parameters))
    if unknown and not accepts_extra:
        raise ValueError("unknown task parameter" + ("s" if len(unknown) != 1 else "") + ": " + ", ".join(unknown))
except Exception as error:
    print(str(error), file=sys.stderr)
    raise SystemExit(1)