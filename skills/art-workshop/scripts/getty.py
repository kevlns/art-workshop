#!/usr/bin/env python3
"""Getty AAT JSON adapter; Python 3.9+, standard library only."""

import argparse
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://services.getty.edu/vocab/reconcile/"
SCHEMA = "art-workshop/getty-v1"
CORE_FIELDS = {"preferredTerms": "/aat_prefterm", "variantTerms": "/aat_varterms",
          "scopeNotes": "/aat_notes"}
HIERARCHY_FIELD = "/aat_hier"
MAX_BYTES = 5 * 1024 * 1024
MAX_ERROR_BYTES = 4096


class GettyError(Exception):
    def __init__(self, code, message, *, http_status=None, details=None):
        super().__init__(message)
        self.code = code
        self.http_status, self.details = http_status, details

    def to_dict(self):
        return {"code": self.code, "message": str(self),
                **({"httpStatus": self.http_status} if self.http_status is not None else {}),
                **({"details": self.details} if self.details else {})}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def read_json(text):
    return json.loads(text, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))


def validate(value):
    if not isinstance(value, dict) or set(value) - {"queries", "limit"}:
        raise GettyError("INVALID_INPUT", "Expected {queries:[{id?,query,context,properties?}],limit?}")
    limit = value.get("limit", 5)
    if type(limit) is not int or not 1 <= limit <= 10:
        raise GettyError("INVALID_INPUT", "limit must be an integer from 1 to 10")
    queries = value.get("queries")
    if not isinstance(queries, list) or not 1 <= len(queries) <= 10:
        raise GettyError("INVALID_INPUT", "queries must contain 1 to 10 items; split larger batches")
    result, ids = [], set()
    for index, item in enumerate(queries):
        if not isinstance(item, dict) or set(item) - {"id", "query", "context", "properties"}:
            raise GettyError("INVALID_INPUT", "Unknown query fields")
        identifier, query = item.get("id", "q" + str(index)), item.get("query")
        if not isinstance(identifier, str) or not identifier or identifier in ids:
            raise GettyError("INVALID_INPUT", "Query IDs must be nonempty and unique")
        if not isinstance(query, str) or not query.strip():
            raise GettyError("INVALID_INPUT", "query must be a nonempty string")
        context = item.get("context")
        if (not isinstance(context, dict) or not isinstance(context.get("original"), str)
                or not context["original"] or ("target" in context and not isinstance(context["target"], str))):
            raise GettyError("INVALID_INPUT", "context requires original text and an optional target string")
        properties = item.get("properties", {})
        if (not isinstance(properties, dict) or set(properties) - {"note", "broaderExt", "label"}
                or any(not isinstance(v, str) or not v.strip() for v in properties.values())):
            raise GettyError("INVALID_INPUT", "properties accepts nonempty note, broaderExt and label strings")
        ids.add(identifier)
        result.append({**item, "id": identifier, "properties": properties})
    return {"queries": result, "limit": limit}


def transport(params, timeout):
    request = urllib.request.Request(ENDPOINT, data=urllib.parse.urlencode(params).encode("utf-8"), headers={
        "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "Vant-Art-Workshop-Getty/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise GettyError("RESPONSE_TOO_LARGE", "Getty response exceeds 5 MiB")
        return read_json(data.decode("utf-8-sig"))
    except urllib.error.HTTPError as error:
        try:
            details = error.read(MAX_ERROR_BYTES).decode("utf-8", errors="replace")
        except OSError:
            details = None
        finally:
            error.close()
        raise GettyError("HTTP_ERROR", "Getty returned HTTP " + str(error.code),
                         http_status=error.code, details=details) from error
    except (TimeoutError, socket.timeout) as error:
        raise GettyError("TIMEOUT", "Getty request timed out") from error
    except urllib.error.URLError as error:
        if isinstance(error.reason, (TimeoutError, socket.timeout)):
            raise GettyError("TIMEOUT", "Getty request timed out") from error
        raise GettyError("NETWORK_ERROR", "Getty connection failed: " + str(error.reason)) from error
    except (OSError, http.client.HTTPException) as error:
        raise GettyError("NETWORK_ERROR", "Getty connection failed: " + str(error)) from error
    except (ValueError, UnicodeError) as error:
        raise GettyError("INVALID_RESPONSE", "Getty did not return valid UTF-8 JSON") from error


class Client:
    def __init__(self, cache_dir, timeout=15, ttl=86400, refresh=False, fetch=transport):
        self.cache_dir, self.timeout, self.ttl = Path(cache_dir), timeout, ttl
        self.refresh, self.fetch, self.warnings = refresh, fetch, []

    def request(self, params, check):
        # 完整请求精确命中，不裁剪、翻译或归一化检索文字。
        key = hashlib.sha256(encoded({"schema": SCHEMA, "endpoint": ENDPOINT,
                                     "method": "POST", "params": params}).encode("utf-8")).hexdigest()
        path = self.cache_dir / (key + ".json")
        if not self.refresh and self.ttl > 0:
            try:
                cached = read_json(path.read_text(encoding="utf-8"))
                age = time.time() - cached["fetchedAt"]
                if cached["key"] == key and 0 <= age < self.ttl:
                    check(cached["data"])
                    return cached["data"], "hit"
            except (OSError, ValueError, KeyError, TypeError, GettyError):
                pass
        data = self.fetch(params, self.timeout)
        check(data)
        if self.ttl > 0:
            temporary = None
            try:
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.cache_dir,
                                                 suffix=".tmp", delete=False) as output:
                    temporary = output.name
                    output.write(encoded({"key": key, "fetchedAt": time.time(), "data": data}))
                os.replace(temporary, path)
            except OSError:
                self.warnings.append("Cache write failed; live result retained")
            finally:
                if temporary:
                    try:
                        Path(temporary).unlink(missing_ok=True)
                    except OSError:
                        pass
        return data, "miss"


def check_candidates(data, keys):
    if not isinstance(data, dict):
        raise GettyError("INVALID_RESPONSE", "Expected Getty reconciliation object")
    for key in keys:
        group = data.get(key)
        if not isinstance(group, dict) or not isinstance(group.get("result"), list):
            raise GettyError("INVALID_RESPONSE", "Missing reconciliation results for " + key)
        for candidate in group["result"]:
            if (not isinstance(candidate, dict)
                    or not isinstance(candidate.get("id"), str)
                    or not re.fullmatch(r"aat/[0-9]+", candidate["id"])
                    or not isinstance(candidate.get("name"), str)
                    or type(candidate.get("score")) not in (int, float)
                    or not math.isfinite(candidate["score"])
                    or type(candidate.get("match")) is not bool):
                raise GettyError("INVALID_RESPONSE", "Malformed AAT candidate")


def check_details(data, ids, fields):
    if not isinstance(data, dict) or not isinstance(data.get("rows"), dict):
        raise GettyError("INVALID_RESPONSE", "Missing Getty detail rows")
    for identifier in ids:
        row = data["rows"].get(identifier)
        if not isinstance(row, dict):
            raise GettyError("INVALID_RESPONSE", "Missing detail row for " + identifier)
        for field in fields:
            if (field not in row or not isinstance(row[field], list)
                    or any(not isinstance(v, dict) or not isinstance(v.get("str"), str) for v in row[field])):
                raise GettyError("INVALID_RESPONSE", "Malformed Getty detail field " + field)


def execute(value, client):
    request = validate(value)
    wire = {"q" + str(i): {"query": item["query"], "type": "/aat", "limit": request["limit"],
            "properties": [{"pid": k, "v": v} for k, v in sorted(item["properties"].items())]}
            for i, item in enumerate(request["queries"])}
    data, search_cache = client.request({"queries": encoded(wire)}, lambda d: check_candidates(d, wire))
    ids = sorted({c["id"] for key in wire for c in data[key]["result"]})
    details, detail_cache, detail_error = {}, None, None
    hierarchy, hierarchy_cache = {}, None
    enrichment = {"status": "not_requested"}
    if ids:
        try:
            extended, detail_cache = client.request({"extend": encoded({"ids": ids,
                "properties": [{"id": field} for field in CORE_FIELDS.values()]})},
                lambda d: check_details(d, ids, CORE_FIELDS.values()))
            details = extended["rows"]
        except GettyError as error:
            detail_error = error.to_dict()
        if detail_error is None:
            try:
                extended, hierarchy_cache = client.request({"extend": encoded({"ids": ids,
                    "properties": [{"id": HIERARCHY_FIELD}]})},
                    lambda d: check_details(d, ids, [HIERARCHY_FIELD]))
                hierarchy = extended["rows"]
                enrichment = {"status": "succeeded"}
            except GettyError as error:
                enrichment = {"status": "failed", "error": error.to_dict()}
    groups = []
    for index, item in enumerate(request["queries"]):
        candidates = []
        for candidate in sorted(data["q" + str(index)]["result"], key=lambda c: -c["score"]):
            identifier = candidate["id"]
            row = details.get(identifier, {})
            candidates.append({"id": identifier, "uri": "http://vocab.getty.edu/" + identifier,
                "label": candidate["name"], "serviceScore": candidate["score"],
                "serviceMatch": candidate["match"], "detailsAvailable": identifier in details,
                "hierarchyAvailable": identifier in hierarchy,
                "hierarchy": [v["str"] for v in hierarchy.get(identifier, {}).get(HIERARCHY_FIELD, [])],
                **{name: [v["str"] for v in row.get(field, [])] for name, field in CORE_FIELDS.items()}})
        groups.append({**item, "status": "candidates" if candidates else "no_match", "candidates": candidates})
    status = "partial" if detail_error else "candidates" if ids else "no_match"
    return {"schema": SCHEMA, "ok": not detail_error, "status": status, "request": request,
        "source": {"endpoint": ENDPOINT, "vocabulary": "aat", "license": "ODC-By-1.0",
            "attribution": "J. Paul Getty Trust, Getty Research Institute, Art & Architecture Thesaurus"},
        "cache": {"search": search_cache, "details": detail_cache, "hierarchy": hierarchy_cache}, "queries": groups,
        "enrichment": {"hierarchy": enrichment},
        "warnings": client.warnings + (["Candidates retained; core concept details could not be verified"] if detail_error else [])
                    + (["Core concept details verified; hierarchy unavailable"] if enrichment["status"] == "failed" else []),
        "error": detail_error}


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise GettyError("INVALID_INPUT", message)


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = Parser(description=__doc__)
    parser.add_argument("--input", default="-", help="UTF-8 JSON file, or - for stdin")
    parser.add_argument("--cache-dir", default=str(Path(os.environ.get("VANT_HOME", str(Path.home() / ".vant")))
                                                     / "tools/art-workshop/cache/getty"))
    parser.add_argument("--timeout", type=float, default=15, help="Seconds per request; no automatic retries")
    parser.add_argument("--cache-ttl", type=float, default=86400, help="Seconds; 0 disables cache")
    parser.add_argument("--refresh", action="store_true", help="Bypass existing cache")
    result = None
    try:
        args = parser.parse_args()
        if not math.isfinite(args.timeout) or not 0 < args.timeout <= 60:
            raise GettyError("INVALID_INPUT", "timeout must be greater than 0 and at most 60 seconds")
        if not math.isfinite(args.cache_ttl) or args.cache_ttl < 0:
            raise GettyError("INVALID_INPUT", "cache-ttl must be finite and nonnegative")
        text = sys.stdin.read() if args.input == "-" else Path(args.input).read_text(encoding="utf-8-sig")
        value = read_json(text)
        result = execute(value, Client(args.cache_dir, args.timeout, args.cache_ttl, args.refresh))
    except (GettyError, OSError, ValueError) as error:
        result = {"schema": SCHEMA, "ok": False, "status": "error", "queries": [],
                  "error": error.to_dict() if isinstance(error, GettyError)
                           else {"code": "INVALID_INPUT", "message": str(error)}}
    sys.stdout.write(encoded(result) + "\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
