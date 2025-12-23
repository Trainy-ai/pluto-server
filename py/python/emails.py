import email
import imaplib
import logging
import smtplib
from email.header import decode_header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

TAG = "Emails"


def send_email(config, from_address, to_address, subject, body, html=False):
    email = MIMEMultipart()
    email["From"] = from_address
    email["To"] = to_address
    email["Subject"] = subject
    email.attach(MIMEText(body, "html" if html else "plain"))

    try:
        with smtplib.SMTP(config["server"], config["port"]) as server:
            server.starttls()
            server.login(config["username"], config["password"])
            server.sendmail(from_address, to_address, email.as_string())
        print("Email sent successfully!")
    except Exception as e:
        print(f"Failed to send email: {e}")


def get_latest_unread_emails(config, mailbox="inbox", criteria="UNSEEN"):
    imap_client = imaplib.IMAP4_SSL(config["server"], config["port"])
    imap_client.login(config["username"], config["password"])

    emails_data = []
    try:
        imap_client.select(mailbox)

        status, messages = imap_client.search(None, criteria)
        if status != "OK":
            logging.error(f"{TAG}: Error searching for emails: {status}")
            return emails_data

        email_ids = messages[0].split()
        if not email_ids:
            logging.debug(f"{TAG}: No new emails found.")
            return emails_data
        logging.debug(f"{TAG}: Found {len(email_ids)} new email(s).")

        for e_id in email_ids:
            status, msg_data = imap_client.fetch(e_id, "(RFC822)")
            if status != "OK":
                logging.error(f"{TAG}: Error fetching email ID {e_id}: {status}")
                continue

            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])

                    subject, encoding = decode_header(msg["Subject"])[0]
                    if isinstance(subject, bytes):
                        subject = subject.decode(encoding if encoding else "utf-8")

                    email_content = {
                        "id": e_id.decode(),
                        "subject": subject,
                        "from": msg.get("From"),
                        "body": "",
                    }

                    if msg.is_multipart():
                        for part in msg.walk():
                            content_type = part.get_content_type()
                            content_disposition = str(part.get("Content-Disposition"))

                            try:
                                body = part.get_payload(decode=True).decode()
                            except Exception:
                                pass

                            if (
                                content_type == "text/plain"
                                and "attachment" not in content_disposition
                            ):
                                email_content["body"] += body
                    else:
                        content_type = msg.get_content_type()
                        if content_type == "text/plain":
                            try:
                                email_content["body"] = msg.get_payload(
                                    decode=True
                                ).decode()
                            except Exception:
                                pass

                    emails_data.append(email_content)

        imap_client.logout()
    except imaplib.IMAP4.error as e:
        logging.error(f"{TAG}: IMAP Error: {e}")
    except Exception as e:
        logging.error(f"{TAG}: An unexpected error occurred: {e}")

    return emails_data
