import logging
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

from python.emails import get_latest_unread_emails, send_email
from python.env import get_imap_config, get_smtp_config
from python.templates import process_run_email
from python.utils import get_run_url

load_dotenv()
logging.basicConfig(level=int(os.getenv("LOG_LEVEL", 0)))

SMTP_CONFIG = get_smtp_config()
send_email(
    SMTP_CONFIG,
    SMTP_CONFIG["from_address"],
    os.getenv("SMTP_TO_ADDRESS"),
    "mlop: test email",
    process_run_email(
        run_name="test-run",
        project_name="examples",
        last_update_time=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        time_diff_seconds=int(timedelta(seconds=16).total_seconds()),
        run_url=get_run_url(
            host=SMTP_CONFIG["app_host"],
            organization="mlop",
            project="examples",
            run_id=1,
        ),
        reason="Test email",
    ),
    html=True,
)
print(f"Detected {len(get_latest_unread_emails(get_imap_config()))} new emails")
