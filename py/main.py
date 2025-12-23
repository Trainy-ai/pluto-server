import os
import sys
import time

from clickhouse_connect import get_client as get_clickhouse_client
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from python.env import get_database_url, get_smtp_config
from python.server import process_runs

load_dotenv()

SMTP_CONFIG = get_smtp_config()
DATABASE_URL = get_database_url()
CH_URL = os.getenv("CLICKHOUSE_URL", "url")
CH_USER = os.getenv("CLICKHOUSE_USER", "user")
CH_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "password")
try:
    CH_HOST = CH_URL.split("://")[1].split(":")[0]
    CH_PORT = CH_URL.split("://")[1].split(":")[1]
except Exception as e:
    print(f"Error parsing CH_URL: {e}")
    sys.exit(1)


def start():
    if not DATABASE_URL:
        print("DATABASE_URL is not set")
        sys.exit(1)
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False}
        if DATABASE_URL.startswith("sqlite")
        else {},
    )
    Session = sessionmaker(bind=engine)
    session = Session()
    ch_client = get_clickhouse_client(
        host=CH_HOST,
        port=CH_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
    )
    return engine, session, ch_client


if __name__ == "__main__":
    try:
        engine, session, ch_client = start()
        while True:
            process_runs(session, ch_client, smtp_config=SMTP_CONFIG)
            time.sleep(10)
    except Exception as err:
        print("Processing failed:", err)
    finally:
        session.close()
        engine.dispose()
        print("Restarting script...")
        os.execv(sys.executable, [sys.executable] + sys.argv)
