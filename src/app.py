"""Fictional accounts. API Gateway validates JWTs; this code checks account access.

This handler trusts only the authorizer context supplied by its configured API
Gateway integration. Do not expose it through an unauthenticated Function URL.
"""

import json
import os

REQUIRED_SCOPE = "bank-api/accounts.read"


def response(status_code, payload):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload),
    }


def demo_accounts():
    # The subjects come from your real demo users, never from a request parameter.
    # Empty/unconfigured subjects match no signed-in user.
    return {
        "5521": {"allowedSubjects": [os.environ.get("ALICE_SUB", "")],
                 "label": "Alice's demo account", "balanceMinor": 125000, "currency": "USD"},
        "8842": {"allowedSubjects": [os.environ.get("BOB_SUB", "")],
                 "label": "Bob's demo account", "balanceMinor": 87050, "currency": "USD"},
    }


def handler(event, context):
    route = event.get("routeKey")
    if route == "GET /branches":
        return response(200, {"branches": [{"name": "Demo Central", "address": "1 Example Street"}]})

    if route not in {"GET /accounts", "GET /accounts/{accountId}/balance"}:
        return response(404, {"message": "Not found"})

    # Read the identity already validated by API Gateway. Merely decoding a JWT
    # from the Authorization header would not verify its authenticity.
    jwt = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {})
    subject = jwt.get("claims", {}).get("sub")
    if not isinstance(subject, str) or not subject:
        return response(401, {"message": "Unauthorized"})
    # Gateway normally rejects a missing scope before Lambda. This additional
    # guard also fails closed for malformed direct/test invocations.
    if REQUIRED_SCOPE not in (jwt.get("scopes") or []):
        return response(403, {"message": "Forbidden"})

    accounts = demo_accounts()
    if route == "GET /accounts":
        visible = [
            {"accountId": account_id, "label": account["label"]}
            for account_id, account in accounts.items()
            if subject in account["allowedSubjects"]
        ]
        return response(200, {"accounts": visible})

    account_id = (event.get("pathParameters") or {}).get("accountId")
    account = accounts.get(account_id)
    if account is None or subject not in account["allowedSubjects"]:
        # Same status and body for missing and inaccessible accounts. This avoids
        # confirming that another customer's account exists.
        return response(404, {"message": "Account not found"})

    return response(200, {
        "accountId": account_id,
        "balanceMinor": account["balanceMinor"],
        "currency": account["currency"],
    })
