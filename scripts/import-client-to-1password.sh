#!/bin/sh
# Import a Google OAuth Desktop client JSON into 1Password, then shred the file.
#
# The client id and secret move from the file into 1Password without ever being
# printed, so they never land in a terminal transcript or shell history.
#
# Usage: scripts/import-client-to-1password.sh <client.json> [vault] [item-title]
set -eu

CLIENT_FILE=${1:-}
VAULT=${2:-Private}
ITEM=${3:-Search Console}

if [ -z "$CLIENT_FILE" ] || [ ! -f "$CLIENT_FILE" ]; then
  echo "Usage: $0 <path-to-client.json> [vault] [item-title]" >&2
  exit 1
fi

if ! command -v op >/dev/null 2>&1; then
  echo "The 1Password CLI (op) is not on PATH. Install it with: brew install 1password-cli" >&2
  exit 1
fi

# Fail early with a clear message rather than a cryptic op error later.
if ! op vault get "$VAULT" >/dev/null 2>&1; then
  echo "Cannot read vault \"$VAULT\". Enable 1Password's CLI integration (Settings > Developer > Integrate with 1Password CLI) and approve the prompt." >&2
  exit 1
fi

# Extract without echoing. Rejects a Web client, which has a "web" key instead.
CLIENT_ID=$(python3 -c '
import json,sys
doc=json.load(open(sys.argv[1]))
installed=doc.get("installed")
if not installed:
    sys.exit("Not a Desktop client: expected an \"installed\" block. Create an OAuth client of type \"Desktop app\".")
print(installed["client_id"])
' "$CLIENT_FILE")

CLIENT_SECRET=$(python3 -c '
import json,sys
print(json.load(open(sys.argv[1]))["installed"]["client_secret"])
' "$CLIENT_FILE")

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" \
    "client_id[text]=$CLIENT_ID" \
    "client_secret[password]=$CLIENT_SECRET" >/dev/null
  echo "Updated \"$ITEM\" in vault \"$VAULT\"."
else
  op item create --category "API Credential" \
    --title "$ITEM" --vault "$VAULT" \
    "client_id[text]=$CLIENT_ID" \
    "client_secret[password]=$CLIENT_SECRET" >/dev/null
  echo "Created \"$ITEM\" in vault \"$VAULT\"."
fi

# Overwrite before unlinking so the bytes are not left recoverable.
if command -v shred >/dev/null 2>&1; then
  shred -u "$CLIENT_FILE"
else
  rm -P "$CLIENT_FILE"
fi
echo "Shredded $CLIENT_FILE."

echo
echo "Now configure the shell that launches the server:"
echo "  export GSC_SECRET_PROVIDER=1password"
echo "  export GSC_SECRET_OP_VAULT='$VAULT'"
echo "  export GSC_SECRET_OP_ITEM='$ITEM'"
