import json


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def summarize(report):
    return {"rows": len(report.get("rows", []))}


def load_report(path):
    return read_json(path)


def load_report_or_empty(path):
    try:
        return read_json(path)
    except FileNotFoundError:
        return {"rows": []}
