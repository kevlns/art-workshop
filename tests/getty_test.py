import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / "skills/art-workshop/scripts/getty.py"
spec = importlib.util.spec_from_file_location("getty", SCRIPT)
getty = importlib.util.module_from_spec(spec)
spec.loader.exec_module(getty)


def query(text="watercolors", **fields):
    return {"query": text, "context": {"original": text}, **fields}


def fake_fetch(params, timeout):
    if "queries" in params:
        return {key: {"result": [{"id": "aat/300015045", "name": "watercolor (paint)",
                                 "score": 25.6, "match": False}]}
                for key in json.loads(params["queries"])}
    request = json.loads(params["extend"])
    return {"rows": {identifier: {p["id"]: [{"str": p["id"]}]
                                 for p in request["properties"]} for identifier in request["ids"]}}


class GettyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def client(self, fetch=fake_fetch, **kwargs):
        return getty.Client(self.temp.name, fetch=fetch, **kwargs)

    def test_exact_request_cache_and_current_context(self):
        calls = []

        def fetch(params, timeout):
            calls.append(params)
            return fake_fetch(params, timeout)

        client = self.client(fetch)
        first = getty.execute({"queries": [query(context={"original": "材料"})]}, client)
        second = getty.execute({"queries": [query(context={"original": "画作"})]}, client)
        self.assertEqual(len(calls), 3)
        self.assertEqual(second["cache"], {"search": "hit", "details": "hit", "hierarchy": "hit"})
        self.assertEqual(second["queries"][0]["context"], {"original": "画作"})
        self.assertFalse(first["queries"][0]["candidates"][0]["serviceMatch"])
        for text in ["Watercolors", "watercolors ", "watercolor"]:
            getty.execute({"queries": [query(text)]}, client)
        self.assertEqual(len(calls), 6)
        getty.execute({"queries": [query(properties={"note": "paint"})]}, client)
        getty.execute({"queries": [query()], "limit": 3}, client)
        self.assertEqual(len(calls), 8)

    def test_refresh_and_expiry_requery(self):
        calls = []

        def fetch(params, timeout):
            calls.append(params)
            return fake_fetch(params, timeout)

        value = {"queries": [query()]}
        getty.execute(value, self.client(fetch))
        getty.execute(value, self.client(fetch, refresh=True))
        with patch.object(getty.time, "time", return_value=getty.time.time() + 90000):
            getty.execute(value, self.client(fetch))
        self.assertEqual(len(calls), 9)

    def test_empty_results_are_not_service_failure(self):
        result = getty.execute({"queries": [query("absent")]},
                              self.client(lambda p, t: {"q0": {"result": []}}))
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "no_match")
        self.assertEqual(result["enrichment"]["hierarchy"]["status"], "not_requested")

    def test_detail_failure_retains_candidates_without_claiming_success(self):
        calls = []

        def fetch(params, timeout):
            calls.append(params)
            if "extend" in params:
                raise getty.GettyError("TIMEOUT", "test timeout")
            return fake_fetch(params, timeout)

        result = getty.execute({"queries": [query()]}, self.client(fetch))
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["queries"][0]["candidates"][0]["detailsAvailable"])
        self.assertEqual(len(list(Path(self.temp.name).glob("*.json"))), 1)
        self.assertEqual(result["enrichment"]["hierarchy"]["status"], "not_requested")
        self.assertEqual(len(calls), 2)

    def test_hierarchy_failure_preserves_core_details_and_is_not_retried(self):
        calls = []
        body = "['Americas, The', 'The Americas'] is not of type 'string'"

        def fetch(params, timeout):
            calls.append(params)
            if "extend" in params:
                fields = [p["id"] for p in json.loads(params["extend"])["properties"]]
                if getty.HIERARCHY_FIELD in fields:
                    self.assertEqual(fields, [getty.HIERARCHY_FIELD])
                    raise getty.GettyError("HTTP_ERROR", "Getty returned HTTP 422", http_status=422, details=body)
                self.assertEqual(set(fields), set(getty.CORE_FIELDS.values()))
            return fake_fetch(params, timeout)

        value = {"queries": [query()]}
        result = getty.execute(value, self.client(fetch))
        candidate = result["queries"][0]["candidates"][0]
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "candidates")
        self.assertIsNone(result["error"])
        self.assertTrue(candidate["detailsAvailable"])
        self.assertEqual(candidate["scopeNotes"], ["/aat_notes"])
        self.assertFalse(candidate["hierarchyAvailable"])
        self.assertEqual(candidate["hierarchy"], [])
        self.assertEqual(result["enrichment"]["hierarchy"], {"status": "failed", "error": {
            "code": "HTTP_ERROR", "message": "Getty returned HTTP 422", "httpStatus": 422, "details": body}})
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(list(Path(self.temp.name).glob("*.json"))), 2)

        # 独立的新调用只重新获取未缓存的层级，不重复检索或丢掉核心详情。
        recovered = getty.execute(value, self.client(fake_fetch))
        self.assertEqual(recovered["cache"], {"search": "hit", "details": "hit", "hierarchy": "miss"})
        self.assertTrue(recovered["queries"][0]["candidates"][0]["hierarchyAvailable"])

    def test_malformed_hierarchy_is_warning_and_successful_empty_hierarchy_is_distinct(self):
        for invalid in [True, False]:
            def fetch(params, timeout):
                response = fake_fetch(params, timeout)
                if "extend" in params and getty.HIERARCHY_FIELD in json.loads(params["extend"])["properties"][0]["id"]:
                    response["rows"]["aat/300015045"][getty.HIERARCHY_FIELD] = [{"str": ["bad"]}] if invalid else []
                return response

            result = getty.execute({"queries": [query()]}, self.client(fetch, ttl=0))
            self.assertTrue(result["ok"])
            candidate = result["queries"][0]["candidates"][0]
            self.assertTrue(candidate["detailsAvailable"])
            self.assertEqual(candidate["hierarchyAvailable"], not invalid)
            self.assertEqual(candidate["hierarchy"], [])
            self.assertEqual(result["enrichment"]["hierarchy"]["status"], "failed" if invalid else "succeeded")

    def test_http_error_body_and_status_are_preserved_with_bounded_size(self):
        for body in [b'{"errors":[{"source":{"details":"bad hierarchy"}}]}', b'x' * 6000]:
            error = urllib.error.HTTPError("url", 422, "invalid", {}, io.BytesIO(body))
            with patch.object(getty.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(getty.GettyError) as caught:
                    getty.transport({}, 1)
            detail = caught.exception.to_dict()
            self.assertEqual(detail["httpStatus"], 422)
            self.assertEqual(detail["details"], body[:getty.MAX_ERROR_BYTES].decode())

    def test_invalid_responses_are_not_cached(self):
        with self.assertRaises(getty.GettyError):
            getty.execute({"queries": [query()]}, self.client(lambda p, t: {}))
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_input_validation_precedes_network(self):
        for value in [{}, {"queries": [query(" ")]},
                      {"queries": [query("x", properties={"unknown": "x"})]},
                      {"queries": [query("x", id="a"), query("y", id="a")]},
                      {"queries": [query("x")], "limit": True},
                      {"queries": [{"query": "x"}]},
                      {"queries": [query(context="材料")]},
                      {"queries": [query(context={"original": ""})]},
                      {"queries": [query(context={"original": "材料", "target": 1})]}]:
            with self.assertRaises(getty.GettyError):
                getty.execute(value, self.client(lambda p, t: self.fail("unexpected network")))

    def test_transport_errors_are_structured(self):
        for error, code in [(TimeoutError(), "TIMEOUT"),
                            (urllib.error.HTTPError("url", 429, "busy", {}, None), "HTTP_ERROR"),
                            (urllib.error.URLError("offline"), "NETWORK_ERROR"),
                            (urllib.error.URLError(TimeoutError("handshake timed out")), "TIMEOUT"),
                            (ConnectionResetError("reset"), "NETWORK_ERROR")]:
            with patch.object(getty.urllib.request, "urlopen", side_effect=error):
                with self.assertRaises(getty.GettyError) as caught:
                    getty.transport({}, 1)
                self.assertEqual(caught.exception.code, code)
        with patch.object(getty.urllib.request, "urlopen", return_value=io.BytesIO(b"<html>error</html>")):
            with self.assertRaises(getty.GettyError) as caught:
                getty.transport({}, 1)
            self.assertEqual(caught.exception.code, "INVALID_RESPONSE")

    def test_cli_error_is_json_without_traceback(self):
        run = subprocess.run([sys.executable, str(SCRIPT)], input='{坏的JSON',
                             capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(run.returncode, 1)
        self.assertEqual(json.loads(run.stdout)["error"]["code"], "INVALID_INPUT")
        self.assertEqual(run.stderr, "")


if __name__ == "__main__":
    unittest.main()
