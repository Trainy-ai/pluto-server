import logging
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

# Configure logging to stdout so k8s can capture it
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [stale-run-job] %(levelname)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("stale-run-job")

SMTP_CONFIG = get_smtp_config()
DATABASE_URL = get_database_url()
CH_URL = os.getenv("CLICKHOUSE_URL", "url")
CH_USER = os.getenv("CLICKHOUSE_USER", "user")
CH_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "password")
try:
    CH_HOST = CH_URL.split("://")[1].split(":")[0]
    CH_PORT = CH_URL.split("://")[1].split(":")[1]
except Exception as e:
    logger.error(f"Error parsing CH_URL: {e}")
    sys.exit(1)


def start():
    if not DATABASE_URL:
        logger.error("DATABASE_URL is not set")
        sys.exit(1)
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False}
        if DATABASE_URL.startswith("sqlite")
        else {},
    )
    Session = sessionmaker(bind=engine)
    ch_client = get_clickhouse_client(
        host=CH_HOST,
        port=CH_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
    )
    return engine, Session, ch_client


if __name__ == "__main__":
    engine = None
    try:
        engine, Session, ch_client = start()
        logger.info("Stale run job started, checking every 60s")
        cycle = 0
        while True:
            cycle += 1
            # Create a fresh session each cycle so we always see the latest DB state.
            # Reusing a single session causes SQLAlchemy's identity map to cache stale
            # query results, meaning new RUNNING runs are invisible to subsequent cycles.
            session = Session()
            try:
                logger.info(f"Cycle {cycle}: starting stale run check")
                process_runs(session, ch_client, smtp_config=SMTP_CONFIG)
            except Exception as err:
                logger.exception(f"Cycle {cycle}: error during processing")
            finally:
                session.close()
            time.sleep(60)
    except Exception as err:
        logger.exception("Fatal error")
    finally:
        if engine:
            engine.dispose()
        logger.info("Restarting stale run job...")
        os.execv(sys.executable, [sys.executable] + sys.argv)
