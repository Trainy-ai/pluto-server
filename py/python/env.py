import os


def get_smtp_config():
    return {
        "server": os.getenv("SMTP_SERVER", "localhost"),
        "port": os.getenv("SMTP_PORT", 587),
        "username": os.getenv("SMTP_USERNAME", ""),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_address": os.getenv("SMTP_FROM_ADDRESS", ""),
        "app_host": os.getenv("APP_HOST", "localhost"),
    }

def get_imap_config():
    return {
        "server": os.getenv("IMAP_SERVER", "localhost"),
        "port": os.getenv("IMAP_PORT", 993),
        "username": os.getenv("IMAP_USERNAME", ""),
        "password": os.getenv("IMAP_PASSWORD", ""),
    }

def get_database_url():
    return os.getenv("DATABASE_DIRECT_URL")
