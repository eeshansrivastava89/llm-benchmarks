"""Bench helper: list registered Inspect tasks as JSON on stdout.

Invoked by src/inspect-discovery.mjs as `uv run python scripts/inspect_registry_discovery.py`.
"""
import json
from importlib.metadata import PackageNotFoundError, version
from inspect_ai._util.registry import registry_find, registry_info
from inspect_evals.metadata import load_listing

listing = load_listing()
try:
    inspect_evals_version = version("inspect-evals")
except PackageNotFoundError:
    inspect_evals_version = None

tasks = []
for component in registry_find(lambda info: info.type == "task"):
    info = registry_info(component)
    title = None
    description = None
    group = None
    eval_id = None
    sample_count = None
    package_version = None
    if info.name.startswith("inspect_evals/"):
        package_version = inspect_evals_version
        task_name = info.name.split("/", 1)[1]
        eval_metadata, task_metadata = listing.find_task(task_name)
        if eval_metadata is None:
            module_parts = component.__module__.split(".")
            if len(module_parts) > 1 and module_parts[0] == "inspect_evals":
                eval_metadata = listing.get_eval(module_parts[1])
        if eval_metadata is not None:
            eval_id = eval_metadata.id
            title = eval_metadata.title
            description = (task_metadata.comment if task_metadata else None) or eval_metadata.description
            group = str(eval_metadata.group)
            sample_count = task_metadata.dataset_samples if task_metadata else None
    tasks.append({
        "name": info.name,
        "attribs": info.metadata.get("attribs", {}),
        "params": info.metadata.get("params", []),
        "title": title,
        "description": description,
        "group": group,
        "evalId": eval_id,
        "sampleCount": sample_count,
        "packageVersion": package_version,
    })
print(json.dumps(tasks))