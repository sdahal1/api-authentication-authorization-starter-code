import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("app", Path(__file__).parents[1] / "src" / "app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


def event(subject="alice-sub", route="GET /accounts/{accountId}/balance", account_id="5521"):
    return {
        "version": "2.0",
        "routeKey": route,
        "pathParameters": {"accountId": account_id},
        "requestContext": {"authorizer": {"jwt": {
            "claims": {"sub": subject}, "scopes": ["bank-api/accounts.read"],
        }}},
    }


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"ALICE_SUB": "alice-sub", "BOB_SUB": "bob-sub"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_public_branch_route_needs_no_authorizer_context(self):
        self.assertEqual(app.handler({"routeKey": "GET /branches"}, None)["statusCode"], 200)

    def test_alice_reads_her_balance(self):
        result = app.handler(event(), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["balanceMinor"], 125000)
        self.assertEqual(result["headers"]["Cache-Control"], "no-store")

    def test_bob_reads_his_balance(self):
        result = app.handler(event("bob-sub", account_id="8842"), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["balanceMinor"], 87050)

    def test_cross_user_and_unknown_account_have_same_response(self):
        denied = app.handler(event(account_id="8842"), None)
        missing = app.handler(event(account_id="does-not-exist"), None)
        self.assertEqual(denied["statusCode"], 404)
        self.assertEqual(denied, missing)
        self.assertEqual(app.handler(event("bob-sub"), None)["statusCode"], 404)

    def test_account_list_is_filtered_by_validated_subject(self):
        for subject, expected in [("alice-sub", "5521"), ("bob-sub", "8842")]:
            result = app.handler(event(subject, route="GET /accounts"), None)
            accounts = json.loads(result["body"])["accounts"]
            self.assertEqual([account["accountId"] for account in accounts], [expected])

    def test_spoofed_user_ids_do_not_change_authorization(self):
        request = event(account_id="8842")
        request["queryStringParameters"] = {"userId": "bob-sub", "sub": "bob-sub"}
        request["body"] = json.dumps({"userId": "bob-sub", "sub": "bob-sub"})
        request["headers"] = {"x-user-id": "bob-sub"}
        self.assertEqual(app.handler(request, None)["statusCode"], 404)

    def test_raw_token_or_user_id_without_authorizer_is_rejected(self):
        request = event()
        request["requestContext"] = {}
        request["headers"] = {"Authorization": "Bearer unverified-token", "x-user-id": "alice-sub"}
        self.assertEqual(app.handler(request, None)["statusCode"], 401)

    def test_validated_subject_without_scope_is_rejected(self):
        request = event()
        request["requestContext"]["authorizer"]["jwt"]["scopes"] = ["openid"]
        self.assertEqual(app.handler(request, None)["statusCode"], 403)

    def test_unmapped_or_unconfigured_users_have_no_accounts(self):
        for subject in ["unknown-sub", ""]:
            result = app.handler(event(subject, route="GET /accounts"), None)
            self.assertEqual(result["statusCode"], 401 if not subject else 200)
            if subject:
                self.assertEqual(json.loads(result["body"]), {"accounts": []})
        with patch.dict(os.environ, {"ALICE_SUB": "", "BOB_SUB": ""}):
            self.assertEqual(app.handler(event(), None)["statusCode"], 404)


if __name__ == "__main__":
    unittest.main()
