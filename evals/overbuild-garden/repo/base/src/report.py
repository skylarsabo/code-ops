import json


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def summarize(report):
    return {"rows": len(report.get("rows", []))}
