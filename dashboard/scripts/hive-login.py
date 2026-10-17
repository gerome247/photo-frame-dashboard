"""One-time Hive login for the dashboard's heating card and Hive light. Run it yourself:

    ~/.local/share/home-dashboard/hive-venv/bin/python dashboard/scripts/hive-login.py

(Set up once with: python3 -m venv ~/.local/share/home-dashboard/hive-venv &&
 ~/.local/share/home-dashboard/hive-venv/bin/pip install pyhive-integration==1.0.9)

Hive has no official API; this uses the one the Hive app uses, through the library Home Assistant
uses (pyhive-integration). It asks for your Hive email and password (hidden) and the code Hive
texts you, then registers this PC as a trusted device so Hive doesn't text again.

What goes where:
- Cloudflare (Worker secrets): HIVE_CLIENT_ID, HIVE_REGION, HIVE_REFRESH_TOKEN, HIVE_DEVICE_KEY.
  The Worker renews short-lived tokens from these. Your password is never stored or sent there.
- This PC (~/.config/home-dashboard/hive-device.json, private): the trusted-device keys, for a
  later re-login without a text.
No token or password is printed.
"""

import getpass
import json
import os
import pathlib
import subprocess
import sys

import apyhiveapi.api.hive_api as hive_api
from apyhiveapi.api.hive_auth import HiveAuth

# The library fetches Hive's login settings with certificate checks off; turn them back on.
_get = hive_api.requests.get
hive_api.requests.get = lambda *a, **k: _get(*a, **{**k, "verify": True})

DASH = pathlib.Path(__file__).resolve().parent.parent
DEVICE_FILE = pathlib.Path.home() / ".config" / "home-dashboard" / "hive-device.json"


def put_secret(name, value):
    config = ["--config", ".wrangler.deploy.json"] if (DASH / ".wrangler.deploy.json").exists() else []
    subprocess.run(["npx", "wrangler", "secret", "put", name, *config], input=value.encode(), cwd=DASH,
                   stdout=subprocess.DEVNULL, check=True)
    print("Stored", name, "in Cloudflare.")


from apyhiveapi.helper.hive_exceptions import (HiveApiError, HiveInvalid2FACode, HiveInvalidPassword,
                                                HiveInvalidUsername)

email = input("Hive email: ").strip().lower()
password = getpass.getpass("Hive password (hidden): ")
print("Checking with Hive…")
try:
    auth = HiveAuth(email, password)
    result = auth.login()
except (HiveInvalidUsername, HiveInvalidPassword):
    sys.exit("Hive says the email or password is wrong. Try again (the password is case-sensitive).")
except HiveApiError:
    sys.exit("Couldn't reach Hive. Check the internet connection and try again.")

challenge = (result or {}).get("ChallengeName")
for attempt in range(3):
    if challenge != "SMS_MFA":
        break
    code = input("Hive has texted you a 6-digit code. Enter it: ").strip().replace(" ", "")
    try:
        result = auth.sms_2fa(code, result)
        challenge = None
    except HiveInvalid2FACode:
        if attempt == 2:
            sys.exit("That code didn't work three times. Run the script again for a new code.")
        print("That code didn't match. Check the text and try again.")
tokens = (result or {}).get("AuthenticationResult")
if not tokens:
    sys.exit("Hive asked for a step this script doesn't handle yet: " + str((result or {}).get("ChallengeName")) +
             ". Copy this line into the chat (it holds nothing secret).")
print("Logged in.")

if auth.device_key:
    auth.device_registration("Home dashboard")
    group_key, device_key, device_password = auth.get_device_data()
    DEVICE_FILE.parent.mkdir(parents=True, exist_ok=True)
    DEVICE_FILE.touch(mode=0o600)
    os.chmod(DEVICE_FILE, 0o600)
    DEVICE_FILE.write_text(json.dumps({"email": email, "deviceGroupKey": group_key, "deviceKey": device_key, "devicePassword": device_password}))
    print("This PC is now a trusted Hive device.")

# What the Worker will see: list products only (type and name).
api = hive_api.HiveApi(token=tokens["IdToken"])
nodes = api.getAll().get("parsed", {})
for p in nodes.get("products", []):
    print("  found:", p.get("type"), "-", (p.get("state") or {}).get("name", ""))

put_secret("HIVE_CLIENT_ID", auth.data["CLIID"])
put_secret("HIVE_REGION", auth.data["REGION"].split("_")[0])
put_secret("HIVE_REFRESH_TOKEN", tokens["RefreshToken"])
if auth.device_key:
    put_secret("HIVE_DEVICE_KEY", auth.device_key)
print("Done. The Home tab's heating card switches to Hive on its next refresh.")
