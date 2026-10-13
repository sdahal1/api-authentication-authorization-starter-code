# Build an API Gateway HTTP API with Cognito sign-in and account authorization

This starter follows Alice's request through a fictional banking app. It demonstrates two checks: API Gateway validates the access token and its route scope, then Lambda checks whether the authenticated user can access the requested account.

**Learning lab only:** use made-up accounts and balances. This is not a production banking system. It intentionally uses a tiny Python fixture instead of a database so you can focus on authorization.

## What will you build?

```text
Browser ── sign in / authorization code + PKCE ── Amazon Cognito
   │                                                │
   └──────── receives a short-lived access token ────┘
   │
   ├─ GET /branches ─────────── API Gateway ───────── Lambda → public branch list
   │
   └─ Authorization: Bearer … ─ API Gateway JWT authorizer
                                  │ token + accounts.read scope accepted
                                  ▼
                               Lambda
                                  │ validated sub is allowed for this account?
                                  ├─ yes → fictional balance
                                  └─ no  → 404 Account not found
```

| Route | API Gateway requirement | Lambda responsibility |
|---|---|---|
| `GET /branches` | Public; no authorizer | Return fictional public branches |
| `GET /accounts` | JWT + `bank-api/accounts.read` | Return only accounts accessible to the validated `sub` |
| `GET /accounts/{accountId}/balance` | JWT + `bank-api/accounts.read` | Check requested account membership before returning its balance |

The scope grants permission to request the category of operation. It does **not** mean every account belongs to the caller. Alice and Bob both receive the same scope; Lambda still keeps their data separate.

The demo maps Alice to account **5521** and Bob to account **8842**. Balances use integer minor currency units: `125000` USD cents means `$1,250.00`. The backend never uses a URL/body/query user ID to decide who is signed in.

## Prerequisites and AWS access

- Python 3.12, a modern browser, the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), and the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).
- An AWS account and local AWS credentials with permission to create the CloudFormation, Cognito, API Gateway, Lambda, IAM, CloudWatch Logs, and SAM packaging resources in this template. No AWS credentials belong in the browser.
- Two email addresses you control for the fictional Alice and Bob users. Aliases can work if your email provider supports them. Verify both through Cognito's sign-up email flow.

If you are starting through the **new AWS sign-in experience**, verify that your account, selected Region, and current experience support the services and deployment permissions this lab needs before deploying. The builder's AWS sign-in and Alice's Cognito app sign-in are different identities. The coding-assistant prompt in [PROMPT.md](PROMPT.md) asks your assistant to check this with Agent Toolkit for AWS.

**Use your project's assigned Region.** The new AWS experience assigns a Region to your project. Replace `us-east-1` everywhere below—including commands, example API URLs, and deployment settings—with that assigned Region. Do not change Regions just to follow the example. Pass `--region` explicitly to `scripts/configure.py`; its fallback is `us-east-1`.

The examples use the standard AWS partition. They create billable resources when **you** run deployment. Review [Cognito pricing](https://aws.amazon.com/cognito/pricing/), [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/), and [Lambda pricing](https://aws.amazon.com/lambda/pricing/); this template uses the Cognito Essentials tier for managed login. Delete the lab when done.

## 1. Run the local checks

From this `starter-code` directory:

```bash
python3 -m unittest discover -s tests -v
sam validate --lint --region us-east-1
sam build
```

The tests use simulated API Gateway events. They prove the handler's account-access behavior, not Cognito issuance or API Gateway JWT validation. The live checks below exercise those managed services after deployment.

If Node.js 20+ is installed, also run `node --test tests/test_frontend.mjs`. These dependency-free frontend tests check PKCE/state handling, token storage, public-request headers, and logout with simulated network responses.

## 2. Deploy the stack

```bash
sam deploy --guided
```

Use these settings when prompted:

| Setting | Value |
|---|---|
| Stack name | `bank-auth-demo` |
| AWS Region | Your project's assigned Region (`us-east-1` is only an example) |
| `CognitoDomainPrefix` | A unique lowercase prefix, such as `bank-auth-yourname-2026` |
| `AliceSubject` | Leave empty initially |
| `BobSubject` | Leave empty initially |
| Allow IAM role creation | Yes; SAM creates the Lambda execution role |
| Save configuration | Yes; keep the selected stack, Region, and packaging settings |

Review the change set. This intentionally includes a public `GET /branches` route. The two account routes have a JWT authorizer and required scope.

The template creates Cognito managed login version 2 with its default branding, a public app client **without a client secret**, authorization-code flow, and an HTTP API. It explicitly configures localhost callback/logout URLs and CORS for this local demo.

## 3. Configure and open the local frontend

```bash
python3 scripts/configure.py --stack-name bank-auth-demo --region us-east-1
python3 scripts/serve.py
```

If you use an AWS CLI named profile, add `--profile YOUR_PROFILE` to the configuration command and use the same profile for SAM deployment.

Open **http://localhost:8080/**. Keep that exact host, port, and trailing slash. `127.0.0.1`, another port, or another path does not match the registered Cognito callback.

`configure.py` reads only CloudFormation stack outputs and writes `web/config.json`. Its API URL, Cognito domain, and public app client ID are browser configuration, not passwords or AWS keys. The generated file is ignored by Git.

The local server logs paths without OAuth query strings. Browser referrer policy is `no-referrer`; the page removes the one-time authorization code from its URL before token exchange.

## 4. Create Alice and Bob, then bind their identities to the fixtures

1. Click **Sign in / create demo user**, then use Cognito's sign-up option to create Alice with one email address you control. Complete email verification. Use a unique demo password that meets the displayed policy.
2. Click **List my accounts**. An empty list is expected: an authenticated user does not receive account access until the backend mapping is configured.
3. Click **Sign out**. This clears the in-memory access token and visits Cognito's logout endpoint to end its browser login session.
4. Repeat sign-up for Bob using the second address, then sign out again.
5. In the AWS console, open **Amazon Cognito → User pools → your stack's user pool → Users**. Open each demo user and copy the `sub` attribute. The `UserPoolId` appears in your stack outputs and configuration script output. Use the `sub`, not the email address or a guessed user ID.
6. Deploy the same stack again, replacing all three placeholders below. Keep the original domain prefix and use two **different** subject values:

```bash
sam deploy --parameter-overrides \
  CognitoDomainPrefix=YOUR_ORIGINAL_DOMAIN_PREFIX \
  AliceSubject=ALICE_COGNITO_SUB \
  BobSubject=BOB_COGNITO_SUB \
  --save-params
```

All three parameters are included so changing the identity mapping cannot accidentally reset the domain or the other user mapping. Use the saved stack and Region from `sam deploy --guided`. If you did not save them, supply `--stack-name bank-auth-demo --region us-east-1` and your SAM packaging settings.

No password is copied into code, a CLI argument, or a deployment parameter. The `sub` is an opaque user identifier and does not grant access by itself. Empty mappings fail closed: nobody can retrieve either demo account until a subject is bound.

## 5. Test public routes, token checks, and account access

Use separate normal/private browser windows for Alice and Bob, or sign out before switching users.

| Test | Expected result | Check performed by |
|---|---|---|
| Load branches while signed out | `200`, public branch list | Lambda public route |
| Click “Request accounts without a token” | `401` | API Gateway |
| Sign in normally as Alice; list accounts | `200`, only account `5521` | Gateway + Lambda |
| Alice requests `5521` balance | `200`, fictional balance | Gateway + Lambda |
| Alice requests `8842` balance | `404`, `Account not found` | Lambda |
| Alice requests unknown account `9999` | Same `404` body | Lambda |
| Bob requests `8842` balance | `200`, fictional balance | Gateway + Lambda |
| Bob requests `5521` balance | `404`, `Account not found` | Lambda |
| “Sign in without account scope,” then list accounts | `403` | API Gateway scope check |
| Send a malformed or expired token to a protected route | `401` | API Gateway token check |

For simple unauthenticated requests, replace the example base URL with your `ApiUrl` output:

```bash
curl -i https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/branches
curl -i https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/accounts
curl -i -H 'Authorization: Bearer not-a-jwt' \
  https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/accounts
```

For a query-string spoof test, sign in as Alice and temporarily append `?userId=BOB_COGNITO_SUB` to a request for `/accounts/8842/balance` in your own demo. It must still return `404`; the tests also cover body/header spoofing. Do not paste real access tokens into screenshots, logs, source files, URLs, or online JWT decoders.

The page drops expired tokens before its next request, so its normal expired-session behavior is to send no token and receive `401`. To verify a specifically expired token at the gateway, use a local test harness that retains it in memory and waits past its expiration. Never extend token lifetime to make the test pass.

## How does the token reach API Gateway?

The browser uses **authorization code with PKCE** (Proof Key for Code Exchange):

1. It generates random `state` and a one-time PKCE verifier, then sends a hash of that verifier to Cognito with the sign-in redirect.
2. Cognito authenticates the user and redirects to the registered callback with a short-lived authorization code.
3. The browser verifies `state`, then exchanges the code plus the verifier for tokens over HTTPS.
4. It sends the **access token** in `Authorization: Bearer …` for API requests.

PKCE ties the code exchange to the browser that started sign-in. The one-time verifier and state use `sessionStorage` only across the redirect, then are removed. Tokens stay in JavaScript memory: this deliberately simple demo makes you sign in again after a reload. The returned ID token and refresh token are not used. A production application should use a maintained OAuth/OIDC library and deliberately design its session lifecycle.

The required custom scope is issued through Cognito's OAuth authorization flow. A password-based `InitiateAuth` example is not an interchangeable shortcut: it does not automatically give you this custom resource-server scope. The no-scope button requests only `openid` so you can see what a valid token without the route permission does.

## Where are the two authorization checks in the code?

In `template.yaml`, `BankJwtAuthorizer` uses:

- The Cognito user pool URL as its issuer.
- The public app client ID as the audience configuration. Ordinary Cognito access tokens identify the client with `client_id`; API Gateway checks it when `aud` is absent.
- `bank-api/accounts.read` as the required scope on both protected routes.

The scope also helps distinguish access tokens from ID tokens. Do not use the ID token as an API access token. API Gateway forwards the validated claims and scopes to Lambda in `requestContext.authorizer.jwt`.

In `src/app.py`, the account decision uses those validated claims:

```python
subject = jwt.get("claims", {}).get("sub")
account = accounts.get(account_id)
if account is None or subject not in account["allowedSubjects"]:
    return response(404, {"message": "Account not found"})
```

The Lambda scope guard is an extra fail-closed check; API Gateway normally rejects a missing scope before invoking Lambda. The function never decodes a raw bearer token and pretends that proves its authenticity. Keep its configured API Gateway integration as the invocation path; do not add an unauthenticated Lambda Function URL.

## Troubleshooting

- **Redirect mismatch:** open `http://localhost:8080/` exactly. Callback and logout URLs are registered in `WebClient`.
- **Cognito domain unavailable:** choose another unique lowercase prefix and deploy again. Wait for stack completion before opening managed login.
- **Sign-in succeeds but account list is empty:** confirm the deployed `AliceSubject`/`BobSubject` matches that user's Cognito `sub`, and that they are different values.
- **All protected routes return 401:** check issuer, client ID, token expiration, and the bearer header. Regenerate the browser config if the stack was replaced.
- **Protected routes return 403:** sign in using the normal button; the access token must include `bank-api/accounts.read`.
- **Browser says “Failed to fetch”:** verify the API URL, network, and exact CORS origin. CORS is a browser permission mechanism, not user authentication.
- **Reload signed you out locally:** intentional; click sign-in again. No token is persisted in browser storage.

## Clean up the AWS resources

Stop the local server with Ctrl+C, then remove your lab stack:

```bash
sam delete --stack-name bank-auth-demo --region us-east-1
```

Review the deletion prompts, including packaged artifacts. This deletes the demo user pool and its users, API, Lambda, and stack log group. Check the CloudFormation result and any SAM packaging artifacts left by your selected deployment setup.

## Official AWS references

- [JWT authorizers for API Gateway HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [SAM OAuth 2.0/JWT authorizer configuration](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-controlling-access-to-apis-oauth2-authorizer.html)
- [Cognito application clients and public-client PKCE guidance](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html)
- [Cognito authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Cognito resource servers and custom scopes](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-define-resource-servers.html)
- [Cognito managed login domain configuration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-userpooldomain.html)
- [CloudFormation managed login branding](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-cognito-managedloginbranding.html)
