"""Generate non-secret browser configuration from CloudFormation outputs."""

import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--stack-name")
    source.add_argument("--outputs-file", type=Path, help="Offline describe-stacks JSON fixture")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--profile")
    args = parser.parse_args()
    if args.outputs_file:
        document = json.loads(args.outputs_file.read_text())
    else:
        command = ["aws", "cloudformation", "describe-stacks", "--stack-name", args.stack_name,
                   "--region", args.region, "--output", "json"]
        if args.profile:
            command += ["--profile", args.profile]
        document = json.loads(subprocess.check_output(command, env={**os.environ, "AWS_PAGER": ""}, text=True))
    outputs = {item["OutputKey"]: item["OutputValue"] for item in document["Stacks"][0]["Outputs"]}
    config = {
        "apiUrl": outputs["ApiUrl"].rstrip("/"),
        "cognitoDomain": outputs["CognitoDomainUrl"].rstrip("/"),
        "clientId": outputs["CognitoClientId"],
        "redirectUri": "http://localhost:8080/",
    }
    destination = Path(__file__).resolve().parents[1] / "web" / "config.json"
    destination.write_text(json.dumps(config, indent=2) + "\n")
    print(f"Wrote non-secret browser settings to {destination}")
    print(f"Demo user pool: {outputs['UserPoolId']}")


if __name__ == "__main__":
    main()
