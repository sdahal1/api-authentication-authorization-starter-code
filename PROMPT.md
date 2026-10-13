# Coding-assistant prompt: build a Cognito-protected API Gateway demo

Copy this into your coding assistant with this starter directory open and Agent Toolkit for AWS connected:

```text
Help me learn API authentication and authorization using this fictional bank starter.
Use Agent Toolkit for AWS for the supported AWS workflows and current service guidance.

First inspect README.md, template.yaml, src/app.py, and web/app.js. Explain the request
flow in beginner language: Cognito signs in the user, API Gateway validates the access
token and route scope, and Lambda checks access to the individual account.

I am using the new AWS sign-in experience. Verify which account, Region, services,
credentials, and deployment permissions are available. Explain the distinction between
my AWS builder sign-in and the demo customers' Cognito sign-in. Do not assume Cognito,
CloudFormation, Lambda, IAM, or API Gateway deployment is available in every experience.

Use the existing AWS SAM project. Keep these exact routes:
- Public GET /branches, without an authorizer.
- Protected GET /accounts.
- Protected GET /accounts/{accountId}/balance.

Both protected routes must use a JWT authorizer with the Cognito user pool issuer,
the app client audience/client_id, and the scope bank-api/accounts.read. Use Cognito
managed login, a public app client without a secret, authorization code + PKCE, and
the exact localhost callback. Send the access token, not the ID token, to the API.
Never put AWS credentials in the frontend. Never log or publish tokens or passwords.

Use the validated requestContext.authorizer.jwt.claims.sub for account authorization.
Never trust a user ID in a URL, query, body, or arbitrary header. Alice can access 5521
and Bob can access 8842 only after I bind their real Cognito subject identifiers.
Keep the same 404 response for an inaccessible and a nonexistent account. An unmapped
user must get no accounts. Use only fictional data; no database is required for this lab.

Run the local tests and SAM validation first. Describe the deployment changes and likely
charges before deploying, and let me confirm the target AWS account and Region. Guide
me through Cognito sign-up without asking me to paste passwords or tokens into chat.
Preserve every SAM parameter when binding the two subjects. Verify the complete test
matrix: public success, missing/invalid token 401, missing scope 403, own account 200,
cross-user account 404, and spoofed user-ID denial. Distinguish local test results from
live AWS results. Show me how to delete the demo when finished.
```
